import pg from 'pg'
import 'dotenv/config'
import { askCrm, historyFromTurns, type AskHistory } from '../agent/agent.js'
import { suggestFollowUps } from '../agent/llm.js'

const raw = process.argv.slice(2)
const jsonMode = raw.includes('--json') || raw.includes('-j')

const rest: string[] = []
let history: AskHistory = []
for (let i = 0; i < raw.length; i++) {
  const a = raw[i] ?? ''
  if (a === '--history') {
    try {
      const turns = JSON.parse(raw[i + 1] ?? '[]') as { question?: string; answer?: string }[]
      history = historyFromTurns(
        (Array.isArray(turns) ? turns : [])
          .map((t) => ({ question: String(t?.question ?? ''), answer: String(t?.answer ?? '') }))
          .filter((t) => t.question && t.answer),
      )
    } catch {
      // malformed history is ignored
    }
    i++
  } else if (a !== '--json' && a !== '-j') {
    rest.push(a)
  }
}
const question = rest.join(' ').trim()

if (!question) {
  console.error('Usage: npm run crm-ask -- "your CRM question"')
  console.error('Example: npm run crm-ask -- "各行业已成交商机金额排名"')
  console.error('JSON mode: npm run crm-ask -- --json "question"')
  process.exit(1)
}

const connectionString = process.env.CRM_DATABASE_URL
if (!connectionString) {
  console.error(
    '未配置 CRM_DATABASE_URL（PostgreSQL 连接串）。可先启动本机 Postgres 并建好 CRM 表，例如：\n' +
      '  export CRM_DATABASE_URL="postgres://postgres:postgres@127.0.0.1:5432/crm"\n' +
      '建表参考 src/agent/text2sql/postgres.ts 中的 CRM_SCHEMA_SPEC（companies / contacts / deals / activities）。',
  )
  process.exit(1)
}

const pool = new pg.Pool({ connectionString })

try {
  const { answer, events } = await askCrm(pool, question, history)

  if (jsonMode) {
    const followUps = await suggestFollowUps(question, answer).catch(() => [] as string[])
    const result = {
      question,
      answer,
      followUps,
      eventCount: events.length,
      events: events.map((e) => ({
        name: e.name,
        args: e.args,
        result: e.result.length > 2000 ? e.result.slice(0, 2000) + '\n... [truncated]' : e.result,
      })),
    }
    console.log(JSON.stringify(result, null, 2))
  } else {
    console.error(`\n[agent] ${events.length} step(s)`)
    for (const e of events) console.error(`[tool] ${e.name} ${JSON.stringify(e.args)}`)
    console.log('\n' + answer)
  }
} finally {
  await pool.end()
}