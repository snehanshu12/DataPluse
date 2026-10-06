import { useMemo } from 'react'
import type { EnvInfo, HistoryItem, SourceDef } from '../types'
import { sessionKeyOf } from '../types'
import { TYPE_LABEL, redactConnectionUrl } from '../starterQuestions'

interface Props {
  history: HistoryItem[]
  activeQ: string | null
  env: EnvInfo | null
  sources: SourceDef[]
  activeSourceId: string | null
  width?: number
  onSourceChange: (id: string) => void
  onAddSource: () => void
  onDeleteSource: (id: string) => void
  onClearSources: () => void
  onNew: () => void
  onSelect: (items: HistoryItem[]) => void
  onDelete: (key: string) => void
  onClearHistory: () => void
}

/** 侧栏「历史」按会话聚合成一条：一段连续问答只占一条记录。 */
export default function Sidebar({
  history,
  activeQ,
  env,
  sources,
  activeSourceId,
  onSourceChange,
  onAddSource,
  onDeleteSource,
  onClearSources,
  onNew,
  onSelect,
  onDelete,
  onClearHistory,
  width,
}: Props) {
  const active = sources.find((s) => s.id === activeSourceId) || sources[0] || null

  const groups = useMemo(() => {
    const byKey = new Map<string, HistoryItem[]>()
    for (const it of history) {
      const k = sessionKeyOf(it)
      if (!byKey.has(k)) byKey.set(k, [])
      byKey.get(k)!.push(it)
    }
    const list = [...byKey.entries()].map(([key, items]) => ({ key, items }))
    // 组内按追加顺序排列（最新在前）；按每条会话的开始时间倒序展示。
    list.sort((a, b) => b.items[b.items.length - 1]!.ts - a.items[a.items.length - 1]!.ts)
    return list
  }, [history])

  return (
    <aside className="sidebar" style={width ? { width, minWidth: width } : undefined}>
      <div className="brand">
        <span className="logo">◆</span>
        <div>
          <h1>DataPulse</h1>
          <p>AI BI Console</p>
        </div>
      </div>

      <div className="label-row">
        <span className="src-label">数据源</span>
        <button className="clear-link" onClick={onClearSources} title="清空全部数据源">
          清空
        </button>
      </div>
      <ul className="src-list">
        {sources.map((s) => (
          <li key={s.id}>
            <button
              className={`src-item${active && active.id === s.id ? ' active' : ''}`}
              onClick={() => onSourceChange(s.id)}
            >
              <span className={`src-type src-type-${s.type}`}>{TYPE_LABEL[s.type]}</span>
              <span className="src-name">{s.name}</span>
            </button>
            <button className="src-del" title="删除数据源" onClick={() => onDeleteSource(s.id)}>
              ✕
            </button>
          </li>
        ))}
        {sources.length === 0 && <li className="src-empty">暂无数据源，请先添加。</li>}
      </ul>
      <button className="add-src" onClick={onAddSource}>
        ＋ 添加数据源
      </button>
      {active && (
        <div className="source-hint">
          {active.type === 'sqlite' ? `SQLite · ${active.dbPath}` : `${active.type} · ${redactConnectionUrl(active.url ?? '')}`}
        </div>
      )}

      <button className="new-btn" onClick={onNew}>
        ＋ 新问题
      </button>
      <div className="label-row">
        <div className="history-label">历史</div>
        <button className="clear-link" onClick={onClearHistory} title="清空全部问题历史">
          清空
        </button>
      </div>
      <ul className="history">
        {groups.map(({ key, items }) => {
          const first = items[items.length - 1]!
          const last = items[0]!
          const isActive = activeQ != null && items.some((it) => it.q === activeQ)
          const turns = items.length
          return (
            <li key={key} className={isActive ? 'active' : ''} onClick={() => onSelect(items)}>
              <span className="src-badge" data-type={first.source.type}>
                {first.source.name}
              </span>
              <span className="session-q">{first.q}</span>
              {turns > 1 && <span className="session-meta">· {turns} 问</span>}
              <button
                className="del"
                title="删除整个会话"
                onClick={(e) => {
                  e.stopPropagation()
                  onDelete(key)
                }}
              >
                ✕
              </button>
            </li>
          )
        })}
      </ul>
      <div className="env-badge">{env ? `model: ${env.model}\n${env.baseUrl}` : 'backend not ready'}</div>
    </aside>
  )
}