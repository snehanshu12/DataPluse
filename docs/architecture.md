# DataPulse 架构文档

> 一页看懂：**CLI 后端（数据层）** 与 **Electron 桌面端（交互层）** 如何分工、数据如何流转、安全边界在哪。管线级设计另见 [`text2sql.md`](text2sql.md)。

## 1. 总览

```
┌────────────────────────────────────────────────────────────────────┐
│                    Electron 桌面端 (desktop/)                       │
│                                                                    │
│  React 渲染层                    Electron 主进程 (main.cjs)          │
│  ┌─────────────────────────┐    ┌───────────────────────────────┐   │
│  │ Composer / Chat /       │    │ ipcMain.handle(...)           │   │
│  │ DashboardCard /         │ IPC │  - 参数校验 (cleanString /     │   │
│  │ EmptyState / Sidebar    │◄───►│    isValidSource / ...)       │   │
│  │                          │    │  - withTimeout(p, ms)         │   │
│  │ electronAPI (preload)   │    │    「超时即 child.kill()」      │   │
│  └───────────▲─────────────┘    │  - settings.json 原子写+0600   │   │
│              │ contextBridge,   │  - 单实例锁                    │   │
│              │ contextIsolation │  - spawn(node, ..., shell:false)│  │
│              │                  └──────────────┬────────────────┴───  │
│              │ (无 nodeIntegration)            │ 派生子进程, stdin=argv│
└──────────────┼─────────────────────────────────┴────────────────────┘
               │        --json 输出 (stdout)
               ▼
┌────────────────────────────────────────────────────────────────────┐
│              Node CLI 后端 (src/)  — 每个 CLI 一个入口                │
│                                                                    │
│  ask ──────────► router ──► Text2SQL 管线 或 ReAct 智能体           │
│  starters ─────► introspection → fingerprint → LLM 生成 6 题 + 缓存 │
│  dashboard ────► dashboard 智能体 → JSON spec → HTML 导出            │
│  preview ──────► 表头 + 前 N 行预览                                  │
│  csv-import ───► CSV → 推断类型 → data/imported/*.db                │
│                                                                    │
│  DataSource 契约（方言无关）                                         │
│  SQLite (better-sqlite3) / PostgreSQL (pg) / MySQL (mysql2)        │
└────────────────────────────────────────────────────────────────────┘
```

**核心思想**：桌面端不做任何数据访问逻辑——它只负责 UI 与进程编排；所有 SQL / LLM
调用都在一次性的 CLI 子进程里完成。每个 CLI 以 `--json` 输出结构化结果，主进程解析后
交还渲染层。

---

## 2. 后端（src/）

### 2.1 分层

```
src/config.ts            环境变量（LLM 三元组、DB_PATH、ROOT）
src/db/                  只是历史 SQLite 初始化/种子，现代码不依赖它提问
src/agent/
  llm.ts                 惰性 OpenAI 兼容客户端 + withRetry + runAgent 智能体循环
  agent.ts               “一次提问”编排：路由 + 组装 messages
  sqlTool.ts             ReAct 智能体的只读 SELECT 执行守卫
  text2sql/              确定性 Text2SQL 管线
src/bi/                  看板：generate（智能体出 JSON spec）/ types（清洗）/ render（HTML）
src/import/csvImport.ts  CSV → SQLite 导入器
src/cli/                 ask / starters / dashboard / preview / importCsv / sourceConn
```

### 2.2 两条提问路径（agent.ts + router.ts）

提问先经 `route(question)` 分流：

| 关键词命中 | 走 | 特点 |
| --- | --- | --- |
| 为什么 / 原因 / 建议 / 分析 / 策略 / 预测 / 解释… | **ReAct 智能体** | 自由多轮工具调用，可自主拆解问题 |
| 其余（取数/聚合/趋势） | **Text2SQL 管线** | 确定性生成 → 校验 → 执行 → 自纠错 |

**Text2SQL 管线（pipeline.ts）**，各阶段拥有**独立的失败预算**：

```
 question
   │  generate(ctx)                       ── completeJson + 归一化(normalizePlan)
   ▼
 SqlPlan{sql, reasoning, tables}
   │  source.validate(sql)                ── 方言守卫（见 §6）
   ▼
 execute (maxRows=200; sqlite 流式 iterate)
   │  finalize(ctx)                       ── rows→中文回答（独立重试 ≤3 次）
   ▼
 answer + events
失败时把 error + 上一稿 SQL 回喂给 generate（≤3 次尝试），并在 events 里记录 sql_fix
```

**ReAct 智能体（runAgent，llm.ts）**：system + messages → 模型返回 tool_calls →
`sqlTool.execute` → 结果以 `role:'tool'` 回填 → 循环；最多 `maxRounds`=8 轮。

### 2.3 数据源适配器（text2sql/*）

所有适配器实现同一个 **DataSource 契约**（datasource.ts）：`describe / validate / query`。

| 适配器 | 方言校验 | 结构探测 | 探测缓存 |
| --- | --- | --- | --- |
| sqlite.ts | SELECT 正则 + `db.prepare` | `sqlite_master` + `PRAGMA table_info` + 样例行 | 按文件 `mtime`（WeakMap） |
| postgres.ts | `node-sql-parser`（PostgresQL） | `information_schema` + `pg_class` 行数 + 样例 | 60s TTL（WeakMap） |
| mysql.ts | `node-sql-parser`（MySQL） | `information_schema` + `table_rows` 行数 + 样例 | 60s TTL（WeakMap） |

语义注释（什么列是金额、什么字段是日期）由 `schema.ts` 的 curated 表按名字叠加，
**不会**把演示库的错误预期强加给用户导入的表——你的 CSV/任意库只靠实况探测。

### 2.4 看板（src/bi/）

- **generate.ts**：一个专用 agent，系统提示里带实时 `source.describe()`；工具 `run_sql`
  走同一 DataSource（maxRows=500，回喂模型只给 60 行预览）；最后提取 ```json``` 块。
- **types.ts**：`sanitizeDashboardSpec` 白名单化——非法类型丢弃、值转 number、空看板返回
  null，LLM 的脏输出到不了渲染层。
- **render.ts**：spec → 自包含 HTML（内置数据 + `cdn.jsdelivr.net` 的 ECharts）+ 转义。

### 2.5 推荐问题（cli/starters.ts）

```
source.describe() + collectTables() → fingerprint = 4|driver|tables:rows:cols&…
   │                                      ↑ 数据一有变化指纹就变 → 缓存自动失效
   ▼
data/starters-cache.json 命中 ? 直接返回 : LLM 生成 6 题并写入（loadCache/writeCache 容错）
   └── --force 强制忽略缓存重生成（桌面端「↻ 重新生成」按钮）
```

### 2.6 CSV 导入

```
路径解析 → 全量解析(parseCsv，双引号/CRLF/引号转义) → 表名 = <目录>_<文件名>
→ 列名去重(重名加 _2/_3) → 类型推断(INTEGER/REAL/TEXT) → 单事务插入 data/imported/<表名>.db
```

---

## 3. 桌面端（desktop/）

### 3.1 进程模型与安全基线

| 项 | 实现 |
| --- | --- |
| 渲染层权限 | `contextIsolation: true`，`nodeIntegration: false`，`sandbox`（默认） |
| 暴露面 | preload 只暴露 `contextBridge` + 一批 `ipcRenderer.invoke` 包装，**零** `ipcRenderer.on` |
| 子进程 | `spawn(node, ['--import','tsx', entry, ...argv], { shell:false })`，Windows 上先用静态探测解析 node.exe |
| 超时 | `withTimeout`：到期 `reject` 并 `child.kill()`，不会留孤儿进程 |
| 配置 | `settings.json`（userData）tmp+rename 原子写、`0600`；`app.requestSingleInstanceLock()` 防多实例竞写 |

### 3.2 IPC 通道

| 通道 | 职责 | 超时 |
| --- | --- | --- |
| `ask` | 提问（含回合历史） | 120s |
| `get-starters` | 推荐问题（`refresh` 传 `--force`） | — |
| `get-table-preview` | 单表前 N 行 | 15s |
| `get-dashboard` | 生成看板 | 60s |
| `import-csv` / `pick-csv` / `pick-sqlite` | 文件导入 | — |
| `get/save-settings`、`remove-source`、`clear-sources` | 配置与数据源 | — |
| `clipboard-write` | 复制回答 | — |

每个 handler 先做输入白名单（`cleanString`、`isValidSource`、长度/类型/计数上限），
再进入 CLI——渲染层被攻破也不等于“任意参数”。

### 3.3 渲染层关键逻辑（App.tsx）

```
thread (当前会话)           ── 一段「新问题 + 连续追问」累积
sessionRef                  ── 会话令牌：每次结果写回前校验 stillActive()
                              → 换源 / 新问题 / 删历史 时丢弃迟到响应，防止串会话
history (localStorage)      ── 只含问题/回答/事件/折叠 source{id,name,type}（无连接串）
startersMap + startersFetched  ── 推荐问题按源缓存，来源切换才重新拉取
CHART_INTENT 检测 + ensureChartHint ── “画图”类问题走 get-dashboard（IPC）
                                    并保证起手式/追问列表至少一条图表题
```

组件职责：`Composer`(输入+调度)、`Chat`(回合渲染)、`AssistantMsg`(回答+风险提示+复制)、
`DashboardCard/ChartCard`(ECharts 内联 + 全屏)、`EmptyState`(加载态+推荐题+↻重新生成)、
`Sidebar`(源切换+可拉伸宽度)、`SchemaBar`(表结构)、`SettingsModal/SourceDialog`(配置)。

### 3.4 渲染层适配 ECharts

`ChartCard` 用 ECharts **modular import**（按需注册 Bar/Line/Pie/Scatter）。option 由
`ChartCard#optionFor` 生成，与后端 `bi/render.ts` 的 HTML 导出保持一致（同一份语义）。

---

## 4. 缓存与性能

| 位置 | 机制 | 目的 |
| --- | --- | --- |
| SQLite 结构探测 | 文件 `mtime` 不变即用缓存 | 大 CSV 重复提问不重扫 COUNT(*) |
| PG/MySQL 结构探测 | 60s TTL、按 client（WeakMap） | 连续多问只扫一次 information_schema |
| starters 缓存 | `data/starters-cache.json` + schema 指纹 | 结构没变不重复烧 token |
| 提问结果 | SQLite 流式 `stmt.iterate()`，不再 `all()+slice` | 大表不全量进内存 |
| 行数上限 | 提问 200 / 看板设计 500 / 回喂模型预览 60 | 防爆炸、防上下文膨胀 |

---

## 5. 数据流小结（一张图）

```
提问:    Composer ──IPC──► ask.ts ──► route ──► Text2SQL/ReAct ──► SQL ──► DataSource ──► 回答
图表:    (检测到图意) ──IPC──► dashboard.ts ──► dashboard agent ──► JSON spec ──► ChartCard/ECharts
推荐题:  EmptyState ──IPC──► starters.ts ──► introspection + LLM ──► 6 条 chips（缓存）
预览:    SchemaBar ──IPC──► preview.ts ──► 表头 + 前 N 行
导入:    SourceDialog ──IPC──► import-csv ──► csvImport ──► data/imported/*.db ──► 出现在源列表
```

---

## 6. 安全设计

1. **SELECT-only**：sqlite 用正则 + `db.prepare`；PG/MySQL 用 `node-sql-parser` 解析 AST；
   一律拒绝“结尾分号之前出现的 `;`”（防多语句注入），并先剥离头部注释再判定。
2. **凭据不落界面**：`redactConnectionUrl()` → `postgres://***@host:port/db`；API Key 与
   连接串输入框均为 `type=password`；localStorage 历史不存 URL。
3. **`.env` / `data/` gitignore**；`settings.json` 原子写 + `0600`；单实例锁。
4. **IPC 白名单校验** + **`shell:false`** 子进程 + **超时杀进程**。
5. **LLM 输出可信度**：看板 spec 走 sanitizer；回答不在 UI 内 `innerHTML`（Markdown 组件转义）。
6. **隐私模型知悉**：schema 样例（每表 ≤3 行）与查询结果（≤200 行）会发送到配置的模型
   服务——设置弹窗内有明文提示；问答历史明文存在本机，可开启“退出时清除”。

---

## 7. 运行与依赖

| 场景 | 依赖 |
| --- | --- |
| 纯本地 SQLite / CSV | 仅 Node ≥24 + `npm install` |
| CRM（PostgreSQL）| `docker compose -f docker/compose.yml up -d --build`（:5433） |
| MySQL 图书库 | `docker compose up -d mysqldb`（:3307） |
| LLM | `.env`：`LLM_BASE_URL / LLM_API_KEY / LLM_MODEL`（OpenAI 兼容均可，如 DeepSeek） |

测试：`npm test`（39 用例）**不依赖网络/数据库/API Key**——LLM 客户端惰性初始化、
测试用假客户端与内存 SQLite；`npm run typecheck` 覆盖根目录 + 测试 + 桌面端。

---

## 8. 演进建议（非本版范围）

- dashboard 智能体产物加结构校验二轮生成（`sanitize` 已兜底，可再加“图表语义自检”）。
- 分页 / 大数据集流式导出（当前结果上限 200 行）。
- 为 `main.cjs` IPC 与 `App.tsx` 引入测试（目前零覆盖）。
- 多窗口/多会话并行请求（当前全局 `busy` 串行）。