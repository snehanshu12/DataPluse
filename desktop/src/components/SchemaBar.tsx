import { useEffect, useRef, useState } from 'react'
import type { SourceDef, StarterTable, TablePreview } from '../types'

interface Props {
  tables: StarterTable[]
  loading: boolean
  source: SourceDef
  onPreview: (source: SourceDef, table: string, limit: number) => Promise<TablePreview>
}

function cell(v: string | number | boolean | null): string {
  if (v === null || v === undefined) return '—'
  const s = String(v)
  return s.length > 12 ? s.slice(0, 12) + '…' : s
}

const MIN_HEIGHT = 140
const MAX_HEIGHT = 560
const DEFAULT_HEIGHT = 260

/** The actual data grid — shared by the inline panel and the fullscreen view. */
function DataTable({ view }: { view: TablePreview }) {
  return (
    <table className="schema-expand-table">
      <thead>
        <tr>
          {view.columns.map((c, i) => (
            <th key={i}>{String(c)}</th>
          ))}
        </tr>
      </thead>
      <tbody>
        {view.rows.map((row, ri) => (
          <tr key={ri}>
            {row.map((v, ci) => (
              <td key={ci}>{v === null || v === undefined ? '—' : String(v)}</td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  )
}

function TableChip({ t, source, onPreview }: { t: StarterTable; source: SourceDef; onPreview: Props['onPreview'] }) {
  const [open, setOpen] = useState(false)
  const [view, setView] = useState<TablePreview | null>(null)
  const [fetching, setFetching] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [height, setHeight] = useState(DEFAULT_HEIGHT)
  const [full, setFull] = useState(false)
  const drag = useRef<{ y: number; start: number } | null>(null)
  const cache = useRef<TablePreview | null>(null)

  // Deps deliberately exclude the state this effect writes (fetching/view/err):
  // including them makes every state flip re-run the effect, whose cleanup then
  // cancels the in-flight IPC promise — a repeat-forever loader. Only the open
  // toggle and props may start/restart the fetch.
  useEffect(() => {
    if (!open) return
    if (cache.current) {
      setView(cache.current)
      return
    }
    let cancel = false
    setFetching(true)
    setErr(null)
    // Guard against a missing/stale preload binding (old main process): a
    // synchronous throw must become a visible error, not a permanent spinner.
    let pending: Promise<TablePreview>
    try {
      pending = onPreview(source, t.name, 100)
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e))
      setFetching(false)
      return
    }
    pending
      .then((p) => {
        if (cancel) return
        cache.current = p
        setView(p)
      })
      .catch((e: unknown) => {
        if (!cancel) setErr(e instanceof Error ? e.message : String(e))
      })
      .finally(() => {
        if (!cancel) setFetching(false)
      })
    return () => {
      cancel = true
    }
  }, [open, source, t.name, onPreview])

  // ESC exits fullscreen.
  useEffect(() => {
    if (!full) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setFull(false)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [full])

  const onResizeStart = (e: React.PointerEvent<HTMLDivElement>) => {
    e.preventDefault()
    drag.current = { y: e.clientY, start: height }
    const onMove = (ev: PointerEvent) => {
      const d = drag.current
      if (!d) return
      setHeight(Math.max(MIN_HEIGHT, Math.min(MAX_HEIGHT, d.start + ev.clientY - d.y)))
    }
    const onUp = () => {
      drag.current = null
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
    }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
  }

  return (
    <div
        className={`table-chip${open ? ' expanded' : ''}`}
        title={`${t.name} · ${t.columns.length} 列`}
      >
      <div className="table-chip-head">
        <span className="table-chip-name">{t.name}</span>
        <span className="table-chip-meta">
          {typeof t.rows === 'number' ? `${t.rows} 行 ${t.columns.length} 列` : `${t.columns.length} 列`}
        </span>
        <button
          className="chip-expand"
          title={open ? '收起数据' : '展开数据'}
          onClick={() => setOpen((o) => !o)}
        >
          {open ? '▴ 收起' : '▾ 展开'}
        </button>
      </div>
      {t.preview && !open && (
        <table className="table-chip-preview">
          <tbody>
            <tr>
              <th className="preview-label">行</th>
              {t.preview.columns.map((c, i) => (
                <th key={i}>{cell(c)}</th>
              ))}
            </tr>
            <tr>
              <td className="preview-label">首</td>
              {t.preview.values.map((v, i) => (
                <td key={i}>{cell(v)}</td>
              ))}
            </tr>
            {t.preview.last && (
              <tr>
                <td className="preview-label">末</td>
                {t.preview.last.map((v, i) => (
                  <td key={i}>{cell(v)}</td>
                ))}
              </tr>
            )}
          </tbody>
        </table>
      )}
      {open && (
        <div className="schema-expand" style={{ height: `${height}px` }}>
          <div className="schema-expand-banner">
            <span className="schema-expand-meta">
              {view ? `${view.table} · 共 ${view.total ?? '?'} 行 · 显示前 ${view.rows.length} 行` : t.name}
            </span>
            <button
              className="schema-fs"
              title="全屏查看数据"
              disabled={!view || fetching}
              onClick={() => setFull(true)}
            >
              ⛶ 全屏
            </button>
          </div>
          <div className="schema-expand-scroll">
            {view ? (
              <DataTable view={view} />
            ) : fetching ? (
              <div className="schema-expand-loading">加载数据…</div>
            ) : (
              <div className="schema-expand-loading">{err || '加载失败'}</div>
            )}
          </div>
          <div className="schema-resize" onPointerDown={onResizeStart} title="上下拖动调整数据区域高度" />
        </div>
      )}
      {full && view && (
        <div className="schema-fullscreen" onClick={() => setFull(false)}>
          <div className="schema-fs-head" onClick={(e) => e.stopPropagation()}>
            <span className="schema-expand-meta">
              {view.table} · 共 {view.total ?? '?'} 行 · 显示前 {view.rows.length} 行
            </span>
            <button className="schema-fs" title="退出全屏 (Esc)" onClick={() => setFull(false)}>
              ✕ 退出全屏
            </button>
          </div>
          <div className="schema-expand-scroll" onClick={(e) => e.stopPropagation()}>
            <DataTable view={view} />
          </div>
        </div>
      )}
    </div>
  )
}

export default function SchemaBar({ tables, loading, source, onPreview }: Props) {
  if (tables.length === 0 && !loading) return null
  return (
    <div className="schema-bar">
      <span className="schema-bar-label">{loading ? '解析数据表…' : '数据表'}</span>
      {tables.map((t) => (
        <TableChip key={t.name} t={t} source={source} onPreview={onPreview} />
      ))}
    </div>
  )
}