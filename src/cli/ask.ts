import { createSqliteSource, openSqliteDatabase } from '../agent/text2sql/sqlite.js'
import { ask, historyFromTurns, type AskHistory } from '../agent/agent.js'
import { suggestFollowUps } from '../agent/llm.js'
import { countTables } from '../agent/sqlTool.js'
import { DB_PATH } from '../config.js'

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
  console.error('Usage: npm run ask -- "your business question"')
  console.error('Example: npm run ask -- "top 10 products by revenue this quarter"')
  console.error('JSON mode: npm run ask -- --json "question"')
  console.error('Multi-turn: npm run ask -- --history \'[{"question":"...","answer":"..."}]\' "next question"')
  process.exit(1)
}

const db = openSqliteDatabase(DB_PATH)
const counts = countTables(db)

const { answer, events } = await ask(db, question, history)

if (jsonMode) {
  const followUps = await suggestFollowUps(question, answer).catch(() => [] as string[])
  const result = {
    question,
    answer,
    followUps,
    data: counts,
    eventCount: events.length,
    events: events.map((e) => ({
      name: e.name,
      args: e.args,
      result: e.result.length > 2000 ? e.result.slice(0, 2000) + '\n... [truncated]' : e.result,
    })),
  }
  console.log(JSON.stringify(result, null, 2))
} else {
  console.error(`[data] ${Object.entries(counts).map(([k, v]) => `${k}=${v}`).join(', ')}`)
  console.error(`\n[agent] ${events.length} tool call(s)`)
  for (const e of events) console.error(`[tool] ${e.name} ${JSON.stringify(e.args)}`)
  console.log('\n' + answer)
}
db.close()