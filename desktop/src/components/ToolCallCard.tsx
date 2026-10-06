import type { ToolEvent } from '../types'

export default function ToolCallCard({ ev, defaultOpen = false }: { ev: ToolEvent; defaultOpen?: boolean }) {
  const args = ev.args || {}
  const sql = typeof args.sql === 'string' ? args.sql : JSON.stringify(args, null, 2)
  const preview = ev.result ? ev.result.slice(0, 1200) : ''
  return (
    <details className="tool-call" open={defaultOpen}>
      <summary>{ev.name || 'tool'} · 已执行</summary>
      <pre>
        <div className="sql">{sql}</div>
        <div className="result">{preview}</div>
      </pre>
    </details>
  )
}
