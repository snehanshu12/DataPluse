import 'dotenv/config'
import { buildSource, previewCell, quoteIdent } from './sourceConn.js'

const args = process.argv.slice(2)
const jsonMode = args.includes('--json') || args.includes('-j')
const rest = args.filter((a) => !a.startsWith('-'))
const table = rest[0]
const limit = Math.min(Number(rest[1]) || 50, 200)

function fail(box: string, msg: string): never {
  if (jsonMode) console.log(JSON.stringify({ table: box, columns: [], rows: [], total: 0, error: msg }))
  else console.error(msg)
  process.exit(1)
}

async function main() {
  if (!table) {
    fail('', 'Usage: npm run preview -- <tableName> [limit]')
  }
  const { source, close, driver } = buildSource()
  try {
    const qIdent = quoteIdent(driver, table)
    let columns: string[] = []
    if (driver === 'sqlite') {
      const { rows } = await source.query(
        `SELECT name FROM pragma_table_info('${table.replace(/'/g, "''")}')`,
      )
      columns = rows.map((r) => String(r.name))
    } else {
      const schemaClause = driver === 'postgres' ? `table_schema='public'` : `table_schema = DATABASE()`
      const { rows } = await source.query(
        `SELECT column_name AS c FROM information_schema.columns WHERE table_name = '${table.replace(/'/g, "''")}' AND ${schemaClause}`,
      )
      columns = rows.map((r) => String(r.c))
    }
    if (columns.length === 0) fail(table, `找不到表 ${table}`)

    const { rows } = await source.query(`SELECT * FROM ${qIdent} LIMIT ${limit}`)
    const cells = rows.map((r) => columns.map((k) => previewCell(r[k])))
    let total = 0
    try {
      const c = await source.query(`SELECT COUNT(*) AS c FROM ${qIdent}`)
      total = Number(c.rows[0]?.c ?? 0)
    } catch {
      total = rows.length
    }

    const result = { table, columns, rows: cells, total }
    if (jsonMode) process.stdout.write(JSON.stringify(result))
    else {
      console.log(`[${table}] ${total} 行 · 展示前 ${cells.length} 行（${columns.length} 列）`)
      for (const row of cells) console.log(row.map((v) => (v === null ? '—' : String(v))).join(' | '))
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    fail(table, `读取失败: ${message}`)
  } finally {
    await close()
  }
}

main()