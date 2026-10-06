import OpenAI from 'openai'
import { LLM, requireApiKey } from '../config.js'

export type ChatMessage = OpenAI.Chat.Completions.ChatCompletionMessageParam

export type ToolDef = {
  type: 'function'
  function: {
    name: string
    description: string
    parameters: Record<string, unknown>
  }
}

export interface ToolCallResult {
  name: string
  args: Record<string, unknown>
}

export interface RunAgentOptions {
  system: string
  messages: ChatMessage[]
  tools?: ToolDef[]
  toolExecutor?: (call: ToolCallResult) => Promise<string>
  maxToolRounds?: number
}

/** Lazy client so merely importing this module (e.g. from tests or the text2sql
 *  generator) never requires LLM_API_KEY — the key is only needed on first call. */
let client: OpenAI | null = null
function getClient(): OpenAI {
  if (!client) {
    client = new OpenAI({
      baseURL: LLM.baseURL,
      apiKey: requireApiKey(),
      // hard cap per request so a stuck upstream can't hang the desktop forever
      timeout: 60_000,
      maxRetries: 0, // we retry below with control over which errors are retried
    })
  }
  return client
}

const RETRYABLE = /timeout|econnreset|econnrefused|eai_again|429|5\d\d/i

/** Run an LLM call with bounded exponential backoff for transient failures. */
async function withRetry<T>(fn: () => Promise<T>, label: string): Promise<T> {
  const maxAttempts = 3
  for (let attempt = 1; ; attempt++) {
    try {
      return await fn()
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      const retryable =
        attempt < maxAttempts &&
        (RETRYABLE.test(message) || (typeof err === 'object' && err !== null && 'status' in err &&
          RETRYABLE.test(String((err as { status?: unknown }).status))))
      if (!retryable) throw err
      const wait = 300 * 2 ** (attempt - 1)
      await new Promise((r) => setTimeout(r, wait))
    }
  }
}

/** Single-model text completion without tool calling. */
export async function completeText(role: 'user' | 'system' | 'assistant', prompt: string): Promise<string> {
  const res = await completionsCreate({
    model: LLM.model,
    messages: [{ role, content: prompt }],
  })
  return res.choices[0]?.message?.content ?? ''
}

/** System-prompted text completion. */
export async function completeChat(system: string, user: string, temperature?: number): Promise<string> {
  const res = await completionsCreate({
    model: LLM.model,
    messages: [
      { role: 'system', content: system },
      { role: 'user', content: user },
    ],
    ...(temperature !== undefined ? { temperature } : {}),
  })
  return res.choices[0]?.message?.content ?? ''
}

/** Completion that must yield a JSON value. */
export async function completeJson(system: string, user: string, temperature?: number): Promise<unknown> {
  return extractJsonMarkdown(await completeChat(system, user, temperature))
}

/**
 * Agent loop: chat with the model, follow tool calls, feed results back.
 * Returns the final assistant text plus the transcript of tool events.
 */
export async function runAgent(opts: RunAgentOptions): Promise<{
  text: string
  events: { name: string; args: Record<string, unknown>; result: string }[]
}> {
  const messages: ChatMessage[] = [
    { role: 'system', content: opts.system },
    ...opts.messages,
  ]
  const events: { name: string; args: Record<string, unknown>; result: string }[] = []
  const maxRounds = opts.maxToolRounds ?? 8

  for (let round = 0; round <= maxRounds; round++) {
  const hasTools = opts.tools && opts.tools.length > 0
  const req: OpenAI.Chat.Completions.ChatCompletionCreateParams = {
    model: LLM.model,
    messages,
    ...(hasTools
      ? { tools: opts.tools as OpenAI.Chat.Completions.ChatCompletionTool[], tool_choice: 'auto' }
      : {}),
  }
  const res = await completionsCreate(req)
    const msg = res.choices[0]?.message
    if (!msg) throw new Error('No message returned from LLM')

    if (!msg.tool_calls || msg.tool_calls.length === 0) {
      return { text: msg.content ?? '', events }
    }

    messages.push(msg)
    for (const call of msg.tool_calls) {
      if (!('function' in call)) continue
      let args: Record<string, unknown> = {}
      try {
        args = call.function.arguments ? JSON.parse(call.function.arguments) : {}
      } catch {
        args = { _raw: call.function.arguments }
      }
      let result: string
      try {
        result = await opts.toolExecutor!({ name: call.function.name, args })
      } catch (err) {
        result = `Tool error: ${err instanceof Error ? err.message : String(err)}`
      }
      events.push({ name: call.function.name, args, result })
      messages.push({
        role: 'tool',
        tool_call_id: call.id,
        content: result,
      })
    }
  }

  throw new Error(`Agent exceeded max tool rounds (${maxRounds})`)
}

/** LLM completions through the retry/timeout wrapper. */
function completionsCreate(
  params: OpenAI.Chat.Completions.ChatCompletionCreateParams,
): Promise<OpenAI.Chat.Completions.ChatCompletion> {
  return withRetry(
    () =>
      getClient().chat.completions.create({ stream: false, ...params }) as Promise<OpenAI.Chat.Completions.ChatCompletion>,
    'llm',
  )
}

export async function extractJsonMarkdown(content: string): Promise<unknown> {
  const fenced = content.match(/```(?:json)?\s*([\s\S]*?)```/)
  const raw = fenced ? fenced[1]! : content
  return JSON.parse(raw)
}

/** Propose 2-3 short follow-up questions based on the question and its answer. */
export async function suggestFollowUps(question: string, answer: string): Promise<string[]> {
  const res = await completionsCreate({
    model: LLM.model,
    messages: [
      {
        role: 'system',
        content:
          'You help users explore a dataset. Given a question and its AI answer, propose 2-3 short, specific follow-up questions (under 25 words each) the user would naturally ask next. If the data is naturally visual (trend, ranking, breakdown), make ONE of them a chart request phrased with a chart intent word (画个图 / 柱状图 / 折线图 / 饼图 / 图表), e.g. "画个柱状图：各分类数量对比". Respond with ONLY a JSON array of strings, e.g. ["...", "...", "..."].',
      },
      {
        role: 'user',
        content: `Question: ${question}\n\nAnswer:\n${answer.slice(0, 2000)}`,
      },
    ],
    temperature: 0.6,
  })
  const content = res.choices[0]?.message?.content ?? ''
  try {
    const raw = (await extractJsonMarkdown(content)) as unknown
    if (Array.isArray(raw)) {
      return raw
        .filter((x): x is string => typeof x === 'string' && x.trim().length > 0)
        .map((x) => x.trim().slice(0, 80))
        .slice(0, 3)
    }
  } catch {
    // fall through to heuristic
  }
  // Heuristic fallback: pull question-like lines out of the raw reply.
  return content
    .split('\n')
    .map((l) => l.replace(/^[-*•\d.)\s]+/, '').trim())
    .filter((l) => l.length > 4 && l.length < 80 && (l.endsWith('？') || l.endsWith('?')))
    .slice(0, 3)
}