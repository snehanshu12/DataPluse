export type SourceType = 'sqlite' | 'postgres' | 'mysql'

export interface SourceDef {
  id: string
  name: string
  type: SourceType
  dbPath?: string
  url?: string
}

export interface ToolEvent {
  name: string
  args: Record<string, unknown>
  result: string
}

export interface AskResult {
  question: string
  answer: string
  followUps?: string[]
  data?: Record<string, unknown>
  eventCount?: number
  events?: ToolEvent[]
}

export interface HistoryItem {
  ts: number
  q: string
  answer: string
  events: ToolEvent[]
  followUps: string[]
  source: SourceDef
  charts?: DashboardSpec | null
  /** 所属会话 id：同一段连续问答共享一个，侧栏按会话聚合为一条记录。 */
  sessionId?: string
}

/** 会话归组键：老数据没有 sessionId 时退化为按每条自成一组。 */
export function sessionKeyOf(item: HistoryItem): string {
  return item.sessionId ?? `s-${item.ts}`
}

export interface ChatTurn {
  question: string
  answer: string
}

export interface Turn {
  user: string
  answer: string | null
  events: ToolEvent[]
  followUps: string[]
  charts?: DashboardSpec | null
  status?: string
  error?: string
}

export interface Thread {
  turns: Turn[]
}

export interface EnvInfo {
  model: string
  baseUrl: string
}

export interface Settings {
  llm?: { baseUrl?: string; apiKey?: string; model?: string }
  sources?: SourceDef[]
  privacy?: { clearHistoryOnQuit?: boolean }
}

export interface SettingsView {
  settings: Settings
  defaults: { llm: EnvInfo }
}

export interface CsvImportResult {
  dbPath: string
  table: string
  rowCount: number
}

export interface StarterTable {
  name: string
  rows?: number
  columns: string[]
  preview?: { columns: string[]; values: (string | number | boolean | null)[]; last?: (string | number | boolean | null)[] }
}

export interface TablePreview {
  table: string
  columns: string[]
  rows: (string | number | boolean | null)[][]
  total: number
  error?: string
}

export interface StarterResult {
  schema?: string
  tables?: StarterTable[]
  questions: string[]
  driver?: string
  error?: string
}

export type ChartType = 'line' | 'bar' | 'pie' | 'scatter'

export interface ChartSeries {
  name: string
  values: (number | null)[]
}

export interface ChartSpec {
  id: string
  type: ChartType
  title: string
  labels?: string[]
  series: ChartSeries[]
}

export interface DashboardSpec {
  title: string
  summary: string
  createdAt: string
  charts: ChartSpec[]
}