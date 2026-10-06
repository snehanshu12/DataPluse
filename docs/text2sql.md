# Text2SQL 模块

`src/agent/text2sql/` 把业务问题转成**确定性、可校验的 SQL 查询**，用于纯取数类问题，取代原先靠 agent 自由发挥的链路。本质是「RAG-lite」版 Text2SQL：**实时 introspection** 出的 schema 知识注入专项生成器的 prompt，产出的每条 SQL 在执行前**都在代码层做静态校验**，并带有限次自修正。

```
                    ┌─────────────────────────────────────────────────────┐
 question ────────► │ runText2Sql(source, question, {generate, finalize}) │
                    │                                                     │
                    │  1. source.describe()  → schema 知识                │
                    │  2. generate(ctx)      → { sql, reasoning, tables } │
                    │  3. source.validate()  → 静态校验                    │
                    │        └─ 校验不过：错误回喂 → 重试（≤3 次）         │
                    │  4. source.query()     → 只读查询                    │
                    │  5. finalize(ctx)      → 总结成人类可读回答            │
                    └─────────────────────────────────────────────────────┘
                                          │
                          { answer, events, sql, rows }
```

## 何时生效

`src/agent/agent.ts` 对每个问题做路由：

- `route(question) === 'text2sql'` → **Text2SQL 管线**（取数 / 聚合类问题）
- `route(question) === 'agent'` → 原 **ReAct agent**（`run_sql` function calling，处理开放分析类问题，如「为什么 / 如何提升」…）

路由是 `router.ts` 里的关键词启发式（命中 `为什么`、`建议`、`如何` 等 → agent，其余 → text2sql）。桌面端和 CLI 都走 `ask()`，结果契约没变，**无需改动**。

## 文件结构

```
src/agent/text2sql/
├── datasource.ts    DataSource 契约 + 共享类型（SqlCheck, QueryResult）
├── introspect.ts    共享 introspection 渲染：表/列/PK/FK/行数/示例值 → prompt 文本（含截断与精选注释叠加）
├── sqlite.ts        SQLite 适配器（better-sqlite3）——实时 introspection 实现之一
├── postgres.ts      PostgreSQL 适配器（pg 兼容 client）——实时 introspection 实现之二
├── mysql.ts         MySQL 适配器（mysql2/promise 兼容 client）——实时 introspection 实现之三
├── schema.ts        精选电商 schema（列注释、取值域）——仅作注释叠加层
├── generator.ts     LLM 第 1 步：问题 + schema + 规则 → {sql, reasoning, tables}
├── finalize.ts      LLM 第 5 步：结果行 → 简洁中文回答
├── pipeline.ts      编排：生成 → 校验 → 查询 → 总结（含重试）
└── router.ts        问题 → 'text2sql' | 'agent'
```

## 实时 schema introspection

`describe()` 不再返回写死的表结构，而是每次从**真实数据库**读取，所以桌面端/CLI 配置
任意一个库（换 SQLite 文件、换 Postgres 连接串）都能生成对的 SQL。收集的内容：

- 表清单、每列的类型与主键（SQLite `sqlite_master`+`PRAGMA table_info`；
  Postgres `information_schema.columns`）
- 外键（SQLite `PRAGMA foreign_key_list`；Postgres `information_schema` 关联查询）
- 行数（SQLite `COUNT(*)`；Postgres 用 `pg_class.reltuples` 近似值，快）
- 每列 1-3 个**示例值**（各表 `LIMIT 3` 采样，帮助 LLM 理解枚举/单位/口径）

精心写的列注释（`schema.ts` / `postgres.ts` 的 `CRM_SCHEMA_SPEC`）会按表名/列名**叠加**
到 introspection 结果上——名字对得上就给语义注释，对不上就用纯 introspection，因此
内置演示库保留丰富中文注释，任意陌生库也能开箱即用。

输出受 `introspect.ts` 的 `INTROSPECT_LIMITS` 约束（≤25 表、每表 ≤30 列、总文本
≤8000 字符，超出截断），避免大库把 prompt 撑爆。SQLite 同步实现、Postgres 异步实现，
都符合 `describe(): string | Promise<string>` 契约。

LLM 侧（`generator` / `finalize`）通过 `Text2SqlDeps` **依赖注入**，所以管线可以不带
API key 做纯单元测试（`tests/text2sql.test.ts` 用 fake 实现）。

## DataSource 契约

抽象的意义就在这：`pipeline.ts` 从不直接碰任何数据库驱动。

```ts
export interface DataSource {
  dialect?: string                                   // 如 "SQLite"，用来引导生成器 prompt
  describe(): string | Promise<string>               // 可直接进 prompt 的 schema 知识
  validate(sql: string): SqlCheck                    // 静态校验 {ok} | {ok, error}
  query(sql: string, options?: { maxRows?: number }): Promise<QueryResult>
}
```

`query` 设计成异步，天然支持服务端型数据系统（Postgres/ClickHouse/REST 都是异步的）；
SQLite 适配器内部包一层 `Promise.resolve` 即可。`createSqliteSource(db)` 基于
`better-sqlite3` 实现：

- `validate` —— 只允许单条语句、只允许 `SELECT`（先剥掉 `--` / `/* */` 注释），再用
  SQLite `prepare()` 做表/列名解析，作为语法闸门。
- `query` —— 再次拦非 `SELECT`，结果行上限 200，返回
  `{ columns, rows, rowCount, truncated }`。

## 已落地示例：PostgreSQL CRM 客户管理

`src/agent/text2sql/postgres.ts` 是按 `DataSource` 契约写好的第二个适配器，示例业务是
CRM 客户管理。schema 不再写死，而是每次从目标库 introspection（`CRM_SCHEMA_SPEC`
只提供列注释叠加层），所以换个 Postgres 库也能直接用。

```ts
import { createPostgresSource } from './text2sql/postgres.js'
import pg from 'pg'

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL })
const source = createPostgresSource(pool)   // pg.Pool 自带 query() → { rows }

const r = await runText2Sql(source, '各行业已成交商机金额排名', deps)
```

- `dialect: 'PostgreSQL'` —— 生成器 prompt 自动注入方言。
- `validate` —— 用 `node-sql-parser` 离线解析，只放行 `SELECT`（UNION/WITH 属于
  `select`），拒写语句、拒多语句、拒语法错误，无需连库。
- `query` —— 真正连库执行，借用 client 的 `query()` 返回按行限流的结果，
  列名从首行反推。

已接入路由，可实际使用：

```bash
# 本地速跑：compose 起版本化 Postgres（Dockerfile + init 建表脚本在 docker/crm/）
docker compose -f docker/compose.yml up -d --build
export CRM_DATABASE_URL="postgres://postgres:postgres@127.0.0.1:5433/crm"   # .env 已内置
npm run crm-seed          # 自动建库 + 建表 + 灌确定性 mock 数据
npm run crm-ask -- "各行业已成交商机金额排名"
npm run crm-ask -- --json "本月新增商机各阶段分布"      # 桌面端同款 JSON 输出
```

入口是 `agent.ts` 的 `askCrm(client, question)` —— 与电商 `ask()` 共用同一个
Text2SQL 管线（`askText2Sql`）和 LLM deps，只是换了 `DataSource`。CLI
`src/cli/crmAsk.ts` 从 `CRM_DATABASE_URL` 连 `pg.Pool`；`src/cli/crmSeed.ts` 负责
建库/建表/种子（`companies/contacts/deals/activities`，数据来自
`src/db/crmSchema.ts` + `src/db/crmSeed.ts`）。

测试见 `tests/postgres.test.ts`：用一个 fake client（`{ query: async () => ({ rows }) }`）
即可覆盖校验、限流、列推导和完整的管线端到端，不需要真实 Postgres 服务。

> 接任意系统只需仿照上述两步：新建一个文件实现 3 个方法（可参考
> `sqlite.ts` 或 `postgres.ts`），再到 `agent.ts` 里替换数据源。管线、桌面端、测试
> 全部不用改。

> 接任意系统只需仿照上述两步：新建一个文件实现 3 个方法（可参考
> `sqlite.ts` 或 `postgres.ts`），再到 `agent.ts` 里替换数据源。管线、桌面端、测试
> 全部不用改——`pipeline: talks only to the DataSource interface` 这条测试把解耦锁死了。

## 第三个适配器：MySQL 图书借阅

`src/agent/text2sql/mysql.ts` 是同样的套路，示例业务是图书借阅
（`publishers / authors / books / members / borrows`）。client 约定放宽为
`query(sql, params?)`（mysql2/promise 的 `VALUES ?` 批量插入与它共用同一接口），
introspection 走 `information_schema`（`DATABASE()` 限定当前库，外键直接从
`key_column_usage.referenced_table_name` 拿，比 PG 少一重 JOIN），dialect 校验用
`node-sql-parser` 的 `MySQL`。

```bash
docker compose -f docker/compose.yml up -d mysqldb          # mysql:8.4，:3307
npm run mysql-seed          # 建表 + 灌确定性 mock 数据（~520 行）
npm run mysql-ask -- "各会员等级的平均借阅次数"
```

真实跑通截图里的链路：问「借出最多的5本图书」第一次生成 SQL 里 `books.author` 列
不存在 → `source.validate()`（prepare 解析）拒绝 → 错误回喂生成器 → `sql_fix`
重试一次就对了，全程只跑了一条确定性管线。

## 自修正

尝试次数有上限（`maxAttempts: 3`）。`validate` 或 `query` 拒绝一条 SQL 时，
`GenerateCtx.error` 会把失败原因带回生成器让它修正；每次修正记录为 `sql_fix` 事件，
桌面端会展示。全部尝试失败则抛 `text2sql failed after N attempts: …`。

## 测试

```bash
npm run test        # node:test + tsx，零测试框架依赖
npm run typecheck
```

已覆盖：introspection 渲染（行数 / 示例值 / FK / 注释叠加）、SQLite / PostgreSQL / MySQL
validate（仅 SELECT / 多语句 / 坏 SQL）、行数上限、路由、管线正常 / 重试 / 耗尽、
自修正、接口解耦、以及各适配器通过 fake client 的端到端。