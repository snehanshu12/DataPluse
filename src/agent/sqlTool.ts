import Database from 'better-sqlite3'

/**
 * Read-only SQL execution guard for the agent's database tool.
 * Blocks writes and caps row/statement counts so the LLM cannot blow up the process.
 */
export function createQueryTool(db: Database.Database, options: { maxRows?: number } = {}) {
  const maxRows = options.maxRows ?? 200

  return {
    name: 'run_sql',
    description:
      'Run a read-only SQL SELECT query against the connected database and return the result as JSON.',
    parameters: {
      type: 'object',
      properties: {
        sql: { type: 'string', description: 'A SELECT query. Aggregate with GROUP BY for summaries.' },
      },
      required: ['sql'],
    },
    async execute(args: Record<string, unknown>): Promise<string> {
      const trimmed = String(args.sql ?? '').trim()
      if (!trimmed) throw new Error('empty SQL')
      const sql = stripLeadingComments(trimmed)
      // single statement only — a ';' before the end implies trailing injection
      if (!/;\s*$/.test(sql) && sql.includes(';')) throw new Error('multiple statements are not allowed')
      if (!/^\s*select\b/i.test(sql)) throw new Error('Only SELECT statements are allowed')
      const stmt = db.prepare(sql)
      const rows = stmt.all() as Record<string, unknown>[]
      const sliced = rows.slice(0, maxRows)
      const result = {
        rowCount: rows.length,
        truncated: rows.length > maxRows,
        columns: stmt.columns().map((c) => c.name),
        rows: sliced,
      }
      return JSON.stringify(result)
    },
  }
}

/** Strip leading SQL comments so the statement-type check starts at real SQL. */
function stripLeadingComments(sql: string): string {
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
      return trimmed
    }
  }
}

export function countTables(db: Database.Database): Record<string, number> {
  const out: Record<string, number> = {}
  const tables = db
    .prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'`)
    .all() as { name: string }[]
  for (const { name } of tables) {
    try {
      out[name] = (db.prepare(`SELECT COUNT(*) AS c FROM "${name.replace(/"/g, '""')}"`).get() as { c: number }).c
    } catch {
      // a weird table must not break the overview
    }
  }
  return out
}