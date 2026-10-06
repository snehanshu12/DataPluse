import type { DataSource } from '../agent/text2sql/datasource.js'
import { runAgent, extractJsonMarkdown, type ChatMessage, type ToolDef } from '../agent/llm.js'
import { sanitizeDashboardSpec, type DashboardSpec } from './types.js'

const chartDefs: ToolDef[] = [
  {
    type: 'function',
    function: {
      name: 'run_sql',
      description: 'Run a read-only SQL query against the connected database and return the result as JSON.',
      parameters: {
        type: 'object',
        properties: { sql: { type: 'string', description: 'A SELECT query. Aggregate with GROUP BY for summaries.' } },
        required: ['sql'],
      },
    },
  },
]

/** Prompt that steers the dashboard designer agent. DataSource-agnostic: schema
 *  and dialect come from the live source, so user-imported tables or PG/MySQL
 *  sources get correct context instead of the old hard-coded seed schema. */
function dashboardSystemPrompt(source: DataSource, request: string): string {
  return [
    'You are a BI dashboard designer.',
    'The user wants a dashboard about: ' + request,
    '',
    'First, use run_sql to fetch ALL data needed for the charts (1-4 queries).',
    'Then output ONE JSON code block (```json ... ```) with NO extra prose.',
    '',
    `This is a ${source.dialect ?? 'SQL'} database.`,
    '',
    'Schema:',
    source.describe(),
    '',
    'The JSON must match exactly:',
    `{
  "title": "dashboard title",
  "summary": "1-3 sentence business insight",
  "charts": [
    {
      "id": "chart-1",
      "type": "line | bar | pie | scatter",
      "title": "chart title",
      "labels": ["cat1", "cat2", "..."],
      "series": [ { "name": "Series name", "values": [1, 2, 3] } ]
    }
  ]
}`,
    '',
    'Rules:',
    '- Every number (labels, values) MUST come from actual query results. Never fabricate.',
    '- pie: exactly one series, values sum to a meaningful total (e.g. share by category).',
    '- line/bar: group by time where sensible; keep dates readable (e.g. "2026-03").',
    '- 2 to 5 charts. Mix chart types where it helps (trend, comparison, share, distribution).',
    '- Round numbers to 2 decimals.',
    '- Respond only with the JSON code block.',
  ].join('\n')
}

/** Executor for the dashboard agent's run_sql tool — routes through the live
 *  DataSource so reads are validated and capped identically to the ask path. */
function createDashboardExecutor(source: DataSource) {
  return async (call: { name: string; args: Record<string, unknown> }): Promise<string> => {
    if (call.name !== 'run_sql') throw new Error(`unknown tool: ${call.name}`)
    const sql = String(call.args?.sql ?? '').trim()
    if (!sql) throw new Error('empty SQL')
    const check = await source.validate(sql)
    if (!check.ok) throw new Error(check.error)
    const res = await source.query(sql, { maxRows: 500 })
    // Feed the model a bounded preview, not all 500 rows: the full result would
    // blow up the agent context and inflate every round-trip + retry.
    const previewRows = res.rows.slice(0, 60)
    return JSON.stringify({
      rowCount: res.rowCount,
      truncated: res.truncated,
      previewLimited: res.rows.length > previewRows.length,
      columns: res.columns,
      rows: previewRows,
    })
  }
}

/** Run the dashboard design agent against a live DataSource and return the
 *  sanitized chart spec. Callers render it (HTML export or in-app cards). */
export async function generateDashboardSpec(source: DataSource, request: string): Promise<DashboardSpec> {
  const executor = createDashboardExecutor(source)
  const messages: ChatMessage[] = [{ role: 'user', content: request }]
  const { text } = await runAgent({
    system: dashboardSystemPrompt(source, request),
    messages,
    tools: chartDefs,
    toolExecutor: executor,
    // Multi-dimension dashboards legitimately need several exploration rounds
    // (each round may batch 1-4 run_sql calls); 8 racks the common case.
    maxToolRounds: 16,
  })

  let raw: unknown
  try {
    raw = await extractJsonMarkdown(text)
  } catch (err) {
    throw new Error(`Could not parse dashboard JSON from LLM output.\nRaw output: ${text.slice(0, 2000)}`)
  }
  const spec = sanitizeDashboardSpec(raw)
  if (!spec) throw new Error('LLM output was not a valid dashboard spec')
  return spec
}