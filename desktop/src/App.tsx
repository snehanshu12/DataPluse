import { useCallback, useEffect, useRef, useState } from 'react'
import type { PointerEvent as ReactPointerEvent } from 'react'
import Sidebar from './components/Sidebar'
import Chat from './components/Chat'
import EmptyState from './components/EmptyState'
import Composer from './components/Composer'
import SettingsModal from './components/SettingsModal'
import SourceDialog from './components/SourceDialog'
import SchemaBar from './components/SchemaBar'
import type { EnvInfo, HistoryItem, SettingsView, SourceDef, StarterTable, Thread, Turn } from './types'
import { sessionKeyOf } from './types'
import { ensureChartHint } from './starterQuestions'

const HISTORY_KEY = 'cp.history.v2'
const SOURCE_KEY = 'cp.activeSource'
const SIDEBAR_KEY = 'cp.sidebarWidth'
const SIDEBAR_MIN = 220
const SIDEBAR_MAX = 480

/** Questions that signal a visual dashboard request instead of a plain answer. */
const CHART_INTENT = /(dashboard|图表|可视化|画(?:个)?图|柱状图|饼图|折线图|趋势图|分布图|占比)/i
function hasChartIntent(q: string): boolean {
  return CHART_INTENT.test(q)
}

const LEGACY_SOURCE: Record<string, SourceDef> = {
  ecommerce: { id: 'ecommerce', name: '电商（示例）', type: 'sqlite', dbPath: 'data/ecommerce.db' },
  crm: { id: 'crm', name: 'CRM（示例）', type: 'postgres' },
  mysql: { id: 'mysql', name: 'MySQL（示例）', type: 'mysql' },
}

/** History items only need the source identity (lookup by id); never persist the
 *  connection string / URL with its credentials into localStorage. */
function minSource(s: SourceDef): SourceDef {
  return { id: s.id, name: s.name, type: s.type }
}

/** 会话归组键：老数据没有 sessionId 时退化为按每条自成一组。 */
function loadHistory(): HistoryItem[] {
  try {
    const raw: HistoryItem[] = JSON.parse(localStorage.getItem(HISTORY_KEY) || '[]')
    return raw.map((h) => {
      const src =
        typeof h.source === 'string' ? LEGACY_SOURCE[h.source] || LEGACY_SOURCE.ecommerce : h.source
      return { ...h, source: src }
    })
  } catch {
    return []
  }
}

export default function App() {
  const [history, setHistory] = useState<HistoryItem[]>(loadHistory)
  const [sources, setSources] = useState<SourceDef[]>([])
  const [activeSourceId, setActiveSourceId] = useState<string | null>(() => localStorage.getItem(SOURCE_KEY))
  const [activeQ, setActiveQ] = useState<string | null>(null)
  const [thread, setThread] = useState<Thread | null>(null)
  const [busy, setBusy] = useState(false)
  const [env, setEnv] = useState<EnvInfo | null>(null)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [dialogOpen, setDialogOpen] = useState(false)
  const [focusNonce, setFocusNonce] = useState(0)
  const [startersMap, setStartersMap] = useState<Record<string, string[]>>({})
  const [tablesMap, setTablesMap] = useState<Record<string, StarterTable[]>>({})
  const [startersLoading, setStartersLoading] = useState(false)
  const [sidebarWidth, setSidebarWidth] = useState(() => {
    const saved = Number(localStorage.getItem(SIDEBAR_KEY))
    return Number.isFinite(saved) && saved >= SIDEBAR_MIN && saved <= SIDEBAR_MAX ? saved : 260
  })
  const chatRef = useRef<HTMLDivElement>(null)
  const threadRef = useRef<Thread | null>(null)
  /** 已经拉过起手式问题的数据源，避免 effect 重复触发。 */
  const startersFetched = useRef<Set<string>>(new Set())
  /** 当前会话 id：没被「新问题/换源/清历史」打断时，连续追问共用同一个。 */
  const sessionRef = useRef<string | null>(null)

  useEffect(() => {
    window.electronAPI
      .getSettings()
      .then((v) => {
        setSources(v.settings.sources || [])
        setEnv(v.defaults.llm)
      })
      .catch(() => setEnv(null))
  }, [])

  const activeSource: SourceDef | null =
    sources.find((s) => s.id === activeSourceId) || sources[0] || null

  useEffect(() => {
    const src = activeSource
    if (!src || startersFetched.current.has(src.id)) return
    startersFetched.current.add(src.id)
    let cancel = false
    setStartersLoading(true)
    window.electronAPI
      .getStarters(src)
      .then((r) => {
        if (cancel) return
        if (r.questions.length) setStartersMap((m) => ({ ...m, [src.id]: r.questions }))
        if (r.tables?.length) setTablesMap((m) => ({ ...m, [src.id]: r.tables as StarterTable[] }))
      })
      .catch(() => {
        // keep the generic fallback on error
      })
      .finally(() => {
        if (!cancel) setStartersLoading(false)
      })
    return () => {
      cancel = true
    }
  }, [activeSource?.id])

  const refreshStarters = useCallback((src: SourceDef) => {
    if (!src) return
    setStartersLoading(true)
    window.electronAPI
      .getStarters(src, true)
      .then((r) => {
        if (r.questions.length) setStartersMap((m) => ({ ...m, [src.id]: r.questions }))
        if (r.tables?.length) setTablesMap((m) => ({ ...m, [src.id]: r.tables as StarterTable[] }))
      })
      .catch(() => {
        // keep the current list on error; the generic fallback still covers the source
      })
      .finally(() => setStartersLoading(false))
  }, [])

  const resizeStart = useCallback((e: ReactPointerEvent<HTMLDivElement>) => {
    const target = e.currentTarget
    target.setPointerCapture(e.pointerId)
    const move = (ev: PointerEvent) => {
      const w = Math.min(SIDEBAR_MAX, Math.max(SIDEBAR_MIN, ev.clientX))
      setSidebarWidth(w)
      localStorage.setItem(SIDEBAR_KEY, String(w))
    }
    const done = () => {
      target.removeEventListener('pointermove', move)
      target.removeEventListener('pointerup', done)
      target.removeEventListener('pointercancel', done)
    }
    target.addEventListener('pointermove', move)
    target.addEventListener('pointerup', done)
    target.addEventListener('pointercancel', done)
  }, [])

  const scrollBottom = useCallback(() => {
    requestAnimationFrame(() => {
      const el = chatRef.current
      if (el) el.scrollTop = el.scrollHeight
    })
  }, [])

  useEffect(() => {
    scrollBottom()
  }, [thread, busy, scrollBottom])

  const getTablePreview = useCallback(
    (src: SourceDef, table: string, limit: number) => window.electronAPI.getTablePreview(src, table, limit),
    [],
  )

  const switchSource = useCallback((id: string) => {
    setActiveSourceId(id)
    localStorage.setItem(SOURCE_KEY, id)
    sessionRef.current = null
    setActiveQ(null)
    setThread(null)
    setBusy(false)
    setFocusNonce((n) => n + 1)
  }, [])

  const ask = useCallback(
    async (question: string) => {
      const q = question.trim()
      if (!q || busy || !activeSource) return
      const src = activeSource
      const wantCharts = hasChartIntent(q)
      setBusy(true)
      setActiveQ(q)
      const sid = sessionRef.current ?? (sessionRef.current = `s-${Date.now()}`)
      const pending: Turn = {
        user: q,
        answer: null,
        events: [],
        followUps: [],
        status: wantCharts ? `正在生成图表「${q}」…` : `Agent 正在分析「${q}」…`,
      }
      // 多轮：问答累积在同一会话里，并把最近几轮作为上下文带上。
      setThread((prev) => ({ turns: [...(prev?.turns ?? []), pending] }))
      // 结果写回前校验会话仍有效：换源/新问题/删历史会让 sessionRef 变化或置空，
      // 此时晚到的响应必须丢弃，不能污染新会话。
      const stillActive = () => sessionRef.current === sid
      try {
        if (wantCharts) {
          const spec = await window.electronAPI.getDashboard(src, q)
          if (!stillActive()) return
          const answer = spec.summary || ''
          setThread((prev) => {
            const turns = (prev?.turns ?? []).slice()
            turns[turns.length - 1] = { user: q, answer, events: [], followUps: [], charts: spec }
            return { turns }
          })
          setHistory((prev) => {
            const item: HistoryItem = { ts: Date.now(), q, answer, events: [], followUps: [], source: minSource(src), charts: spec, sessionId: sid }
            const next = [item, ...prev].slice(0, 50)
            localStorage.setItem(HISTORY_KEY, JSON.stringify(next))
            return next
          })
        } else {
          const history = (threadRef.current?.turns ?? [])
            .filter((t) => t.answer != null)
            .slice(-6)
            .map((t) => ({ question: t.user, answer: t.answer as string }))
          const msg = await window.electronAPI.ask(src, q, history.length ? { history } : undefined)
          if (!stillActive()) return
          const events = msg.events || []
          const followUps = ensureChartHint(msg.followUps || [], '画个柱状图：直观对比刚才的结果')
          setThread((prev) => {
            const turns = (prev?.turns ?? []).slice()
            turns[turns.length - 1] = { user: q, answer: msg.answer, events, followUps }
            return { turns }
          })
          setHistory((prev) => {
            const item: HistoryItem = { ts: Date.now(), q, answer: msg.answer, events, followUps, source: minSource(src), sessionId: sid }
            const next = [item, ...prev].slice(0, 50)
            localStorage.setItem(HISTORY_KEY, JSON.stringify(next))
            return next
          })
        }
      } catch (err) {
        if (!stillActive()) return
        const text = err instanceof Error ? err.message : typeof err === 'string' ? err : JSON.stringify(err)
        setThread((prev) => {
          const turns = (prev?.turns ?? []).slice()
          turns[turns.length - 1] = { ...turns[turns.length - 1], error: text, status: undefined }
          return { turns }
        })
      } finally {
        if (stillActive()) {
          setBusy(false)
          setFocusNonce((n) => n + 1)
        }
      }
    },
    [busy, activeSource],
  )

  /** 打开一个历史会话：按时间正序恢复成多轮对话视图，并续接该会话。 */
  const showSession = useCallback(
    (items: HistoryItem[]) => {
      const root = items[items.length - 1]
      if (!root) return
      setActiveQ(items[0]!.q)
      sessionRef.current = root.sessionId ?? `s-${root.ts}`
      if (root.source && root.source.id !== activeSourceId) {
        setActiveSourceId(root.source.id)
        localStorage.setItem(SOURCE_KEY, root.source.id)
      }
      const turns: Turn[] = [...items].reverse().map((it) => ({
        user: it.q,
        answer: it.answer,
        events: it.events || [],
        followUps: it.followUps || [],
        charts: it.charts ?? null,
      }))
      setThread({ turns })
    },
    [activeSourceId],
  )

  const deleteSession = useCallback(
    (key: string) => {
      const doomed = history.filter((h) => sessionKeyOf(h) === key)
      setHistory((prev) => {
        const next = prev.filter((h) => sessionKeyOf(h) !== key)
        localStorage.setItem(HISTORY_KEY, JSON.stringify(next))
        return next
      })
      if (doomed.some((h) => h.q === activeQ)) {
        setActiveQ(null)
        setThread(null)
        sessionRef.current = null
        setBusy(false)
      }
    },
    [history, activeQ],
  )

  const newChat = useCallback(() => {
    sessionRef.current = null
    setActiveQ(null)
    setThread(null)
    setBusy(false)
    setFocusNonce((n) => n + 1)
  }, [])

  const clearHistory = useCallback(() => {
    if (history.length === 0) return
    if (!window.confirm('清空全部问题历史？')) return
    localStorage.removeItem(HISTORY_KEY)
    setHistory([])
    sessionRef.current = null
    setActiveQ(null)
    setThread(null)
    setBusy(false)
  }, [history])

  const clearSources = useCallback(() => {
    if (sources.length === 0) return
    if (!window.confirm('清空全部数据源（同时删除已导入的 CSV 库文件）？')) return
    const next: SourceDef[] = []
    window.electronAPI.clearSources().then(
      (v) => {
        setSources(v.settings.sources || next)
        setEnv(v.defaults.llm)
      },
      () => setSources(next),
    )
    setActiveSourceId(null)
    localStorage.removeItem(SOURCE_KEY)
    setThread(null)
    setActiveQ(null)
    setBusy(false)
    setFocusNonce((n) => n + 1)
  }, [sources])

  const onSettingsSaved = useCallback((view: SettingsView) => {
    setEnv(view.defaults.llm)
  }, [])

  const addSource = useCallback(
    (def: SourceDef) => {
      const next = [...sources, def]
      window.electronAPI.saveSettings({ sources: next }).then(
        (v) => {
          setSources(v.settings.sources || next)
          setEnv(v.defaults.llm)
        },
        () => setSources(next),
      )
      setActiveSourceId(def.id)
      localStorage.setItem(SOURCE_KEY, def.id)
      setThread(null)
      setActiveQ(null)
      setBusy(false)
      setFocusNonce((n) => n + 1)
    },
    [sources],
  )

  const deleteSource = useCallback(
    (id: string) => {
      const target = sources.find((s) => s.id === id)
      const next = sources.filter((s) => s.id !== id)
      if (target) {
        window.electronAPI.removeSource(target).then(
          (v) => {
            setSources(v.settings.sources || next)
            setEnv(v.defaults.llm)
          },
          () => setSources(next),
        )
      } else {
        setSources(next)
      }
      if (activeSourceId === id) {
        const fallback = next[0] || null
        setActiveSourceId(fallback ? fallback.id : null)
        if (fallback) localStorage.setItem(SOURCE_KEY, fallback.id)
        else localStorage.removeItem(SOURCE_KEY)
        setThread(null)
        setActiveQ(null)
        setBusy(false)
        setFocusNonce((n) => n + 1)
      }
    },
    [sources, activeSourceId],
  )

  const showEmpty = !thread
  threadRef.current = thread

  return (
    <div className="app">
      <Sidebar
        history={history}
        activeQ={activeQ}
        env={env}
        sources={sources}
        activeSourceId={activeSourceId}
        width={sidebarWidth}
        onSourceChange={switchSource}
        onAddSource={() => setDialogOpen(true)}
        onDeleteSource={deleteSource}
        onClearSources={clearSources}
        onNew={newChat}
        onSelect={showSession}
        onDelete={deleteSession}
        onClearHistory={clearHistory}
      />
      <div className="resize-handle" onPointerDown={resizeStart} />
      <main className="main">
        <header className="toolbar">
          <div className="hint">
            {env ? `LLM: ${env.model} · ${env.baseUrl}` : 'backend not ready'}
            {activeSource && <span className="toolbar-src">{activeSource.name}</span>}
          </div>
          <button className="gear" title="模型配置" onClick={() => setSettingsOpen(true)}>
            ⚙
          </button>
        </header>
        <div className="schema-slot">
          {activeSource && tablesMap[activeSource.id] && (
            <SchemaBar
              tables={tablesMap[activeSource.id]}
              loading={startersLoading}
              source={activeSource}
              onPreview={getTablePreview}
            />
          )}
        </div>
        <div className="chat" ref={chatRef}>
          {showEmpty ? (
            <EmptyState
              source={activeSource}
              starters={activeSource && startersMap[activeSource.id] ? ensureChartHint(startersMap[activeSource.id]!, '画个柱状图：直观对比各类别的数量') : null}
              loading={startersLoading}
              onRefresh={activeSource ? () => refreshStarters(activeSource) : undefined}
              onAsk={ask}
            />
          ) : (
            <Chat thread={thread} onAsk={ask} />
          )}
        </div>
        <Composer
          source={activeSource}
          disabled={busy}
          focusNonce={focusNonce}
          onSubmit={ask}
        />
        <SettingsModal open={settingsOpen} onClose={() => setSettingsOpen(false)} onSaved={onSettingsSaved} />
        {dialogOpen && <SourceDialog onClose={() => setDialogOpen(false)} onCreated={addSource} />}
      </main>
    </div>
  )
}