import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import Database from 'better-sqlite3'
import { importCsvToSqlite } from '../src/import/csvImport.js'

function tmpCsv(content: string, name = 'sample.csv'): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cp-csv-'))
  const dir = path.join(root, 'src')
  fs.mkdirSync(dir)
  fs.writeFileSync(path.join(dir, name), content)
  return path.join(dir, name)
}

test('import: basic CSV infers types and counts rows', () => {
  const csv = tmpCsv('name,age,score\nAlice,30,88.5\nBob,25,91.0\n')
  const r = importCsvToSqlite(csv, { targetDir: fs.mkdtempSync(path.join(os.tmpdir(), 'cp-db-')) })
  assert.equal(r.table, 'src_sample')
  assert.equal(r.rowCount, 2)
  const db = new Database(r.dbPath, { readonly: true })
  const info = db.prepare(`PRAGMA table_info("src_sample")`).all() as { name: string; type: string }[]
  assert.equal(info.length, 3)
  assert.equal(info[0]!.type.toUpperCase(), 'TEXT')
  assert.equal(info[1]!.type.toUpperCase(), 'INTEGER')
  assert.equal(info[2]!.type.toUpperCase(), 'REAL')
  const rows = db.prepare('SELECT SUM(age) AS s FROM src_sample').get() as { s: number }
  assert.equal(rows.s, 55)
  db.close()
})

test('import: handles quoted fields, commas, escaped quotes, CRLF', () => {
  const csv = tmpCsv('id,title\n1,"Hello, world"\n2,"Say ""hi"""\r\n3,plain\r\n')
  const r = importCsvToSqlite(csv, { targetDir: fs.mkdtempSync(path.join(os.tmpdir(), 'cp-db-')) })
  const db = new Database(r.dbPath, { readonly: true })
  const rows = db.prepare('SELECT title FROM src_sample ORDER BY id').all() as { title: string }[]
  assert.deepEqual(rows.map((x) => x.title), ['Hello, world', 'Say "hi"', 'plain'])
  db.close()
})

test('import: skips empty values as NULL, text stays TEXT', () => {
  const csv = tmpCsv('a,b\n1,\n2,x\n')
  const r = importCsvToSqlite(csv, { targetDir: fs.mkdtempSync(path.join(os.tmpdir(), 'cp-db-')) })
  const db = new Database(r.dbPath, { readonly: true })
  const rows = db.prepare('SELECT a, b FROM src_sample ORDER BY a').all() as { a: number; b: string | null }[]
  assert.equal(rows[0]!.b, null)
  assert.equal(rows[1]!.b, 'x')
  db.close()
})

test('import: dedupes repeated column names (Excel multi-month exports)', () => {
  const csv = tmpCsv('套数,套数,套数,单价,套数_2\n1,2,3,10,4\n5,6,7,20,8\n')
  const r = importCsvToSqlite(csv, { targetDir: fs.mkdtempSync(path.join(os.tmpdir(), 'cp-db-')) })
  const db = new Database(r.dbPath, { readonly: true })
  const info = db.prepare(`PRAGMA table_info("src_sample")`).all() as { name: string }[]
  assert.deepEqual(info.map((c) => c.name), ['套数', '套数_2', '套数_3', '单价', '套数_2_2'])
  const row = db.prepare('SELECT "套数", "套数_2", "套数_3", "单价", "套数_2_2" FROM src_sample').get() as Record<string, number>
  assert.deepEqual(Object.values(row), [1, 2, 3, 10, 4])
  db.close()
})

test('import: rejects empty or header-only CSV, sanitizes bad table names', () => {
  const empty = tmpCsv('a,b\n')
  assert.throws(() => importCsvToSqlite(empty, { targetDir: os.tmpdir() }), /没有数据行/)

  const weird = tmpCsv('1st col,x y\n1,2\n')
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cp-db-'))
  const r = importCsvToSqlite(weird, { targetDir: dir, table: '123 bad!name' })
  assert.match(r.table, /^t_/)
  const db = new Database(r.dbPath, { readonly: true })
  const info = db.prepare(`PRAGMA table_info("${r.table}")`).all() as { name: string }[]
  assert.deepEqual(info.map((c) => c.name), ['t_1st_col', 'x_y'])
  db.close()
})