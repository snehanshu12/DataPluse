import mysql from 'mysql2/promise'
import 'dotenv/config'
import { askMysql, historyFromTurns, type AskHistory } from '../agent/agent.js'
import { suggestFollowUps } from '../agent/llm.js'
import type { MySqlClient } from '../agent/text2sql/mysql.js'

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
  console.error('Usage: npm run mysql-ask -- "your MySQL question"')
  console.error('Example: npm run mysql-ask -- "借出最多的5本图书"')
  console.error('JSON mode: npm run mysql-ask -- --json "question"')
  process.exit(1)
}

const dbUrl = process.env.MYSQL_DATABASE_URL
if (!dbUrl) {
  console.error(
    '未配置 MYSQL_DATABASE_URL（MySQL 连接串）。可先启动本机 MySQL 并建好图书表，例如：\n' +
      '  export MYSQL_DATABASE_URL="mysql://root:root@127.0.0.1:3306/library"\n' +
      '建表参考 src/agent/text2sql/mysql.ts 中的 MYSQL_DEMO_SPEC（publishers / authors / books / members / borrows）。',
  )
  process.exit(1)
}

const pool = mysql.createPool(process.env.MYSQL_DATABASE_URL as string)
const client: MySqlClient = {
  async query(sql, params) {
    const [rows] = await pool.query(sql, params)
    return { rows: rows as Record<string, unknown>[] }
  },
}

try {
  const { answer, events } = await askMysql(client, question, history)

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