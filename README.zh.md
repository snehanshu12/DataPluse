# DataPulse

一个 AI BI 分析工作台：接入 **SQLite / CSV / PostgreSQL / MySQL** 数据源后，用自然语言提问，**LLM 智能体**负责写出只读 SQL、基于真实数据回答，还能**自动生成 ECharts 图表看板**。

> [English README](README.md)

## 快速开始

```bash
npm install
cp .env.example .env   # 填入你的 LLM_API_KEY
npm run seed           # 生成 data/ecommerce.db（约 6k 订单）
npm run desktop        # 启动桌面端
```

> **演示数据是生成物，不提交。** `data/` 与 `*.db` 已被 gitignore——克隆后不会有 `data/ecommerce.db`（与导入库），需先 `npm run seed`（或 `make init`）。见下文「数据与生成物」。

## 命令

| 命令 | 说明 |
| --- | --- |
| `npm run seed` | （重新）生成演示数据库。可用 `SEED_ORDERS`、`SEED_CUSTOMERS`、`SEED_PRODUCTS_PER_CATEGORY`、`SEED_MAX_ITEMS`、`SEED_VALUE` 环境变量调节规模。 |
| `npm run ask -- "问题"` | 命令行提问：智能体写 SQL → 查询 → 回答。 |
| `npm run crm-ask -- "问题"` | 对 PostgreSQL CRM 库提问（需 `CRM_DATABASE_URL`）。 |
| `npm run crm-seed` | 创建并填充 CRM 库（`companies/contacts/deals/activities`）。 |
| `npm run mysql-ask -- "问题"` | 对 MySQL 图书库提问（需 `MYSQL_DATABASE_URL`）。 |
| `npm run mysql-seed` | 创建并填充 MySQL 图书库（`publishers/authors/books/members/borrows`）。 |
| `npm run csv-import -- <csv> [表名]` | 导入 CSV 到本地 SQLite（首行为表头、类型自动推断），存放于 `data/imported/`。 |
| `npm run starters` | 基于实时库结构生成 6 条推荐问题（按结构指纹缓存；`--force` 强制重新生成）。 |
| `npm run dashboard -- "描述"` | 智能体设计图表并输出独立 `output/dashboard-<ts>.html`（浏览器打开）。 |
| `npm test` | 运行单元测试（不依赖网络/数据库/API Key）。 |
| `npm run typecheck` | TypeScript 检查（含根目录、测试与桌面端）。 |
| `npm run desktop` | 启动桌面端（Electron）提问界面。 |

桌面端依赖 CLI 的 `--json` 输出（`ask` / `starters` / `preview` / `dashboard` /
`csv-import`）；每个入口也可独立调试：`npx tsx <src/cli/入口.ts> --json …`。

### 桌面端（Electron）

`desktop/` 目录是 Electron 控制台（Vite + React）。主进程把请求派发给 Node CLI
（`--json` 模式，一律 `shell:false`），渲染层展示问答、SQL 执行记录、回答与图表。亮点：

- 侧栏**数据源切换**（SQLite / PostgreSQL / MySQL / 导入的 CSV），并有**可拖拽拉伸**的侧栏宽度（自动记忆）。
- **推荐问题实时生成**：首次进入显示加载中动画，结果按结构指纹缓存；点击**「↻ 重新生成」**强制重生成。问题列表始终保证至少一条图表类问题，图表入口不会被模型盖掉。
- 每条回答后带**追问建议 chips**（内置一条图表意图问题）。
- **图表卡片内联渲染**，带**「⛶ 全屏」**按钮（ESC / ✕ 退出）。
- **隐私设计**：答案复制在识别为「高风险」时需二次确认；数据库连接串在界面中**自动脱敏**（`postgres://***@host:port/db`），密码永不直出屏幕。
- ⚙ 设置（工具栏）：编辑 LLM（base URL / API key / model）与各数据源连接配置。配置存入 Electron userData 目录的 `settings.json`（原子写入、0600 权限），提问时覆盖 `.env`；留空则回落到 `.env`。单实例锁避免两个进程竞态写同一文件。

```bash
npm install              # 项目根目录
npm install --prefix desktop
npm run desktop          # 在项目根目录执行
```

### CRM（PostgreSQL）演示

拉起固定版本的 Postgres（`docker/` 下的 Dockerfile + compose），灌数据后提问：

```bash
docker compose -f docker/compose.yml up -d --build   # postgres 在 :5433，init/ 自动建表
export CRM_DATABASE_URL="postgres://postgres:postgres@127.0.0.1:5433/crm"  # 也可写进 .env
npm run crm-seed          # 自动建库建表，插入约 460 行
npm run crm-ask -- "各行业已成交商机金额排名"
```

`crm-seed` 会在库不存在时自动创建并确定性重置。关闭用
`docker compose -f docker/compose.yml down`（加 `-v` 会清掉数据卷）。

### MySQL 图书借阅演示

拉起 MySQL 服务（`docker/compose.yml`），灌数据后提问：

```bash
docker compose -f docker/compose.yml up -d mysqldb       # mysql:8.4 在 :3307，自动建库 `library`
export MYSQL_DATABASE_URL="mysql://root:root@127.0.0.1:3307/library"  # 也可写进 .env
npm run mysql-seed          # 自动建表，插入约 520 行
npm run mysql-ask -- "借出最多的5本图书"
```

所有数据源走**同一套 Text2SQL 管线** + 实时结构探测（`mysql.ts` 与
`postgres.ts` 一样读 `information_schema`），所以任意已有 MySQL/PostgreSQL
库——不只是演示库——都能开箱即用。结构探测带缓存（SQLite 按文件 mtime，服务端 60s TTL）。

### CSV 导入

```bash
npm run csv-import -- path/to/file.csv
npm run csv-import -- path/to/file.csv MyTableName
```

首行作为表头（重名列自动加 `_2`/`_3`），按数据推断列类型（INTEGER/REAL/TEXT），
整体写入 `data/imported/<表名>.db`。默认表名取「所在目录名_文件名」，同名文件来自
不同目录也不会混淆。导入生成的库会自动出现在桌面端的数据源列表里。

### 示例

```bash
npm run ask -- "which category generated the most revenue in the last 3 months?"
npm run ask -- "month-over-month growth of completed orders"
npm run dashboard -- "monthly revenue trend, revenue share by category, top 5 cities, top products"
```

## 配置

环境变量（`.env`）：

| 变量 | 默认值 | 说明 |
| --- | --- | --- |
| `LLM_BASE_URL` | `https://api.openai.com/v1` | OpenAI 兼容端点。DeepSeek（`https://api.deepseek.com`）、火山方舟、OpenAI 等均可。 |
| `LLM_API_KEY` | — | API Key（真实提问必需；**测试不需要**）。 |
| `LLM_MODEL` | `gpt-4o-mini` | 模型名，如 `deepseek-chat`、`doubao-seed-1-6-250615`。 |
| `DB_PATH` | `data/ecommerce.db` | SQLite 文件路径（相对项目根目录）。 |
| `CRM_DATABASE_URL` | — | CRM 演示 / 任意 Postgres 的连接串。 |
| `MYSQL_DATABASE_URL` | — | 图书演示 / 任意 MySQL 的连接串。 |

## 数据模型

`categories`、`customers`、`products`、`orders`、`order_items` —— `data/ecommerce.db` 中 12 个月的模拟历史数据。

## 数据与生成物

- `data/` 下所有文件（`ecommerce.db`、`imported/*.db`、`starters-cache.json`）与 `output/` 均为**生成物并被 gitignore**——绝不提交。
- 新克隆后：`make init` 一条命令完成装依赖 + `npm run seed`。
- 清理：`make db-remove` 只删演示库；`make reset` 先清空再重建；`make clean` 删除 `dist/`、`data/`、`output/`。

## 架构

> 完整架构（分层、数据流、缓存、安全边界）见 [`docs/architecture.md`](docs/architecture.md)；Text2SQL 管线设计见 [`docs/text2sql.md`](docs/text2sql.md)。

```
src/
├── config.ts            环境变量 / 路径
├── db/
│   ├── schema.ts        电商库结构与模拟词汇
│   ├── seed.ts          确定性模拟数据生成
│   └── database.ts      SQLite 初始化 + 供 LLM 的结构探测
├── agent/
│   ├── llm.ts           惰性初始化的 OpenAI 兼容客户端 + 工具调用智能体循环 + 追问建议
│   ├── sqlTool.ts       ReAct 智能体的只读 SQL 执行守卫
│   ├── agent.ts         “ask” 入口：路由到 Text2SQL 或 ReAct 智能体
│   └── text2sql/        确定性 Text2SQL 管线（设计见 docs/text2sql.md）
│       ├── datasource.ts  DataSource 契约（方言无关）
│       ├── introspect.ts  实时结构探测 → prompt 文本
│       ├── sqlite.ts      SQLite 适配器（流式读取、按 mtime 缓存探测）
│       ├── postgres.ts    PostgreSQL 适配器（CRM，node-sql-parser，TTL 缓存探测）
│       ├── mysql.ts       MySQL 适配器（图书库，node-sql-parser，TTL 缓存探测）
│       ├── schema.ts      语义注释叠加（电商 + CRM + MySQL）
│       ├── generator.ts   问题 → SQL（JSON、自校验）
│       ├── finalize.ts    结果行 → 回答
│       ├── pipeline.ts    生成 → 校验 → 查询 → 汇总（含自纠错重试）
│       └── router.ts      取数问题走 text2sql，分析问题走 agent
├── bi/
│   ├── types.ts          看板/图表规格类型 + 清洗器
│   ├── render.ts         规格 → ECharts HTML（内联 + CDN 引入 ECharts）
│   └── generate.ts       “dashboard” 智能体（查询 + 输出 JSON 规格）
├── import/
│   └── csvImport.ts      CSV → SQLite（类型推断、重名列、批量写入）
└── cli/                  seed / ask / starters / dashboard / csv-import / preview 入口
desktop/                  Electron 界面（Vite + React）：对话、图表看板、推荐问题
docs/text2sql.md          Text2SQL 管线设计笔记
```

智能体拿到实时结构、自行选择图表，仅执行**只读 SELECT**（行数上限：提问 200 行、
看板设计 500 行——回喂给模型的预览只给 60 行），输出经清洗的 JSON 看板规格，
渲染为独立 HTML 文件。

> 取数类问题走的是 **Text2SQL 管线** 而非智能体循环：专门的 SQL 生成 + 代码级校验
> + 自纠错。详见 [`docs/text2sql.md`](docs/text2sql.md)。

## 安全说明

- SQL 工具拒绝一切非**单条** `SELECT` 的语句（禁写、禁 `PRAGMA` 类变更），并在判定前剥离语句头注释。
- `.env`、`data/` 已被 gitignore；桌面端 `settings.json`（可能含 API Key）**原子写入**并设 `0600` 权限。
- 连接串在进入 UI 前**自动脱敏**——凭据永不渲染，截屏/投屏也不泄漏。
- 桌面端用 `shell:false` 派生 CLI，并对每个 IPC 参数做类型/长度校验；超时会主动杀掉挂起的子进程，而不是任其常驻。
- 导出的看板为本地 HTML，ECharts 从 `cdn.jsdelivr.net` 加载。

## 相关文章
- [Text2SQL 确定性管线 + ReAct 双路径：datapulse AI BI 工作台架构解析](https://erishen.cn/datapulse/)
