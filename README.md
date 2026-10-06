# DataPulse

An AI BI studio for data analytics: plug in a **SQLite / CSV / PostgreSQL / MySQL**
source, ask business questions in plain language, and the **LLM agent** writes
read-only SQL, answers from the real data, and can **auto-generate ECharts
dashboards**.

> [Chinese version](README.zh.md)

## Quick start

```bash
npm install
cp .env.example .env   # fill in your LLM_API_KEY
npm run seed           # create data/ecommerce.db (~6k orders)
npm run desktop        # launch the desktop UI
```

> **Demo data is generated, not committed.** `data/` and `*.db` are gitignored —
> a fresh clone ships without `data/ecommerce.db` (or imported DBs), so run
> `npm run seed` (or `make init`) to build it. See [Data & generated artifacts](#data--generated-artifacts).

## Commands

| Command | Description |
| --- | --- |
| `npm run seed` | (Re)generate the mock database. Tune size via `SEED_ORDERS`, `SEED_CUSTOMERS`, `SEED_PRODUCTS_PER_CATEGORY`, `SEED_MAX_ITEMS`, `SEED_VALUE` env vars. |
| `npm run ask -- "question"` | Ask the agent a business question. It writes SQL, queries the DB, and answers. |
| `npm run crm-ask -- "question"` | Same ask flow against a PostgreSQL CRM database (needs `CRM_DATABASE_URL` env). |
| `npm run crm-seed` | Create + fill the CRM database (`companies/contacts/deals/activities`) on `CRM_DATABASE_URL`. |
| `npm run mysql-ask -- "question"` | Same ask flow against a MySQL library database (needs `MYSQL_DATABASE_URL` env). |
| `npm run mysql-seed` | Create + fill the MySQL library database (`publishers/authors/books/members/borrows`) on `MYSQL_DATABASE_URL`. |
| `npm run csv-import -- <csv> [table]` | Import a CSV into a local SQLite db under `data/imported/` (first row = headers, types auto-inferred). |
| `npm run starters` | Generate the 6 suggested starter questions against the live schema (cached by schema fingerprint; `--force` regenerates). |
| `npm run dashboard -- "description"` | The agent designs charts, queries the data, and renders a standalone `output/dashboard-<ts>.html` (open in a browser). |
| `npm test` | Run the unit tests (no network, no database, no API key required). |
| `npm run typecheck` | TypeScript check (root + tests + desktop). |
| `npm run desktop` | Launch the desktop UI (Electron) for the `ask` feature. |

The desktop relies on `--json`-mode CLI output (`ask`, `starters`, `preview`,
`dashboard`, `csv-import`); each CLI entry can be run standalone with
`npx tsx <src/cli/entry.ts> --json …` for debugging.

### Desktop UI (Electron)

The `desktop/` folder holds an Electron console (Vite + React). The main
process shells out to the Node CLI (`--json` mode, always `shell:false`) and
the renderer shows the Q&A, the SQL the agent ran, the answer, and generated
charts. Highlights:

- **Data-source switcher** in the sidebar (SQLite / PostgreSQL / MySQL / imported
  CSV), plus a **draggable resize handle** for the sidebar width (persisted).
- **Starter questions** are generated on demand against the live schema (loading
  spinner while they generate, results cached by schema fingerprint). A
  **"↻ Regenerate"** button re-runs generation with `--force`. The chip list is
  guaranteed to contain a chart question so the dashboard feature stays reachable.
- **Follow-up question chips** after each answer (with a chart intent one).
- **Dashboard cards** render inline with ECharts and include a **"⛶ Fullscreen"**
  button (ESC / ✕ to close).
- **Privacy**: answer copy is gated behind a re-confirm when the answer is
  flagged as risky; connection strings are **redacted** in the UI
  (`postgres://***@host:port/db`) — passwords are never painted on screen.
- A ⚙ dialog (toolbar) edits LLM (base URL / API key / model) and source
  connection settings. Values are persisted to `settings.json` in Electron's
  userData dir (written atomically, `0600`) and override `.env` at ask time;
  empty fields fall back to `.env`. A single-instance lock prevents two
  instances from racing that file.

```bash
npm install              # project root
npm install --prefix desktop
npm run desktop          # from the project root
```

### CRM (PostgreSQL) demo

Lift the versioned Postgres (Dockerfile + compose under `docker/`), seed it, and ask:

```bash
docker compose -f docker/compose.yml up -d --build   # postgres on :5433, auto schema via init/
export CRM_DATABASE_URL="postgres://postgres:postgres@127.0.0.1:5433/crm"  # also in .env
npm run crm-seed          # auto-creates the DB + tables, inserts ~460 rows
npm run crm-ask -- "closed deal amount ranking by industry"
```

`crm-seed` also creates the database if missing and re-seeds deterministically.
Tear down with `docker compose -f docker/compose.yml down` (add `-v` to wipe the data volume).

### MySQL library demo

Lift the MySQL service (`docker/compose.yml`), seed it, and ask:

```bash
docker compose -f docker/compose.yml up -d mysqldb       # mysql:8.4 on :3307, auto-creates `library`
export MYSQL_DATABASE_URL="mysql://root:root@127.0.0.1:3307/library"  # also in .env
npm run mysql-seed          # auto-creates tables, inserts ~520 rows
npm run mysql-ask -- "top 5 most-borrowed books"
```

Every source uses the **same Text2SQL pipeline** with live schema introspection
(`mysql.ts` reads `information_schema` like `postgres.ts`), so any existing
MySQL / PostgreSQL schema — not just the demo — works out of the box. Schema
introspection is cached (mtime-based for SQLite, 60s TTL for servers).

### CSV import

```bash
npm run csv-import -- path/to/file.csv
npm run csv-import -- path/to/file.csv MyTableName
```

The file's first row becomes column headers (duplicates get `_2`/`_3` suffixes),
column types (INTEGER/REAL/TEXT) are inferred from the data, and everything is
written into `data/imported/<table>.db`. The default table name is
`<parent-dir>_<filename>` so identically-named files from different folders stay
distinct. The resulting source appears in the desktop UI automatically.

### Examples

```bash
npm run ask -- "which category generated the most revenue in the last 3 months?"
npm run ask -- "month-over-month growth of completed orders"
npm run dashboard -- "monthly revenue trend, revenue share by category, top 5 cities, top products"
```

## Configuration

Environment (via `.env`):

| Var | Default | Description |
| --- | --- | --- |
| `LLM_BASE_URL` | `https://api.openai.com/v1` | OpenAI-compatible endpoint. Works with DeepSeek (`https://api.deepseek.com`), Volcengine Ark, OpenAI, etc. |
| `LLM_API_KEY` | — | API key (required for real queries; tests do **not** need it). |
| `LLM_MODEL` | `gpt-4o-mini` | Model id, e.g. `deepseek-chat`, `doubao-seed-1-6-250615`. |
| `DB_PATH` | `data/ecommerce.db` | SQLite file path (relative to project root). |
| `CRM_DATABASE_URL` | — | Postgres connection string for the CRM demo / any Postgres. |
| `MYSQL_DATABASE_URL` | — | MySQL connection string for the library demo / any MySQL. |

## Data model

`categories`, `customers`, `products`, `orders`, `order_items` — 12 months of mock history in `data/ecommerce.db`.

## Data & generated artifacts

- Everything under `data/` (`ecommerce.db`, `imported/*.db`, `starters-cache.json`)
  and `output/` is **generated** and gitignored — never committed.
- Fresh clone? `make init` installs deps and runs `npm run seed` in one step.
- Cleanup: `make db-remove` deletes only the demo db; `make reset` wipes +
  regenerates it; `make clean` removes `dist/`, `data/` and `output/`.

## Architecture

> Full architecture (layers, data flow, caching, security boundaries): [`docs/architecture.md`](docs/architecture.md). Text2SQL pipeline design: [`docs/text2sql.md`](docs/text2sql.md).

```
src/
├── config.ts            env / paths
├── db/
│   ├── schema.ts        e-commerce schema + mock vocab
│   ├── seed.ts          deterministic mock data generator
│   └── database.ts      SQLite init + schema introspection for the LLM
├── agent/
│   ├── llm.ts           lazy OpenAI-compatible client + tool-calling agent loop + follow-up suggestions
│   ├── sqlTool.ts       read-only SQL execution guard for the ReAct agent
│   ├── agent.ts         "ask" entry: routes to Text2SQL or the ReAct agent
│   └── text2sql/        deterministic Text2SQL pipeline (see docs/text2sql.md)
│       ├── datasource.ts  DataSource contract (dialect-agnostic)
│       ├── introspect.ts  shared live-schema introspection → prompt text
│       ├── sqlite.ts      SQLite adapter (streaming reads, mtime-cached introspection)
│       ├── postgres.ts    PostgreSQL adapter (CRM, node-sql-parser, TTL-cached introspection)
│       ├── mysql.ts       MySQL adapter (library, node-sql-parser, TTL-cached introspection)
│       ├── schema.ts      curated comments overlay (e-commerce + CRM + MySQL)
│       ├── generator.ts   question → SQL (JSON, self-validated)
│       ├── finalize.ts    rows → answer
│       ├── pipeline.ts    generate → validate → query → finalize (+ self-correction)
│       └── router.ts      data questions → text2sql, analysis → agent
├── bi/
│   ├── types.ts         dashboard/chart spec types + sanitizer
│   ├── render.ts        spec -> ECharts HTML page (self-contained + CDN ECharts)
│   └── generate.ts      "dashboard" agent (queries + emits JSON spec)
├── import/
│   └── csvImport.ts     CSV → SQLite (type inference, dup headers, batches)
└── cli/                 seed / ask / starters / dashboard / csv-import / preview entry points
desktop/                 Electron UI (Vite + React): chat, dashboard cards, starters
docs/text2sql.md         Text2SQL pipeline design notes
```

The agent is given the live schema, chooses charts, runs read-only `SELECT`s
(row caps: 200 for asks, 500 for dashboard design — the model previews only 60 rows
back), and emits a JSON dashboard spec that is sanitized and rendered to a
self-contained HTML file.

> For data-retrieval questions the `ask` flow uses the **Text2SQL pipeline** instead of
> the agent loop: dedicated SQL generation + code-level validation + self-correction.
> See [`docs/text2sql.md`](docs/text2sql.md).

## Security notes

- The SQL tool rejects anything that isn't a **single** `SELECT` (no writes, no
  `PRAGMA` mutations); leading comments are stripped before the statement check.
- `.env` and `data/` are gitignored; the desktop `settings.json` (which may hold
  the API key) is written atomically with `0600` permissions.
- Connection URLs are redacted before they reach the UI — credentials never
  render, even in screenshots or share-screen.
- The desktop spawns the CLI with `shell:false` and bounds/type-checks every IPC
  argument; a timeout kills the hung child process instead of leaving it running.
- Dashboard HTML is a local file; it loads ECharts from `cdn.jsdelivr.net`.

## Related Articles
- [Text2SQL Deterministic Pipeline + ReAct Dual-Path: Architecture Breakdown of datapulse AI BI Workbench](https://erishen.cn/datapulse-en/)
