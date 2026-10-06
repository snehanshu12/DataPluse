import fs from 'node:fs'
import Database from 'better-sqlite3'
import type { DataSource, QueryResult, SqlCheck } from './datasource.js'
import { SCHEMA_SPEC, FOREIGN_KEYS } from './schema.js'
import {
  collectSamples,
  quotedId,
  renderIntrospectedSchema,
  buildCuratedLookup,
  INTROSPECT_LIMITS,
  type IntrospectedTable,
} from './introspect.js'

const curated = buildCuratedLookup(SCHEMA_SPEC)

/** Strip leading SQL comments so the statement-type check starts at real SQL. */
function stripComments(sql: string): string {
  let s = sql
  for (;;) {
    const trimmed = s.replace(/^\s+/, '')
    if (trimmed.startsWith('--')) {
      const nl = trimmed.indexOf('\n')
      s = nl < 0 ? '' : trimmed.slice(nl + 1)
    } else if (trimmed.startsWith('/*')) {
      const end = trimmed.indexOf('*/')
      if (end < 0) return ''
      s = trimmed.slice(end + 2)
    } else {
      break
    }
  }
  return s
}

function validateSqlite(db: Database.Database, sql: string): SqlCheck {
  const trimmed = String(sql ?? '').trim()
  if (!trimmed) return { ok: false, error: 'empty SQL' }
  // single statement only — a ';' before the end implies trailing injection
  if (!/;\s*$/.test(trimmed) && trimmed.includes(';')) {
    return { ok: false, error: 'multiple statements are not allowed' }
  }
  const body = stripComments(trimmed)
  if (!/^\s*select\b/i.test(body)) {
    return { ok: false, error: 'only SELECT statements are allowed' }
  }
  try {
    db.prepare(body)
    return { ok: true }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) }
  }
}

function runSqliteQuery(
  db: Database.Database,
  sql: string,
  options: { maxRows?: number } = {},
): QueryResult {
  if (!/^\s*select\b/i.test(sql.trim())) {
    throw new Error('only SELECT statements are allowed')
  }
  const maxRows = options.maxRows ?? 200
  const stmt = db.prepare(sql)
  // Stream row-by-row and stop once we've seen maxRows + 1: big tables never
  // get materialized in memory just to be sliced afterwards.
  const rows: Record<string, unknown>[] = []
  let extra = 0
  for (const row of stmt.iterate() as IterableIterator<Record<string, unknown>>) {
    if (rows.length < maxRows) rows.push(row)
    else extra++
  }
  return {
    columns: stmt.columns().map((c) => c.name),
    rows,
    rowCount: rows.length + extra,
    truncated: extra > 0,
  }
}

/** Introspect the live schema (tables, columns, PKs, FKs, row counts, samples). */
function introspectSqlite(db: Database.Database): string {
  const tables = db
    .prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name`)
    .all() as { name: string }[]

  const built: IntrospectedTable[] = []
  const fks = new Set<string>(FOREIGN_KEYS)
  for (const { name } of tables.slice(0, INTROSPECT_LIMITS.maxTables)) {
    const cols = db.prepare(`PRAGMA table_info(${quotedId(name)})`).all() as {
      name: string
      type: string
      pk: number
    }[]
    const rowCount = (db.prepare(`SELECT COUNT(*) AS c FROM ${quotedId(name)}`).get() as { c: number }).c
    const sampleRows =
      rowCount > 0
        ? (db.prepare(`SELECT * FROM ${quotedId(name)} LIMIT ${INTROSPECT_LIMITS.sampleRows}`).all() as Record<
            string,
            unknown
          >[])
        : []
    for (const fk of db
      .prepare(`PRAGMA foreign_key_list(${quotedId(name)})`)
      .all() as { table: string; from: string; to: string }[]) {
      fks.add(`${name}.${fk.from} → ${fk.table}.${fk.to}`)
    }
    built.push({
      table: name,
      rowCount,
      columns: cols
        .slice(0, INTROSPECT_LIMITS.maxColumnsPerTable)
        .map((c) => ({ name: c.name, type: c.type || 'unknown', pk: c.pk === 1, samples: collectSamples(sampleRows, c.name) })),
    })
  }
  return renderIntrospectedSchema(built, [...fks], curated)
}

/** SQLite adapter: schemas are introspected live, wrapped behind the DataSource contract.
 *  describe() is cached per db file until its mtime changes, so repeated asks
 *  over the same import don't re-scan every table (COUNT(*) on big CSVs is costly). */
const describeCache = new WeakMap<Database.Database, { mtimeMs: number; schema: string }>()

export function createSqliteSource(db: Database.Database): DataSource {
  return {
    dialect: 'SQLite',
    describe: () => {
      const cached = describeCache.get(db)
      let mtimeMs = -1
      try {
        mtimeMs = fs.statSync(db.name).mtimeMs
      } catch {
        // unreadable meta — skip caching, introspect fresh
      }
      if (cached && cached.mtimeMs === mtimeMs) return Promise.resolve(cached.schema)
      const schema = introspectSqlite(db)
      describeCache.set(db, { mtimeMs, schema })
      return Promise.resolve(schema)
    },
    validate: (sql) => validateSqlite(db, sql),
    query: (sql, options) => Promise.resolve(runSqliteQuery(db, sql, options)),
  }
}

/**
 * Open an existing SQLite db read-only and WITHOUT touching its schema.
 * A missing file then errors loudly instead of silently creating an empty db,
 * and initDatabase()'s e-commerce SCHEMA_SQL is never applied to real files.
 */
export function openSqliteDatabase(dbPath: string): Database.Database {
  return new Database(dbPath, { readonly: true })
}