import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createMysqlSource, MYSQL_DEMO_SPEC } from '../src/agent/text2sql/mysql.js'
import { renderSchema } from '../src/agent/text2sql/datasource.js'
import { runText2Sql, type Text2SqlDeps } from '../src/agent/text2sql/pipeline.js'

function fakeClient(rows: Record<string, unknown>[] = []) {
  const calls: string[] = []
  return {
    calls,
    client: {
      async query(sql: string, _params?: unknown[]) {
        calls.push(sql)
        return { rows }
      },
    },
  }
}

test('mysql: demo schema description is prompt-ready', () => {
  const desc = renderSchema(MYSQL_DEMO_SPEC, [
    'books.author_id    → authors.id',
    'books.publisher_id → publishers.id',
    'borrows.book_id    → books.id',
    'borrows.member_id  → members.id',
  ])
  assert.match(desc, /books/)
  assert.match(desc, /borrows/)
  assert.match(desc, /借阅记录/)
})

test('mysql: validate accepts SELECT, rejects writes and multi-statement', () => {
  const src = createMysqlSource(fakeClient().client)
  assert.deepEqual(src.validate('SELECT * FROM books'), { ok: true })
  assert.deepEqual(src.validate("SELECT COUNT(*) FROM borrows WHERE returned_at IS NULL"), { ok: true })
  for (const sql of [
    "INSERT INTO books(title) VALUES ('x')",
    'DELETE FROM members',
    'UPDATE books SET stock = 0',
    'DROP TABLE books',
    'SELECT 1; DROP TABLE books',
  ]) {
    const check = src.validate(sql)
    assert.equal(check.ok, false, `${sql} should be rejected: ${'error' in check ? check.error : ''}`)
  }
})

test('mysql: validate rejects broken SQL', () => {
  const src = createMysqlSource(fakeClient().client)
  assert.equal(src.validate('SELECT FROM').ok, false)
})

test('mysql: query executes via client, caps rows, derives columns', async () => {
  const rows = [
    { id: 1, title: '三体', price: 42.5 },
    { id: 2, title: '活着', price: 39 },
    { id: 3, title: '百年孤独', price: 55 },
  ]
  const { calls, client } = fakeClient(rows)
  const src = createMysqlSource(client)
  const res = await src.query('SELECT * FROM books', { maxRows: 2 })
  assert.equal(res.rowCount, 3)
  assert.equal(res.rows.length, 2)
  assert.equal(res.truncated, true)
  assert.deepEqual(res.columns, ['id', 'title', 'price'])
  assert.equal(calls[0], 'SELECT * FROM books')
})

test('mysql: query rejects non-SELECT', async () => {
  const src = createMysqlSource(fakeClient().client)
  await assert.rejects(() => src.query('DELETE FROM books'), /only SELECT/)
})

test('mysql: describe introspects live schema with curated overlay', async () => {
  const client = {
    async query(sql: string, _params?: unknown[]) {
      if (sql.includes('information_schema.tables') && sql.includes('table_name AS t') && !sql.includes('table_rows')) {
        return { rows: [{ t: 'books' }, { t: 'borrows' }] }
      }
      if (sql.includes('information_schema.columns')) {
        return {
          rows: [
            { t: 'books', c: 'id', ty: 'int', n: 'NO' },
            { t: 'books', c: 'title', ty: 'varchar', n: 'NO' },
            { t: 'books', c: 'price', ty: 'decimal', n: 'NO' },
            { t: 'borrows', c: 'id', ty: 'int', n: 'NO' },
            { t: 'borrows', c: 'returned_at', ty: 'datetime', n: 'YES' },
          ],
        }
      }
      if (sql.includes('referenced_table_name IS NOT NULL')) {
        return { rows: [{ t: 'borrows', c: 'book_id', rt: 'books', rc: 'id' }] }
      }
      if (sql.includes("constraint_name = 'PRIMARY'")) {
        return { rows: [{ t: 'books', c: 'id' }, { t: 'borrows', c: 'id' }] }
      }
      if (sql.includes('information_schema.tables') && sql.includes('table_rows')) {
        return { rows: [{ t: 'books', n: 180 }, { t: 'borrows', n: 260 }] }
      }
      if (sql.startsWith('SELECT')) {
        return { rows: [{ id: 1, title: '三体', price: 42.5 }] }
      }
      return { rows: [] }
    },
  }
  const desc = await createMysqlSource(client).describe()
  assert.match(desc, /表 books\(/)
  assert.match(desc, /id int PK/)
  assert.match(desc, /· 180 行/)
  assert.match(desc, /borrows\.book_id\s*→\s*books\.id/)
  assert.match(desc, /借阅记录/) // curated overlay
  assert.match(desc, /示例值: 三体/)
})

test('mysql: describe never yields undefined table names on case-variant drivers', async () => {
  // MySQL 8 on case-insensitive file systems returns unaliased labels UPPERCASED;
  // the adapter must tolerate both `table_name` and `TABLE_NAME` key casing and
  // never present a ghost "undefined" table to the generator.
  const rowsBySql = new Map<string, Record<string, unknown>[]>()
  const client = {
    async query(sql: string, _params?: unknown[]) {
      return { rows: rowsBySql.get(sql) ?? [] }
    },
  }
  const baseTables = `SELECT table_name AS t FROM information_schema.tables WHERE table_schema = DATABASE() AND table_type = 'BASE TABLE'`
  rowsBySql.set(baseTables, [{ TABLE_NAME: 'books' }, { TABLE_NAME: 'borrows' }])
  const desc = await createMysqlSource(client).describe()
  assert.match(desc, /表 books\(/)
  assert.match(desc, /表 borrows\(/)
  assert.doesNotMatch(desc, /undefined/)
})

test('mysql: full pipeline end-to-end through the adapter (async contract)', async () => {
  const rows = [
    { title: '三体', cnt: 12 },
    { title: '活着', cnt: 9 },
  ]
  const src = createMysqlSource(fakeClient(rows).client)
  const deps: Text2SqlDeps = {
    generate: async () => ({
      sql: "SELECT b.title, COUNT(*) AS cnt FROM borrows br JOIN books b ON br.book_id = b.id GROUP BY b.title ORDER BY cnt DESC LIMIT 5",
      reasoning: 'most borrowed books',
      tables: ['borrows', 'books'],
    }),
    finalize: async (ctx) => `共 ${ctx.rowCount} 本图书`,
  }
  const res = await runText2Sql(src, '借出最多的图书', deps)
  assert.equal(res.answer, '共 2 本图书')
  assert.equal(res.rowCount, 2)
  assert.deepEqual(res.columns, ['title', 'cnt'])
  assert.ok(res.events.some((e) => e.name === 'text2sql' && e.args.sql))
})