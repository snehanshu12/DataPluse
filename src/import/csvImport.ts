import fs from 'node:fs'
import path from 'node:path'
import Database from 'better-sqlite3'
import { ROOT } from '../config.js'

export interface CsvImportOptions {
  /** Directory the imported SQLite db is written into (default data/imported). */
  targetDir?: string
  /** Table to create (default = csv basename, sanitized). */
  table?: string
  /** Rows to sniff when inferring column types (default: all). */
  sniffRows?: number
}

export interface CsvImportResult {
  dbPath: string
  table: string
  rowCount: number
}

function parseCsv(text: string): string[][] {
  const rows: string[][] = []
  let row: string[] = []
  let field = ''
  let inQuotes = false
  let i = 0
  const pushField = () => {
    row.push(field)
    field = ''
  }
  const pushRow = () => {
    pushField()
    rows.push(row)
    row = []
  }
  while (i < text.length) {
    const ch = text[i]!
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"'
          i += 2
          continue
        }
        inQuotes = false
        i += 1
        continue
      }
      field += ch
      i += 1
      continue
    }
    if (ch === '"') {
      inQuotes = true
      i += 1
      continue
    }
    if (ch === ',') {
      pushField()
      i += 1
      continue
    }
    if (ch === '\r') {
      i += 1
      continue
    }
    if (ch === '\n') {
      pushRow()
      i += 1
      continue
    }
    field += ch
    i += 1
  }
  if (field || row.length) pushRow()
  // drop fully-empty trailing rows
  while (rows.length && rows[rows.length - 1]!.every((c) => c === '')) rows.pop()
  return rows
}

function sanitizeTableName(name: string): string {
  const n = name.replace(/[^A-Za-z0-9_一-龥]/g, '_').replace(/^_+|_+$/g, '')
  if (!n) throw new Error(`无法从文件名推导表名：${name}`)
  if (/^\d/.test(n)) return `t_${n}`
  return n
}

/** 默认表名 = 「所在目录名_文件名」，用于区分同名的不同数据批次。 */
function deriveTableName(csvPath: string): string {
  const stem = path.basename(csvPath, path.extname(csvPath))
  const dir = path.basename(path.dirname(csvPath))
  if (!dir || dir === '.' || dir === '/') return stem
  return `${dir}_${stem}`
}

/** Excel 常导出重复列名（如多个月份的「套数」）。重复时追加 _2/_3 后缀，且不与现有列冲突。 */
function uniqueColumnNames(raw: string[]): string[] {
  const seen = new Map<string, number>()
  return raw.map((h, i) => {
    let name = sanitizeTableName(h || `col${i + 1}`)
    if (!seen.has(name)) {
      seen.set(name, 1)
      return name
    }
    let n = (seen.get(name) as number) + 1
    seen.set(name, n)
    let cand = `${name}_${n}`
    while (seen.has(cand)) {
      n += 1
      seen.set(name, n)
      cand = `${name}_${n}`
    }
    seen.set(cand, 1)
    return cand
  })
}

type ColType = 'TEXT' | 'REAL' | 'INTEGER'

function inferType(values: string[]): ColType {
  const nonEmpty = values.filter((v) => v.trim() !== '')
  if (nonEmpty.length === 0) return 'TEXT'
  let allInt = true
  let allNum = true
  for (const raw of nonEmpty) {
    if (/^-?\d+$/.test(raw.trim())) continue
    allInt = false
    if (!/^-?\d*\.?\d+([eE][+-]?\d+)?$/.test(raw.trim())) {
      allNum = false
      break
    }
  }
  if (allInt) return 'INTEGER'
  if (allNum) return 'REAL'
  return 'TEXT'
}

/**
 * Import a CSV file into a fresh SQLite database: infer column types, create
 * one table, insert in a single transaction. Returns the created db path.
 */
export function importCsvToSqlite(csvPath: string, opts: CsvImportOptions = {}): CsvImportResult {
  const text = fs.readFileSync(csvPath, 'utf8')
  const rows = parseCsv(text)
  if (rows.length < 2) throw new Error(`CSV 为空或没有数据行（仅表头）：${csvPath}`)

  const headers = uniqueColumnNames(rows[0]!)
  const data = rows.slice(1)

  const table = sanitizeTableName(opts.table || deriveTableName(csvPath))
  const sniff = Math.min(opts.sniffRows ?? Infinity, data.length)
  const types = headers.map((_, i) => inferType(data.slice(0, sniff).map((r) => r[i] ?? '')))

  const targetDir = path.resolve(ROOT, opts.targetDir ?? 'data/imported')
  fs.mkdirSync(targetDir, { recursive: true })
  const dbPath = path.join(targetDir, `${table}.db`)
  const db = new Database(dbPath)

  const cols = headers.map((h, i) => `${JSON.stringify(h)} ${types[i]}`).join(', ')
  db.exec(`DROP TABLE IF EXISTS "${table}"`)
  db.exec(`CREATE TABLE "${table}" (${cols})`)

  const insert = db.prepare(
    `INSERT INTO "${table}" (${headers.map((h) => JSON.stringify(h)).join(', ')}) VALUES (${headers.map(() => '?').join(', ')})`,
  )
  const tx = db.transaction((batch: unknown[][]) => {
    for (const r of batch) insert.run(r)
  })
  tx(data.map((r) => headers.map((_, i) => (r[i] ?? '').trim() === '' ? null : r[i])))
  db.close()

  return { dbPath, table, rowCount: data.length }
}