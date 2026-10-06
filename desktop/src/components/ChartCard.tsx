import { useEffect, useRef } from 'react'
import * as echarts from 'echarts/core'
import { BarChart, LineChart, PieChart, ScatterChart } from 'echarts/charts'
import { GridComponent, LegendComponent, TooltipComponent } from 'echarts/components'
import { CanvasRenderer } from 'echarts/renderers'
import type { EChartsCoreOption } from 'echarts/core'
import type { ChartSpec } from '../types'

echarts.use([
  BarChart,
  LineChart,
  PieChart,
  ScatterChart,
  GridComponent,
  LegendComponent,
  TooltipComponent,
  CanvasRenderer,
])

/** Mirror of src/bi/render.ts chartOption — keeps server-side HTML export and
 *  the in-app canvas consistent. Charts run fully local (no CDN). */
function optionFor(c: ChartSpec): EChartsCoreOption {
  const labels = c.labels ?? c.series[0]?.values.map((_, i) => String(i + 1)) ?? []

  if (c.type === 'pie') {
    const data = labels.map((label, i) => ({
      name: label,
      value: c.series[0]?.values[i] ?? 0,
    }))
    return {
      tooltip: { trigger: 'item' },
      legend: { type: 'scroll', bottom: 0 },
      series: [{ name: c.title, type: 'pie', radius: ['35%', '70%'], data }],
    }
  }

  return {
    tooltip: { trigger: 'axis' },
    legend: { bottom: 0 },
    grid: { left: 48, right: 24, top: 36, bottom: 48 },
    xAxis: { type: 'category', data: labels, axisLabel: { rotate: labels.length > 8 ? 30 : 0 } },
    yAxis: { type: 'value' },
    series: c.series.map((s) => ({
      name: s.name,
      type: c.type,
      data: s.values,
      smooth: c.type === 'line',
      areaStyle: c.type === 'line' ? { opacity: 0.15 } : undefined,
    })),
  }
}

export default function ChartCard({ c }: { c: ChartSpec }) {
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const el = ref.current
    if (!el) return
    const chart = echarts.init(el)
    chart.setOption(optionFor(c))
    const onResize = () => chart.resize()
    window.addEventListener('resize', onResize)
    return () => {
      window.removeEventListener('resize', onResize)
      chart.dispose()
    }
  }, [c])

  return (
    <div className="chart-card">
      <div className="chart-card-title">{c.title}</div>
      <div ref={ref} className="chart-canvas" />
    </div>
  )
}