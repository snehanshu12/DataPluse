import { useEffect, useState } from 'react'
import type { DashboardSpec } from '../types'
import ChartCard from './ChartCard'

/** In-app rendering of an AI-generated dashboard (charts only; the summary
 *  markdown flows through the normal answer area below). Supports a fullscreen
 *  overlay for inspecting the charts at a comfortable size. */
export default function DashboardCard({ spec }: { spec: DashboardSpec | null | undefined }) {
  const [full, setFull] = useState(false)

  useEffect(() => {
    if (!full) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setFull(false)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [full])

  if (!spec || !Array.isArray(spec.charts) || spec.charts.length === 0) return null

  const grid = (charts: DashboardSpec['charts']) => (
    <div className="dashboard-grid">
      {charts.map((c, i) => (
        <ChartCard key={c.id || `chart-${i}`} c={c} />
      ))}
    </div>
  )

  return (
    <div className="dashboard-card">
      <div className="dashboard-head">
        <div className="dashboard-title">{spec.title}</div>
        <button className="fs-btn" title="全屏查看图表" onClick={() => setFull(true)}>
          ⛶ 全屏
        </button>
      </div>
      {grid(spec.charts)}
      <div className="dashboard-note">
        以上图表由 AI 基于查询结果自动生成，仅供快速浏览；关键数字请结合上方 SQL 与数据表核对。
      </div>
      {full && (
        <div
          className="dashboard-fullscreen"
          onClick={(e) => {
            if (e.target === e.currentTarget) setFull(false)
          }}
        >
          <div className="fs-head">
            <span className="fs-title">{spec.title}</span>
            <button className="fs-btn fs-close" onClick={() => setFull(false)}>
              ✕ 退出全屏
            </button>
          </div>
          <div className="fs-body">{grid(spec.charts)}</div>
        </div>
      )}
    </div>
  )
}
