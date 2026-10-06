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

const VALID_TYPES: ChartType[] = ['line', 'bar', 'pie', 'scatter']

export function sanitizeDashboardSpec(raw: unknown): DashboardSpec | null {
  if (!raw || typeof raw !== 'object') return null
  const obj = raw as Record<string, unknown>
  if (!Array.isArray(obj.charts)) return null

  const charts: ChartSpec[] = []
  for (const c of obj.charts as Record<string, unknown>[]) {
    if (!c || typeof c !== 'object') continue
    const type = String(c.type ?? '') as ChartType
    if (!VALID_TYPES.includes(type)) continue
    const series: ChartSeries[] = []
    if (Array.isArray(c.series)) {
      for (const s of c.series as Record<string, unknown>[]) {
        if (s && Array.isArray(s.values) && typeof s.name === 'string') {
          series.push({ name: s.name, values: s.values.map((v) => (typeof v === 'number' ? v : Number(v) || 0)) })
        }
      }
    }
    // Allow a pie chart with labels + one series only.
    charts.push({
      id: typeof c.id === 'string' ? c.id : `chart-${charts.length}`,
      type,
      title: typeof c.title === 'string' ? c.title : 'Chart',
      labels: Array.isArray(c.labels) ? c.labels.map(String) : undefined,
      series,
    })
  }

  if (charts.length === 0) return null

  return {
    title: typeof obj.title === 'string' ? obj.title : 'AI Dashboard',
    summary: typeof obj.summary === 'string' ? obj.summary : '',
    createdAt: new Date().toISOString(),
    charts,
  }
}