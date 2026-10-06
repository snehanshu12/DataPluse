import type { ToolEvent } from './types'

export interface Risk {
  id: string
  message: string
  level: 'info' | 'warn'
}

// Questions that involve dates/recency — only then does a hard-coded date in SQL matter.
const DATE_QUESTION = /(最近|最新|日期|时间|月份|月度|年度|年内|本月|今天|昨天|至今|区间|时段|date|month|year|today|lately|recent)/i

// Quoted date literals in SQL, e.g. '2026-08-15' or '2026/8/15'.
const HARD_DATE = /'(?:19|20)\d{2}[-/]\d{1,2}[-/]\d{1,2}'/

/** Derive non-blocking caution flags from a turn's tool transcript, so the answer
 *  can be surfaced with the context that generated it (inside closed-loop UI). */
export function classifyRisks(question: string, events: ToolEvent[]): Risk[] {
  const risks: Risk[] = []
  const q = String(question ?? '')

  if (events.some((e) => e.name === 'sql_fix')) {
    risks.push({
      id: 'retry',
      level: 'warn',
      message: '本次结果经过纠错后得到，建议展开上方 SQL 核对',
    })
  }

  const runs = events.filter((e) => e.name === 'text2sql' || e.name === 'run_sql')
  for (const ev of runs) {
    const result = String(ev.result ?? '')
    const sql = String(ev.args?.sql ?? '')
    if (/截断至\s*\d+\s*行/.test(result)) {
      risks.push({
        id: 'truncated',
        level: 'warn',
        message: '查询仅显示前 200 行，汇总类结论可能和全量有偏差',
      })
    }
    if (/返回 0 行/.test(result)) {
      risks.push({
        id: 'empty',
        level: 'info',
        message: '未查询到匹配数据，结论基于空结果',
      })
    }
    if (DATE_QUESTION.test(q) && HARD_DATE.test(sql)) {
      risks.push({
        id: 'date',
        level: 'warn',
        message: 'SQL 中出现硬编码日期，"最近/截止"口径可能失效',
      })
    }
  }
  return risks
}