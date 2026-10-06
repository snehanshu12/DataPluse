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

/** Read a row field under any key casing a driver may return (MySQL 8 returns
 *  unaliased information_schema labels UPPERCASED on case-insensitive fs). */
function rowKey(row: Record<string, unknown>, keys: string[]): unknown {
  for (const k of keys) {
    const v = row[k]
    if (v !== undefined && v !== null) return v
  }
  return undefined
}

/** Library demo schema — curated comments overlay live introspection by name. */
export const MYSQL_DEMO_SPEC: TableSpec[] = [
  {
    table: 'publishers',
    comment: '出版社',
    columns: [
      { name: 'id', type: 'INT', comment: '主键' },
      { name: 'name', type: 'VARCHAR(100)', comment: '出版社名' },
      { name: 'city', type: 'VARCHAR(50)', comment: '所在城市' },
      { name: 'founded_year', type: 'SMALLINT', comment: '成立年份' },
    ],
  },
  {
    table: 'authors',
    comment: '作者',
    columns: [
      { name: 'id', type: 'INT', comment: '主键' },
      { name: 'name', type: 'VARCHAR(50)', comment: '作者名' },
      { name: 'country', type: 'VARCHAR(50)', comment: '国籍' },
    ],
  },
  {
    table: 'books',
    comment: '图书（定价看 price，库存看 stock）',
    columns: [
      { name: 'id', type: 'INT', comment: '主键' },
      { name: 'isbn', type: 'VARCHAR(20)', comment: 'ISBN(唯一)' },
      { name: 'title', type: 'VARCHAR(200)', comment: '书名' },
      { name: 'category', type: 'VARCHAR(50)', comment: '分类，如 小说/科技/历史/少儿' },
      { name: 'price', type: 'DECIMAL(8,2)', comment: '定价' },
      { name: 'stock', type: 'INT', comment: '库存' },
      { name: 'author_id', type: 'INT', comment: '外键→authors.id' },
      { name: 'publisher_id', type: 'INT', comment: '外键→publishers.id' },
      { name: 'published_at', type: 'DATE', comment: '出版日期' },
    ],
  },
  {
    table: 'members',
    comment: '读者/会员',
    columns: [
      { name: 'id', type: 'INT', comment: '主键' },
      { name: 'name', type: 'VARCHAR(50)', comment: '姓名' },
      { name: 'email', type: 'VARCHAR(100)', comment: '邮箱(唯一)' },
      { name: 'city', type: 'VARCHAR(50)', comment: '所在城市' },
      { name: 'level', type: 'VARCHAR(20)', comment: '会员等级 basic/plus/pro' },
      { name: 'joined_at', type: 'DATE', comment: '入馆日期' },
    ],
  },
  {
    table: 'borrows',
    comment: '借阅记录（未还看 returned_at 为空，逾期看 due_date）',
    columns: [
      { name: 'id', type: 'INT', comment: '主键' },
      { name: 'book_id', type: 'INT', comment: '外键→books.id' },
      { name: 'member_id', type: 'INT', comment: '外键→members.id' },
      { name: 'borrowed_at', type: 'DATETIME', comment: '借出时间' },
      { name: 'due_date', type: 'DATE', comment: '应还日期' },
      { name: 'returned_at', type: 'DATETIME', comment: '归还时间(未还为空)' },
    ],
  },
]

export const MYSQL_FOREIGN_KEYS = [
  'books.author_id    → authors.id',
  'books.publisher_id → publishers.id',
  'borrows.book_id    → books.id',
  'borrows.member_id  → members.id',
]

const curated = buildCuratedLookup(MYSQL_DEMO_SPEC)

/** MySQL dialect check: parse with node-sql-parser, allow SELECT only. */
function validateMysql(sql: string): SqlCheck {
  const trimmed = String(sql ?? '').trim()
  if (!trimmed) return { ok: false, error: 'empty SQL' }
  // single statement only — a ';' before the end implies trailing injection
  if (!/;\s*$/.test(trimmed) && trimmed.includes(';')) {
    return { ok: false, error: 'multiple statements are not allowed' }
  }
  try {
    const ast = parser.astify(trimmed, { database: 'MySQL' })
    const type = Array.isArray(ast) ? ast[0]?.type : ast?.type
    if (type !== 'select') {
      return { ok: false, error: 'only SELECT statements are allowed' }
    }
    return { ok: true }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) }
  }
}

export interface MySqlClient {
  /** params optional so mysql2 bulk `VALUES ?` seeding shares the same interface. */
  query(sql: string, params?: unknown[]): Promise<{ rows: Record<string, unknown>[] }>
}

async function runMysqlQuery(client: MySqlClient, sql: string, options: { maxRows?: number } = {}): Promise<QueryResult> {
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

function backtick(name: string): string {
  return `\`${String(name).replace(/`/g, '``')}\``
}

/**
 * Introspect the live schema via information_schema (current database): tables,
 * columns, PKs, FKs, approximate row counts, and a few sample rows per table.
 */
async function introspectMysql(client: MySqlClient): Promise<string> {
  const limit = INTROSPECT_LIMITS
  const db = `DATABASE()`

  const tableRows = (await client.query(
    `SELECT table_name AS t FROM information_schema.tables WHERE table_schema = ${db} AND table_type = 'BASE TABLE'`,
  )).rows as Record<string, unknown>[]

  const columnRows = (await client.query(
    `SELECT table_name AS t, column_name AS c, data_type AS ty, is_nullable AS n
     FROM information_schema.columns WHERE table_schema = ${db}`,
  )).rows as Record<string, unknown>[]

  const fkRows = (await client.query(
    `SELECT table_name AS t, column_name AS c, referenced_table_name AS rt, referenced_column_name AS rc
     FROM information_schema.key_column_usage
     WHERE table_schema = ${db} AND referenced_table_name IS NOT NULL`,
  )).rows as Record<string, unknown>[]

  const pkRows = (await client.query(
    `SELECT table_name AS t, column_name AS c
     FROM information_schema.key_column_usage
     WHERE table_schema = ${db} AND constraint_name = 'PRIMARY'`,
  )).rows as Record<string, unknown>[]

  const countRows = (await client.query(
    `SELECT table_name AS t, table_rows AS n
     FROM information_schema.tables WHERE table_schema = ${db}`,
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
  const fks = new Set<string>(MYSQL_FOREIGN_KEYS)
  for (const r of tableRows.slice(0, limit.maxTables)) {
    const t = String(rowKey(r, ['t', 'table_name', 'TABLE_NAME']) ?? '')
    const cols = (columnsByTable.get(t) ?? []).slice(0, limit.maxColumnsPerTable)
    let sampleRows: Record<string, unknown>[] = []
    try {
      const sel = cols.slice(0, 20).map((c) => String(c.c)).join(', ')
      if (sel) {
        const r = await client.query(`SELECT ${sel} FROM ${backtick(t)} LIMIT ${limit.sampleRows}`)
        sampleRows = r.rows as Record<string, unknown>[]
      }
    } catch {
      // sampling is best-effort
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
 * MySQL adapter. Pass any client exposing `query()` — e.g. a `mysql2/promise`
 * pool/connection, or a fake in tests. Schema is introspected live (cached briefly).
 */
export function createMysqlSource(client: MySqlClient): DataSource {
  return {
    dialect: 'MySQL',
    describe: () => cachedDescribe(client, () => introspectMysql(client)),
    validate: (sql) => validateMysql(sql),
    query: (sql, options) => runMysqlQuery(client, sql, options),
  }
}
