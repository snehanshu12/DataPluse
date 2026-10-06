import { test } from 'node:test'
import assert from 'node:assert/strict'
import Database from 'better-sqlite3'
import { initDatabase } from '../src/db/database.js'
import { seedDatabase } from '../src/db/seed.js'
import { describeStructuredSchema } from '../src/agent/text2sql/schema.js'
import { createSqliteSource } from '../src/agent/text2sql/sqlite.js'
import type { DataSource } from '../src/agent/text2sql/datasource.js'
import { route } from '../src/agent/text2sql/router.js'
import { normalizePlan, buildUser, missingColumnReminder } from '../src/agent/text2sql/generator.js'
import {
  runText2Sql,
  type GenerateCtx,
  type Text2SqlDeps,
} from '../src/agent/text2sql/pipeline.js'

function fixture(): Database.Database {
  const db = initDatabase(':memory:')
  seedDatabase(db, { customers: 20, productsPerCategory: 3, orders: 25, seed: 7 })
  return db
}

test('schema: structured description includes tables, comments and FK hints', () => {
  const desc = describeStructuredSchema()
  assert.match(desc, /customers/)
  assert.match(desc, /placed_at/)
  assert.match(desc, /order_items\.product_id\s*→\s*products\.id/)
  assert.match(desc, /品类名/)
})

test('sqlite source: accepts a plain SELECT', () => {
  const src = createSqliteSource(fixture())
  assert.deepEqual(src.validate('SELECT COUNT(*) AS c FROM orders'), { ok: true })
})

test('sqlite source: rejects write statements', () => {
  const src = createSqliteSource(fixture())
  for (const sql of [
    'DELETE FROM customers',
    'INSERT INTO categories(name) VALUES ("x")',
    'UPDATE orders SET status="completed"',
    'DROP TABLE orders',
  ]) {
    const check = src.validate(sql)
    assert.equal(check.ok, false, `${sql} should be rejected: ${'error' in check ? check.error : ''}`)
  }
})

test('sqlite source: rejects multiple statements and broken SQL', () => {
  const src = createSqliteSource(fixture())
  assert.equal(src.validate('SELECT 1; DROP TABLE orders').ok, false)
  assert.equal(src.validate('SELECT FROM').ok, false)
  assert.equal(src.validate('SELECT * FROM no_such_table').ok, false)
})

test('sqlite source: query returns rows and honors maxRows cap', async () => {
  const src = createSqliteSource(fixture())
  const res = await src.query('SELECT id FROM orders', { maxRows: 3 })
  assert.equal(res.rowCount, 25)
  assert.equal(res.rows.length, 3)
  assert.equal(res.truncated, true)
  assert.ok(res.columns.includes('id'))
})

test('sqlite source: describe introspects live schema (counts, samples, FK, curated comments)', async () => {
  const desc = await createSqliteSource(fixture()).describe()
  assert.match(desc, /表 orders\(/)
  assert.match(desc, /· 25 行/)
  assert.match(desc, /order_items\.product_id\s*→\s*products\.id/)
  assert.match(desc, /下单时间/) // curated comment
  assert.match(desc, /示例值: completed|示例值: pending/) // real sample values from seed data
})

test('sqlite source: describe works on an empty (unseeded) schema', async () => {
  const empty = initDatabase(':memory:')
  const desc = await createSqliteSource(empty).describe()
  assert.match(desc, /表 customers\(/)
  assert.match(desc, /· 0 行/)
})

test('router: routes data questions to text2sql, analysis to agent', () => {
  assert.equal(route('最近3个月哪个品类营收最高？'), 'text2sql')
  assert.equal(route('按城市统计客单价'), 'text2sql')
  assert.equal(route('为什么2026年营收下滑？'), 'agent')
  assert.equal(route('如何提升复购率？'), 'agent')
  assert.equal(route('给出增长建议'), 'agent')
})

test('pipeline: happy path generates SQL, runs it, finalizes with data', async () => {
  const src = createSqliteSource(fixture())
  const deps: Text2SqlDeps = {
    generate: async (ctx: GenerateCtx) => {
      return {
        sql: "SELECT strftime('%Y-%m', o.placed_at) AS month, COUNT(*) AS cnt FROM orders o GROUP BY month ORDER BY month",
        reasoning: 'monthly order counts',
        tables: ['orders'],
      }
    },
    finalize: async (ctx) => `按月份共 ${ctx.rowCount} 组`,
  }
  const res = await runText2Sql(src, '按月统计订单量', deps)
  assert.equal(res.answer, `按月份共 ${res.rowCount} 组`)
  assert.ok(res.rowCount > 0)
  assert.deepEqual(res.columns, ['month', 'cnt'])
  assert.ok(res.events.some((e) => e.name === 'text2sql' && e.args.sql === res.sql))
})

test('pipeline: regenerates once on invalid SQL, then succeeds', async () => {
  const src = createSqliteSource(fixture())
  let gen = 0
  const deps: Text2SqlDeps = {
    generate: async () => {
      gen += 1
      if (gen === 1) return { sql: 'DELETE FROM customers', reasoning: 'bad', tables: [] }
      return { sql: 'SELECT COUNT(*) AS c FROM orders', reasoning: 'good', tables: ['orders'] }
    },
    finalize: async () => 'succeeded',
  }
  const res = await runText2Sql(src, '有多少订单', deps)
  assert.equal(gen, 2)
  assert.equal(res.answer, 'succeeded')
  assert.ok(res.events.some((e) => e.name === 'sql_fix' && e.args.error))
})

test('pipeline: throws when attempts exhausted', async () => {
  const src = createSqliteSource(fixture())
  const deps: Text2SqlDeps = {
    generate: async () => ({ sql: 'DELETE FROM customers', reasoning: 'bad', tables: [] }),
    finalize: async () => '',
  }
  await assert.rejects(() => runText2Sql(src, '有多少订单', deps), /failed after/)
})

test('pipeline: retries when generate throws, then succeeds', async () => {
  const src = createSqliteSource(fixture())
  let gen = 0
  const deps: Text2SqlDeps = {
    generate: async (ctx) => {
      gen += 1
      // first reply blows up (bad JSON / empty sql) — the last attempt must still work
      if (gen === 1) throw new Error('SQL generator produced no non-empty sql after retries')
      assert.ok(ctx.error?.includes('no non-empty sql'), 'generator received the failure to self-correct')
      return { sql: 'SELECT COUNT(*) AS c FROM orders', reasoning: 'fixed', tables: ['orders'] }
    },
    finalize: async () => 'recovered',
  }
  const res = await runText2Sql(src, '有多少订单', deps)
  assert.equal(gen, 2)
  assert.equal(res.answer, 'recovered')
  assert.ok(res.events.some((e) => e.name === 'sql_fix'))
})

test('pipeline: passes previous error back to the generator for self-correction', async () => {
  const src = createSqliteSource(fixture())
  const seen: { error?: string; sql?: string }[] = []
  let gen = 0
  const deps: Text2SqlDeps = {
    generate: async ({ error, sql }) => {
      seen.push({ error, sql })
      gen += 1
      if (gen === 1) return { sql: 'SELECT * FROM no_such_table', reasoning: 'bad', tables: [] }
      return { sql: 'SELECT COUNT(*) AS c FROM orders', reasoning: 'fixed', tables: ['orders'] }
    },
    finalize: async () => 'fixed answer',
  }
  await runText2Sql(src, 'q', deps)
  assert.equal(seen.length, 2)
  assert.equal(seen[0]!.error, undefined)
  assert.match(seen[1]!.error ?? '', /no_such_table/)
  assert.equal(seen[1]!.sql, 'SELECT * FROM no_such_table')
})

test('pipeline: talks only to the DataSource interface (decoupled)', async () => {
  const calls: string[] = []
  const fake: DataSource = {
    describe: () => {
      calls.push('describe')
      return 'FAKE SCHEMA'
    },
    validate: (sql) => {
      calls.push(`validate:${sql}`)
      return { ok: true }
    },
    query: async (sql, opts) => {
      calls.push(`query:${sql}:${opts?.maxRows ?? 200}`)
      return { columns: ['c'], rows: [{ c: 1 }], rowCount: 1, truncated: false }
    },
    dialect: 'FakeSQL',
  }
  const deps: Text2SqlDeps = {
    generate: async (ctx) => {
      calls.push(`generate:schema=${ctx.schema}:dialect=${ctx.dialect}`)
      return { sql: 'SELECT 1 AS c', reasoning: 'r', tables: [] }
    },
    finalize: async () => 'done',
  }
  const res = await runText2Sql(fake, 'q', deps)
  assert.equal(res.answer, 'done')
  assert.equal(res.rowCount, 1)
  assert.ok(calls.some((c) => c === 'describe'))
  assert.ok(calls.some((c) => c === 'validate:SELECT 1 AS c'))
  assert.ok(calls.some((c) => c === 'query:SELECT 1 AS c:200'))
  assert.ok(
    calls.some((c) => c.includes('generate:schema=FAKE SCHEMA') && c.includes('dialect=FakeSQL')),
  )
})

test('pipeline: a failing finalize retries WITHOUT re-running SQL generation', async () => {
  const src = createSqliteSource(fixture())
  let gen = 0
  let fin = 0
  const deps: Text2SqlDeps = {
    generate: async () => {
      gen += 1
      return { sql: 'SELECT COUNT(*) AS c FROM orders', reasoning: 'ok', tables: ['orders'] }
    },
    finalize: async () => {
      fin += 1
      if (fin < 3) throw new Error('answer model hiccup')
      return 'finally answered'
    },
  }
  const res = await runText2Sql(src, '有多少订单', deps)
  assert.equal(gen, 1, 'SQL must not be regenerated for an answer-stage failure')
  assert.equal(fin, 3)
  assert.equal(res.answer, 'finally answered')
})

test('pipeline: finalize exhaustion surfaces a distinct answer error without burning queries', async () => {
  const src = createSqliteSource(fixture())
  let gen = 0
  const deps: Text2SqlDeps = {
    generate: async () => {
      gen += 1
      return { sql: 'SELECT COUNT(*) AS c FROM orders', reasoning: 'ok', tables: ['orders'] }
    },
    finalize: async () => {
      throw new Error('answer engine down')
    },
  }
  await assert.rejects(() => runText2Sql(src, '有多少订单', deps), /answer stage failed/)
  assert.equal(gen, 1, 'a dead answer model must not re-run SQL generation')
})

test('generator: normalizePlan guards drifted model replies', () => {
  assert.equal(normalizePlan(null), null)
  assert.equal(normalizePlan('nope'), null)
  assert.equal(normalizePlan({}), null)
  assert.equal(normalizePlan({ sql: '' }), null)
  assert.equal(normalizePlan({ sql: '  ' }), null)
  assert.equal(normalizePlan({ sql: { inner: 'SELECT 1' } }), null)
  assert.equal(normalizePlan({ sql: 42 }), null)
  assert.deepEqual(normalizePlan({ sql: 'SELECT 1 AS c', reasoning: 'r', tables: ['t'] }), {
    sql: 'SELECT 1 AS c',
    reasoning: 'r',
    tables: ['t'],
  })
  assert.deepEqual(normalizePlan({ sql: '```sql\nSELECT 1 AS c\n```', reasoning: '', tables: [] }), {
    sql: 'SELECT 1 AS c',
    reasoning: '',
    tables: [],
  })
  assert.deepEqual(normalizePlan({ sql: ' SELECT 2 ', reasoning: 'x', tables: 'not-an-array' }), {
    sql: 'SELECT 2',
    reasoning: 'x',
    tables: [],
  })
})

test('generator: missingColumnReminder fires for invented column/table names', () => {
  assert.match(missingColumnReminder("Unknown column 'br.borrow_date' in 'where clause'") ?? '', /copy the exact names/)
  assert.match(missingColumnReminder("no such column: borrow_date") ?? '', /copy the exact names/)
  assert.match(missingColumnReminder('no such table: my_table') ?? '', /copy the exact names/)
  assert.equal(missingColumnReminder('syntax error near SELECT'), null)
  assert.equal(missingColumnReminder(''), null)
})

test('generator: the missing-name reminder is wired into the generated error spec', () => {
  const user = buildUser(
    {
      question: 'q',
      schema: 'S',
      hints: 'H',
      dialect: 'SQL',
      error: "Unknown column 'x.user_date'",
      sql: 'SELECT x.user_date FROM t',
    },
    null,
  )
  assert.match(user, /copy the exact names/)
  assert.match(user, /Write corrected SQL only\./)
  const plain = buildUser({ question: 'q', schema: 'S', hints: 'H', dialect: 'SQL', error: 'syntax error near SELECT' }, null)
  assert.doesNotMatch(plain, /copy the exact names/)
})