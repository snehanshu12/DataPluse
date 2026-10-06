import type { DataSource, QueryResult } from './datasource.js'
import type { ChatMessage } from '../llm.js'

export interface SqlPlan {
  sql: string
  reasoning: string
  tables: string[]
}

export interface GenerateCtx {
  question: string
  schema: string
  hints: string
  dialect: string
  /** Prior turns of the same conversation, oldest first. */
  history?: ChatMessage[]
  /** Previous rejection error, when regenerating. */
  error?: string
  /** SQL that was rejected, when regenerating — lets the model fix its own query. */
  sql?: string
}

export interface FinalizeCtx {
  question: string
  sql: string
  columns: string[]
  rows: Record<string, unknown>[]
  rowCount: number
  /** Prior turns of the same conversation, oldest first. */
  history?: ChatMessage[]
}

export interface Text2SqlDeps {
  generate: (ctx: GenerateCtx) => Promise<SqlPlan>
  finalize: (ctx: FinalizeCtx) => Promise<string>
}

export interface Text2SqlEvent {
  name: string
  args: Record<string, unknown>
  result: string
}

export interface Text2SqlResult {
  sql: string
  reasoning: string
  columns: string[]
  rows: Record<string, unknown>[]
  rowCount: number
  answer: string
  events: Text2SqlEvent[]
}

/** Schema-agnostic writing rules the generator must respect when creating SQL.
 *  E-commerce/CRM-specific tips live in the per-source curated schema, not here,
 *  so user-imported tables never get misled by foreign column expectations. */
export const SQL_HINTS = [
  '只允许一条只读 SELECT 查询，禁止写操作。',
  '聚合列务必加别名，如 AS revenue / month / cnt。',
  '查询务必加 LIMIT（上限 200 行，常见 20）。',
  '日期/时间比较时先确认该列的实际格式，再决定用字符串还是时间函数。',
].join('\n')

export interface Text2SqlOptions {
  maxAttempts?: number
  maxRows?: number
  /** Bounded retries of the finalize (answer prose) stage, independent of SQL generation. */
  maxAnswerTries?: number
}

/**
 * Orchestrates generate → validate → execute with bounded self-correction, then
 * finalize with its own independent retry budget. Talks ONLY to the DataSource
 * interface — any backing data system can be plugged in.
 *
 * The last stage (answering in prose) and the earlier stages (writing SQL) fail
 * independently: a flaky answer model must not discard a proven query and
 * re-run the whole DB round-trip, and a bad query must not be retried as prose.
 */
export async function runText2Sql(
  source: DataSource,
  question: string,
  deps: Text2SqlDeps,
  options: Text2SqlOptions = {},
  history?: ChatMessage[],
): Promise<Text2SqlResult> {
  const maxAttempts = options.maxAttempts ?? 3
  const maxAnswerTries = options.maxAnswerTries ?? 3
  const schema = await source.describe()
  const dialect = source.dialect ?? 'SQL'
  const events: Text2SqlEvent[] = []
  let lastError: string | undefined
  let lastSql: string | undefined

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    let plan: SqlPlan
    try {
      plan = await deps.generate({
        question,
        schema,
        hints: SQL_HINTS,
        dialect,
        history,
        error: lastError,
        sql: lastSql,
      })
    } catch (err) {
      // A generator failure (bad JSON, empty sql…) must not abort the pipeline —
      // route it back through the bounded self-correction loop instead.
      lastError = err instanceof Error ? err.message : String(err)
      lastSql = undefined
      events.push({
        name: 'sql_fix',
        args: { attempt: attempt + 1, error: lastError },
        result: `生成失败，准备第 ${attempt + 2} 次生成`,
      })
      continue
    }

    const check = source.validate(plan.sql)
    if (!check.ok) {
      lastError = check.error
      lastSql = plan.sql
      events.push({
        name: 'sql_fix',
        args: { attempt: attempt + 1, error: check.error },
        result: `SQL 未通过校验，准备第 ${attempt + 2} 次生成`,
      })
      continue
    }

    let data: QueryResult
    try {
      data = await source.query(plan.sql, { maxRows: options.maxRows })
    } catch (err) {
      lastError = err instanceof Error ? err.message : String(err)
      lastSql = plan.sql
      events.push({
        name: 'sql_fix',
        args: { attempt: attempt + 1, error: lastError },
        result: `执行失败，准备第 ${attempt + 2} 次生成`,
      })
      continue
    }
    events.push({
      name: 'text2sql',
      args: { sql: plan.sql, reasoning: plan.reasoning },
      result: `返回 ${data.rowCount} 行${data.truncated ? `（截断至 ${data.rows.length} 行）` : ''}`,
    })

    // Answer stage has its own retry budget: a failing finalizer must never
    // discard a query that already succeeded and re-run generation + execution.
    let answerErr: string | undefined
    for (let f = 0; f < maxAnswerTries; f++) {
      try {
        const answer = await deps.finalize({
          question,
          sql: plan.sql,
          columns: data.columns,
          rows: data.rows,
          rowCount: data.rowCount,
          history,
        })
        return {
          sql: plan.sql,
          reasoning: plan.reasoning,
          columns: data.columns,
          rows: data.rows,
          rowCount: data.rowCount,
          answer,
          events,
        }
      } catch (err) {
        answerErr = err instanceof Error ? err.message : String(err)
      }
    }

    throw new Error(`text2sql answer stage failed after ${maxAnswerTries} tries: ${answerErr}`)
  }

  throw new Error(`text2sql failed after ${maxAttempts} attempts: ${lastError}`)
}