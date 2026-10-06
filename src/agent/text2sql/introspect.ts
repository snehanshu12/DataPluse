import type { TableSpec } from './datasource.js'

/** Live-introspected metadata (adapter fills this from the real database). */
export interface IntrospectedColumn {
  name: string
  type: string
  pk?: boolean
  samples?: unknown[]
}

export interface IntrospectedTable {
  table: string
  rowCount?: number
  columns: IntrospectedColumn[]
}

/** Curated per-table semantics that overlay introspection when names match. */
export interface CuratedTable {
  comment: string
  columns: Map<string, string>
}

export const INTROSPECT_LIMITS = {
  maxTables: 25,
  maxColumnsPerTable: 30,
  sampleRows: 3,
  sampleValues: 3,
  maxChars: 8000,
}

/** Build a lookup (tablename → semantics) from a curated TableSpec list. */
export function buildCuratedLookup(specs: TableSpec[]): Map<string, CuratedTable> {
  const map = new Map<string, CuratedTable>()
  for (const t of specs) {
    map.set(t.table, {
      comment: t.comment,
      columns: new Map(t.columns.filter((c) => c.comment).map((c) => [c.name, c.comment as string])),
    })
  }
  return map
}

function summarize(value: unknown, maxLen = 24): string {
  const s = value == null ? '' : typeof value === 'string' ? value : JSON.stringify(value)
  if (s.length <= maxLen) return s
  return s.slice(0, maxLen) + '…'
}

function unique(values: unknown[], max: number): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const v of values) {
    const s = summarize(v)
    if (s && !seen.has(s)) {
      seen.add(s)
      out.push(s)
      if (out.length >= max) break
    }
  }
  return out
}

function quotedId(name: string): string {
  return `"${String(name).replace(/"/g, '""')}"`
}

/** Extract per-column sample values from a few sample rows. */
export function collectSamples(rows: Record<string, unknown>[], column: string, max = INTROSPECT_LIMITS.sampleValues): string[] {
  return unique(
    rows.map((r) => r[column]).filter((v) => v !== undefined && v !== null),
    max,
  )
}

/**
 * Render live schema knowledge into prompt text:
 * introspected tables/columns + row counts + sample values, with curated
 * comments (dialect + column semantics) overlaid where the names match.
 */
export function renderIntrospectedSchema(
  tables: IntrospectedTable[],
  fks: string[],
  curated?: Map<string, CuratedTable>,
  limits: typeof INTROSPECT_LIMITS = INTROSPECT_LIMITS,
): string {
  const lines: string[] = []
  let chars = 0
  let truncated = false

  const push = (...chunks: string[]) => {
    for (const line of chunks) {
      if (chars + line.length + 1 > limits.maxChars) {
        truncated = true
        return
      }
      lines.push(line)
      chars += line.length + 1
    }
  }

  for (const t of tables.slice(0, limits.maxTables)) {
    const c = curated?.get(t.table)
    const cols = t.columns.slice(0, limits.maxColumnsPerTable)
    const head = `(${cols.map((col) => `${col.name} ${col.type}${col.pk ? ' PK' : ''}`).join(', ')})`
    const count = t.rowCount != null ? ` · ${t.rowCount} 行` : ''
    push(`表 ${t.table}${head}${count}${c?.comment ? ` · ${c.comment}` : ''}`)
    for (const col of cols) {
      const remark = c?.columns.get(col.name)
      if (remark) push(`  - ${col.name}: ${remark}`)
      if (col.samples?.length) push(`    示例值: ${col.samples.join(' | ')}`)
    }
    if (truncated) break
  }

  if (fks.length) {
    push('')
    push('外键 / JOIN 提示:')
    push(...fks.map((f) => `  ${f}`))
  }
  if (truncated) push('… (schema 过长已截断)')

  if (lines.length === 0) return '(database has no tables)'
  return lines.join('\n')
}

export { quotedId }