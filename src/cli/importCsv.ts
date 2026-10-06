import { importCsvToSqlite } from '../import/csvImport.js'

const args = process.argv.slice(2)
const jsonMode = args.includes('--json') || args.includes('-j')
const rest = args.filter((a) => a !== '--json' && a !== '-j')
const csvPath = rest[0]
const tableName = rest[1]

if (!csvPath) {
  console.error('Usage: npm run csv-import -- <path/to.csv> [tableName]')
  console.error('Example: npm run csv-import -- ./data/sales.csv')
  console.error('JSON mode: npm run csv-import -- --json <path/to.csv>')
  process.exit(1)
}

try {
  const result = importCsvToSqlite(csvPath, { table: tableName })
  if (jsonMode) {
    console.log(JSON.stringify(result, null, 2))
  } else {
    console.log(`Imported ${result.rowCount} rows from "${csvPath}"`)
    console.log(`  → ${result.dbPath} (table: ${result.table})`)
  }
} catch (err) {
  console.error(`导入失败: ${err instanceof Error ? err.message : String(err)}`)
  process.exit(1)
}