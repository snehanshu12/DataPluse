import { lazy, Suspense, useState } from 'react'
import type { DashboardSpec, ToolEvent } from '../types'
import ToolCallCard from './ToolCallCard'
import Markdown from './Markdown'
import { classifyRisks } from '../risks'

/** ECharts is heavy; load the whole dashboard card tree on demand so the
 *  initial bundle stays small (charts are generated rarely per question). */
const DashboardCard = lazy(() => import('./DashboardCard'))

interface Props {
  events: ToolEvent[]
  answer: string
  question?: string
  charts?: DashboardSpec | null
}

export default function AssistantMsg({ events, answer, question, charts }: Props) {
  const risks = classifyRisks(question ?? '', events)
  const [copied, setCopied] = useState(false)
  const [armed, setArmed] = useState(false)

  const copy = async () => {
    // Adoption gate: risky answers require an explicit second click.
    if (risks.length > 0 && !armed) {
      setArmed(true)
      setTimeout(() => setArmed(false), 5000)
      return
    }
    try {
      await window.electronAPI.writeClipboard(answer)
      setCopied(true)
      setArmed(false)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      // clipboard unavailable — ignore
    }
  }

  const label = copied
    ? '已复制 ✓'
    : armed
      ? '再点一次确认复制'
      : risks.length > 0
        ? '⚠ 核对后再复制'
        : '复制回答'

  return (
    <div className="msg assistant">
      <div className="role">AI</div>
      <div className="bubble">
        {risks.length > 0 && (
          <ul className={`answer-caution ${armed ? 'armed' : ''}`}>
            {risks.map((r) => (
              <li key={r.id} className={r.level}>
                {r.message}
              </li>
            ))}
          </ul>
        )}
        {charts ? (
          <Suspense fallback={<div className="dashboard-card">图表加载中…</div>}>
            <DashboardCard spec={charts} />
          </Suspense>
        ) : (
          events.map((ev, i) => (
            <ToolCallCard key={i} ev={ev} defaultOpen={ev.name === 'sql_fix'} />
          ))
        )}
        <Markdown md={answer} />
        <div className="answer-tools">
          <button type="button" className={`copy-btn${copied ? ' copied' : ''}`} onClick={copy}>
            {label}
          </button>
        </div>
      </div>
    </div>
  )
}