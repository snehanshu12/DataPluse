/** Contract every backing data system must satisfy to feed the Text2SQL pipeline. */

export type SqlCheck = { ok: true } | { ok: false; error: string }

export interface QueryResult {
  columns: string[]
  rows: Record<string, unknown>[]
  rowCount: number
  truncated: boolean
}

export interface ColumnSpec {
  name: string
  type: string
  comment?: string
}

export interface TableSpec {
  table: string
  comment: string
  columns: ColumnSpec[]
}

export interface DataSource {
  /** SQL dialect label used to steer the generator prompt. */
  dialect?: string
  /** Prompt-ready description of the data model (schema + semantics). */
  describe(): string | Promise<string>
  /** Dialect-aware static checks before execution. */
  validate(sql: string): SqlCheck
  /** Execute a (pre-validated) read-only query. Async — supports server-side systems. */
  query(sql: string, options?: { maxRows?: number }): Promise<QueryResult>
}

/** Render a curated schema spec into prompt-friendly text (shared by all adapters). */
export function renderSchema(spec: TableSpec[], fks: string[]): string {
  const tableLines = spec.map((t) => {
    const cols = `(${t.columns.map((c) => `${c.name} ${c.type}`).join(', ')})`
    const annotated = t.columns
      .filter((c) => c.comment)
      .map((c) => `  - ${c.name}: ${c.comment}`)
      .join('\n')
    return `${t.table}${cols} — ${t.comment}${annotated ? `\n${annotated}` : ''}`
  })
  return [...tableLines, '', 'FOREIGN KEYS (JOIN hints):', ...fks].join('\n')
}