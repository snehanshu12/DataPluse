import sqlParser from 'node-sql-parser'
import type { DataSource, QueryResult, SqlCheck, TableSpec } from './datasource.js'
import {
  buildCuratedLookup,
  collectSamples,
  renderIntrospectedSchema,
  INTROSPECT_LIMITS,
  type IntrospectedTable,
} from './introspect.js'

const parser = new sqlParser.Parser()

/** Read a row field under any key casing a driver may return (defensive). */
function rowKey(row: Record<string, unknown>, keys: string[]): unknown {
  for (const k of keys) {
    const v = row[k]
    if (v !== undefined && v !== null) return v
  }
  return undefined
}

/** CRM customer-management schema, curated like the e-commerce one. */
export const CRM_SCHEMA_SPEC: TableSpec[] = [
  {
    table: 'companies',
    comment: '客户公司（企业客户主档）',
    columns: [
      { name: 'id', type: 'INTEGER', comment: '主键' },
      { name: 'name', type: 'TEXT', comment: '公司名' },
      { name: 'industry', type: 'TEXT', comment: '行业，如 SaaS/制造业/零售/金融' },
      { name: 'employees', type: 'INTEGER', comment: '人数规模' },
      { name: 'city', type: 'TEXT', comment: '所在城市' },
      { name: 'created_at', type: 'TIMESTAMP', comment: '建档时间' },
    ],
  },
  {
    table: 'contacts',
    comment: '联系人',
    columns: [
      { name: 'id', type: 'INTEGER', comment: '主键' },
      { name: 'company_id', type: 'INTEGER', comment: '外键→companies.id' },
      { name: 'name', type: 'TEXT', comment: '姓名' },
      { name: 'email', type: 'TEXT', comment: '邮箱(唯一)' },
      { name: 'phone', type: 'TEXT', comment: '电话' },
      { name: 'title', type: 'TEXT', comment: '职位' },
    ],
  },
  {
    table: 'deals',
    comment: '商机/成交(成交金额看 amount，阶段看 stage)',
    columns: [
      { name: 'id', type: 'INTEGER', comment: '主键' },
      { name: 'company_id', type: 'INTEGER', comment: '外键→companies.id' },
      { name: 'contact_id', type: 'INTEGER', comment: '外键→contacts.id' },
      { name: 'amount', type: 'NUMERIC', comment: '商机金额(成交后计入营收)' },
      { name: 'stage', type: 'TEXT', comment: 'open/won/lost' },
      { name: 'close_date', type: 'DATE', comment: '预计/实际成交日' },
    ],
  },
  {
    table: 'activities',
    comment: '跟进记录',
    columns: [
      { name: 'id', type: 'INTEGER', comment: '主键' },
      { name: 'contact_id', type: 'INTEGER', comment: '外键→contacts.id' },
      { name: 'activity_type', type: 'TEXT', comment: 'call/email/meeting/demo' },
      { name: 'note', type: 'TEXT', comment: '跟进备注' },
      { name: 'happened_at', type: 'TIMESTAMP', comment: '跟进时间' },
    ],
  },
]

export const CRM_FOREIGN_KEYS = [
  'contacts.company_id   → companies.id',
  'deals.company_id      → companies.id',
  'deals.contact_id      → contacts.id',
  'activities.contact_id → contacts.id',
]

const curated = buildCuratedLookup(CRM_SCHEMA_SPEC)

/** PostgreSQL dialect check: parse with node-sql-parser, allow SELECT only. */
function validatePostgres(sql: string): SqlCheck {
  const trimmed = String(sql ?? '').trim()
  if (!trimmed) return { ok: false, error: 'empty SQL' }
  // single statement only — a ';' before the end implies trailing injection
  if (!/;\s*$/.test(trimmed) && trimmed.includes(';')) {
    return { ok: false, error: 'multiple statements are not allowed' }
  }
  try {
    const ast = parser.astify(trimmed, { database: 'PostgresQL' })
    const type = Array.isArray(ast) ? ast[0]?.type : ast?.type
    if (type !== 'select') {
      return { ok: false, error: 'only SELECT statements are allowed' }
    }
    return { ok: true }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) }
  }
}

export interface PgClient {
  query(sql: string): Promise<{ rows: Record<string, unknown>[] }>
}

async function runPgQuery(client: PgClient, sql: string, options: { maxRows?: number } = {}): Promise<QueryResult> {
  if (!/^\s*select\b/i.test(sql.trim())) {
    throw new Error('only SELECT statements are allowed')
  }
  const maxRows = options.maxRows ?? 200
  const { rows } = await client.query(sql)
  const all = rows as Record<string, unknown>[]
  const sliced = all.slice(0, maxRows)
  const columns = sliced.length ? Object.keys(sliced[0]!) : all.length ? Object.keys(all[0]!) : []
  return { columns, rows: sliced, rowCount: all.length, truncated: all.length > maxRows }
}

/**
 * Introspect the live schema via information_schema: tables, columns, PKs,
 * FKs, approximate row counts (pg_class) and a few sample rows per table.
 */
async function introspectPostgres(client: PgClient): Promise<string> {
  const limit = INTROSPECT_LIMITS

  const tableRows = (await client.query(
    `SELECT table_name AS t FROM information_schema.tables WHERE table_schema='public' AND table_type='BASE TABLE'`,
  )).rows as Record<string, unknown>[]

  const columnRows = (await client.query(
    `SELECT table_name AS t, column_name AS c, data_type AS ty, is_nullable AS n
     FROM information_schema.columns WHERE table_schema='public'`,
  )).rows as Record<string, unknown>[]

  const fkRows = (await client.query(
    `SELECT tc.table_name AS t, kcu.column_name AS c, ccu.table_name AS rt, ccu.column_name AS rc
     FROM information_schema.table_constraints tc
     JOIN information_schema.key_column_usage kcu
       ON tc.constraint_name = kcu.constraint_name AND tc.table_schema = kcu.table_schema
     JOIN information_schema.constraint_column_usage ccu
       ON ccu.constraint_name = tc.constraint_name AND ccu.table_schema = tc.table_schema
     WHERE tc.constraint_type = 'FOREIGN KEY' AND tc.table_schema = 'public'`,
  )).rows as Record<string, unknown>[]

  const pkRows = (await client.query(
    `SELECT tc.table_name AS t, kcu.column_name AS c
     FROM information_schema.table_constraints tc
     JOIN information_schema.key_column_usage kcu
       ON tc.constraint_name = kcu.constraint_name AND tc.table_schema = kcu.table_schema
     WHERE tc.constraint_type = 'PRIMARY KEY' AND tc.table_schema = 'public'`,
  )).rows as Record<string, unknown>[]

  const countRows = (await client.query(
    `SELECT relname AS t, reltuples::bigint AS n
     FROM pg_class c JOIN pg_namespace ns ON ns.oid = c.relnamespace
     WHERE ns.nspname = 'public' AND c.relkind = 'r'`,
  )).rows as Record<string, unknown>[]

  const counts = new Map(countRows.map((r) => [r.t, r.n]))
  const pks = new Map<string, Set<string>>()
  for (const r of pkRows) {
    if (!pks.has(String(r.t))) pks.set(String(r.t), new Set())
    pks.get(String(r.t))!.add(String(r.c))
  }
  const columnsByTable = new Map<string, Record<string, unknown>[]>()
  for (const r of columnRows) {
    const t = String(r.t)
    if (!columnsByTable.has(t)) columnsByTable.set(t, [])
    columnsByTable.get(t)!.push(r)
  }

  const built: IntrospectedTable[] = []
  const fks = new Set<string>(CRM_FOREIGN_KEYS)
  for (const r of tableRows.slice(0, limit.maxTables)) {
    const t = String(rowKey(r, ['t', 'table_name', 'TABLE_NAME']) ?? '')
    const cols = (columnsByTable.get(t) ?? []).slice(0, limit.maxColumnsPerTable)
    let sampleRows: Record<string, unknown>[] = []
    try {
      const sel = cols.slice(0, 20).map((c) => String(c.c)).join(', ')
      if (sel) {
        const r = await client.query(`SELECT ${sel} FROM "${t}" LIMIT ${limit.sampleRows}`)
        sampleRows = r.rows as Record<string, unknown>[]
      }
    } catch {
      // sampling is best-effort — a weird column type must not break the schema
    }
    for (const r of fkRows) {
      if (r.t === t) fks.add(`${t}.${r.c} → ${r.rt}.${r.rc}`)
    }
    built.push({
      table: t,
      rowCount: typeof counts.get(t) === 'number' ? (counts.get(t) as number) : undefined,
      columns: cols.map((c) => ({
        name: String(c.c),
        type: String(c.ty),
        pk: pks.get(t)?.has(String(c.c)),
        samples: collectSamples(sampleRows, String(c.c)),
      })),
    })
  }
  return renderIntrospectedSchema(built, [...fks], curated)
}

/** Cache the rendered schema per client with a short TTL: server-side sources
 *  have no cheap mtime to key on, so a 60s window amortizes the full
 *  information_schema sweep across back-to-back asks without going stale. */
const describeCache = new WeakMap<object, { at: number; schema: string }>()
const DESCRIBE_TTL_MS = 60_000

function cachedDescribe(client: object, fn: () => Promise<string>): Promise<string> {
  const hit = describeCache.get(client)
  if (hit && Date.now() - hit.at < DESCRIBE_TTL_MS) return Promise.resolve(hit.schema)
  return fn().then((schema) => {
    describeCache.set(client, { at: Date.now(), schema })
    return schema
  })
}

/**
 * PostgreSQL adapter. Pass any client exposing `query()` — e.g. `pg.Pool`,
 * `pg.Client`, or a fake in tests. Schema is introspected live (cached briefly).
 */
export function createPostgresSource(client: PgClient): DataSource {
  return {
    dialect: 'PostgreSQL',
    describe: () => cachedDescribe(client, () => introspectPostgres(client)),
    validate: (sql) => validatePostgres(sql),
    query: (sql, options) => runPgQuery(client, sql, options),
  }
}