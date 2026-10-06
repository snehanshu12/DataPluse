import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createPostgresSource, CRM_SCHEMA_SPEC } from '../src/agent/text2sql/postgres.js'
import { renderSchema } from '../src/agent/text2sql/datasource.js'
import { runText2Sql, type Text2SqlDeps } from '../src/agent/text2sql/pipeline.js'

function fakeClient(rows: Record<string, unknown>[] = []) {
  const calls: string[] = []
  return {
    calls,
    client: {
      async query(sql: string) {
        calls.push(sql)
        return { rows }
      },
    },
  }
}

test('postgres: CRM schema description is prompt-ready', () => {
  const desc = renderSchema(CRM_SCHEMA_SPEC, [
    'contacts.company_id → companies.id',
    'deals.company_id    → companies.id',
    'deals.contact_id    → contacts.id',
    'activities.contact_id → contacts.id',
  ])
  assert.match(desc, /companies/)
  assert.match(desc, /deals/)
  assert.match(desc, /stage/)
  assert.match(desc, /商机金额/)
})

test('postgres: validate accepts SELECT, rejects writes and multi-statement', () => {
  const src = createPostgresSource(fakeClient().client)
  assert.deepEqual(src.validate('SELECT name FROM companies'), { ok: true })
  assert.deepEqual(
    src.validate("SELECT SUM(amount) AS total FROM deals WHERE stage = 'won'"),
    { ok: true },
  )
  for (const sql of [
    "INSERT INTO companies(name) VALUES ('Acme')",
    'DELETE FROM contacts',
    'UPDATE deals SET stage = \'won\'',
    'DROP TABLE deals',
    'SELECT 1; DROP TABLE deals',
  ]) {
    const check = src.validate(sql)
    assert.equal(check.ok, false, `${sql} should be rejected: ${'error' in check ? check.error : ''}`)
  }
})

test('postgres: validate rejects broken SQL', () => {
  const src = createPostgresSource(fakeClient().client)
  assert.equal(src.validate('SELECT FROM').ok, false)
})

test('postgres: query executes via client, caps rows, derives columns', async () => {
  const rows = [
    { id: 1, name: 'Acme', amount: 100 },
    { id: 2, name: 'Globex', amount: 250 },
    { id: 3, name: 'Initech', amount: 50 },
  ]
  const { calls, client } = fakeClient(rows)
  const src = createPostgresSource(client)
  const res = await src.query('SELECT * FROM deals', { maxRows: 2 })
  assert.equal(res.rowCount, 3)
  assert.equal(res.rows.length, 2)
  assert.equal(res.truncated, true)
  assert.deepEqual(res.columns, ['id', 'name', 'amount'])
  assert.equal(calls[0], 'SELECT * FROM deals')
})

test('postgres: query rejects non-SELECT', async () => {
  const src = createPostgresSource(fakeClient().client)
  await assert.rejects(() => src.query('DELETE FROM deals'), /only SELECT/)
})

test('postgres: describe introspects live schema with curated overlay', async () => {
  const client = {
    async query(sql: string) {
      if (sql.includes('information_schema.tables')) {
        return { rows: [{ table_name: 'companies' }, { table_name: 'deals' }] }
      }
      if (sql.includes('information_schema.columns')) {
        return {
          rows: [
            { t: 'companies', c: 'id', ty: 'integer', n: 'NO' },
            { t: 'companies', c: 'name', ty: 'text', n: 'NO' },
            { t: 'companies', c: 'industry', ty: 'text', n: 'YES' },
            { t: 'deals', c: 'id', ty: 'integer', n: 'NO' },
            { t: 'deals', c: 'amount', ty: 'numeric', n: 'YES' },
            { t: 'deals', c: 'stage', ty: 'text', n: 'YES' },
          ],
        }
      }
      if (sql.includes("constraint_type = 'FOREIGN KEY'")) {
        return { rows: [{ t: 'deals', c: 'company_id', rt: 'companies', rc: 'id' }] }
      }
      if (sql.includes("constraint_type = 'PRIMARY KEY'")) {
        return { rows: [{ t: 'deals', c: 'id' }, { t: 'companies', c: 'id' }] }
      }
      if (sql.includes('pg_class')) {
        return { rows: [{ t: 'companies', n: 12 }, { t: 'deals', n: 160 }] }
      }
      // sample-row queries
      if (sql.startsWith('SELECT')) {
        return { rows: [{ id: 1, name: 'Acme', industry: 'SaaS' }, { id: 2, name: 'Globex', industry: '零售' }] }
      }
      return { rows: [] }
    },
  }
  const desc = await createPostgresSource(client).describe()
  assert.match(desc, /表 companies\(/)
  assert.match(desc, /表 deals\(/)
  assert.match(desc, /id integer PK/)
  assert.match(desc, /amount numeric/)
  assert.match(desc, /· 12 行/)
  assert.match(desc, /· 160 行/)
  assert.match(desc, /deals\.company_id\s*→\s*companies\.id/)
  assert.match(desc, /商机金额/) // curated overlay comment from CRM_SCHEMA_SPEC
  assert.match(desc, /示例值: SaaS/)
})

test('postgres: full pipeline end-to-end through the adapter (async contract)', async () => {
  const rows = [
    { company: 'Acme', total: 100 },
    { company: 'Globex', total: 250 },
  ]
  const src = createPostgresSource(fakeClient(rows).client)
  const deps: Text2SqlDeps = {
    generate: async () => ({
      sql: "SELECT c.name AS company, SUM(d.amount) AS total FROM deals d JOIN companies c ON d.company_id = c.id GROUP BY c.name",
      reasoning: 'won deals by company',
      tables: ['deals', 'companies'],
    }),
    finalize: async (ctx) => `共 ${ctx.rowCount} 家公司`,
  }
  const res = await runText2Sql(src, '各公司已成交金额', deps)
  assert.equal(res.answer, '共 2 家公司')
  assert.equal(res.rowCount, 2)
  assert.deepEqual(res.columns, ['company', 'total'])
  assert.ok(res.events.some((e) => e.name === 'text2sql' && e.args.sql))
})