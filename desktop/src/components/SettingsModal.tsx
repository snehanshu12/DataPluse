import { useEffect, useState } from 'react'
import type { Settings, SettingsView } from '../types'

interface Props {
  open: boolean
  onClose: () => void
  onSaved: (view: SettingsView) => void
}

function Field({ label, hint, ...rest }: { label: string; hint?: string } & React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <label className="field">
      <span className="field-label">{label}</span>
      <input type="text" spellCheck={false} {...rest} />
      {hint && <span className="field-hint">{hint}</span>}
    </label>
  )
}

export default function SettingsModal({ open, onClose, onSaved }: Props) {
  const [view, setView] = useState<SettingsView | null>(null)
  const [form, setForm] = useState<Settings>({})
  /** API key is masked by the main process; never treat its displayed form as a real key. */
  const [apiKey, setApiKey] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [savedAt, setSavedAt] = useState<number | null>(null)

  useEffect(() => {
    if (!open) return
    setError(null)
    setSavedAt(null)
    window.electronAPI
      .getSettings()
      .then((v) => {
        setView(v)
        const s = v.settings
        const d = v.defaults?.llm
        setApiKey(s.llm?.apiKey ?? '')
        setForm({
          llm: {
            baseUrl: s.llm?.baseUrl ?? d?.baseUrl ?? '',
            model: s.llm?.model ?? d?.model ?? '',
          },
        })
      })
      .catch((e) => setError(String(e)))
  }, [open])

  if (!open) return null

  const set = (key: keyof NonNullable<Settings['llm']>, value: string) =>
    setForm((prev) => {
      const llm = { ...(prev.llm as Record<string, string>) }
      if (!value) delete llm[key]
      else llm[key] = value
      return { ...prev, llm: llm as Settings['llm'] }
    })

  const save = async () => {
    setSaving(true)
    setError(null)
    try {
      const d = view?.defaults?.llm
      const llm: Settings['llm'] = {}
      if (form.llm?.baseUrl && form.llm.baseUrl !== d?.baseUrl) llm.baseUrl = form.llm.baseUrl
      if (form.llm?.model && form.llm.model !== d?.model) llm.model = form.llm.model
      // '' means "clear the saved key"; a value equal to the masked hint means
      // "never touched" and is deliberately not forwarded (main keeps the key).
      const savedKey = view?.settings.llm?.apiKey ?? ''
      if (apiKey !== savedKey) llm.apiKey = apiKey
      const v = await window.electronAPI.saveSettings({ llm })
      setSavedAt(Date.now())
      setView(v)
      setApiKey(v.settings.llm?.apiKey ?? '')
      onSaved(v)
    } catch (e) {
      setError(String(e))
    } finally {
      setSaving(false)
    }
  }

  const d = view?.defaults?.llm
  const purgeOnQuit = !!view?.settings.privacy?.clearHistoryOnQuit

  /** Effective override after dropping env-equal values — for the dirty check.
   *  API key is excluded (masked on arrival, not comparable) and tracked via apiKey. */
  const effective: Settings['llm'] = {}
  if (form.llm?.baseUrl && form.llm.baseUrl !== d?.baseUrl) effective.baseUrl = form.llm.baseUrl
  if (form.llm?.model && form.llm.model !== d?.model) effective.model = form.llm.model
  const comparable = ({ baseUrl: b, model: m }: Settings['llm'] = {}) =>
    JSON.stringify({ baseUrl: b ?? null, model: m ?? null })
  const dirty =
    JSON.stringify(effective) !== comparable(view?.settings.llm) ||
    apiKey !== (view?.settings.llm?.apiKey ?? '')

  return (
    <div className="modal-mask" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <h2>模型配置</h2>
          <button className="modal-close" onClick={onClose}>
            ✕
          </button>
        </div>

        <section className="modal-sec">
          <h3>LLM 模型</h3>
          <p className="sec-sub">
            输入框已直接展示项目 .env 的当前生效值；值不变时保存会自动保留「留空=回退 .env」。数据源请在侧边栏「添加数据源」中配置。
          </p>
          <p className="sec-sub sec-privacy">
            隐私提示：问答时数据表 schema（列名与少量样例）及查询结果最多 200 行会发送给下方配置的模型服务。本地问答历史明文保存在本机。
          </p>
          <Field
            label="Base URL"
            hint={d ? `当前生效：${d.baseUrl}` : undefined}
            value={form.llm?.baseUrl ?? ''}
            onChange={(e) => set('baseUrl', e.target.value)}
          />
          <Field
            label="API Key"
            type="password"
            placeholder={view?.settings.llm?.apiKey ? `${apiKey || `••••${view.settings.llm.apiKey.slice(-4)}`}（保留已保存密钥）` : '输入 API Key'}
            hint="密钥只保存在本机设置文件中，界面不回显明文；输入新值以替换，留空并保存则清除（回退 .env）"
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
          />
          <Field
            label="Model"
            hint={d ? `当前生效：${d.model}` : undefined}
            value={form.llm?.model ?? ''}
            onChange={(e) => set('model', e.target.value)}
          />
        </section>

        <section className="modal-sec">
          <h3>隐私</h3>
          <label className="check-row">
            <input
              type="checkbox"
              checked={purgeOnQuit}
              onChange={(e) => {
                const next = { ...(view?.settings.privacy ?? {}), clearHistoryOnQuit: e.target.checked }
                setView((prev) => (prev ? { ...prev, settings: { ...prev.settings, privacy: next } } : prev))
                window.electronAPI.saveSettings({ privacy: next }).then(
                  (v) => {
                    setView(v)
                    onSaved(v)
                  },
                  (err) => {
                    setError(err instanceof Error ? err.message : String(err))
                    // revert the optimistic checkbox so the UI doesn't lie
                    setView((prev) =>
                      prev
                        ? {
                            ...prev,
                            settings: {
                              ...prev.settings,
                              privacy: { ...prev.settings.privacy, clearHistoryOnQuit: !next.clearHistoryOnQuit },
                            },
                          }
                        : prev,
                    )
                  },
                )
              }}
            />
            <span className="check-label">退出时自动清空本机的问答历史（localStorage）</span>
          </label>
        </section>

        <div className="modal-foot">
          {savedAt && <span className="saved-ok">已保存 ✓</span>}
          {error && <span className="saved-err">{error}</span>}
          <button className="btn-ghost" onClick={onClose}>
            取消
          </button>
          <button className="btn-primary" onClick={save} disabled={saving || !dirty}>
            {saving ? '保存中…' : '保存'}
          </button>
        </div>
      </div>
    </div>
  )
}