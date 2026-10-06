import { useEffect, useState } from 'react'
import type { CsvImportResult, SourceDef, SourceType } from '../types'
import { TYPE_HINT, TYPE_LABEL } from '../starterQuestions'

type Mode = SourceType | 'csv'

interface Props {
  onClose: () => void
  onCreated: (def: SourceDef) => void
}

const TAB_ORDER: Mode[] = ['sqlite', 'csv', 'postgres', 'mysql']

/** 默认连接串与名称，对应 docker/compose.yml 里映射到本机的示例服务。 */
const SERVER_DEFAULTS: Record<Exclude<Mode, 'sqlite' | 'csv'>, { url: string; name: string }> = {
  postgres: { url: 'postgres://postgres:postgres@127.0.0.1:5433/crm', name: 'CRM（示例）' },
  mysql: { url: 'mysql://root:root@127.0.0.1:3307/library', name: 'MySQL 图书借阅（示例）' },
}

/** SQLite 内置示例库（项目 data/ecommerce.db，相对根目录解析）。 */
const SQLITE_DEFAULT = { name: '电商（示例）', path: 'data/ecommerce.db' }

function slugify(name: string): string {
  const s = name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9\u4e00-\u9fa5_-]+/g, '-')
    .replace(/^-+|-+$/g, '')
  return `${s || 'source'}-${Date.now().toString(36)}`
}

function basenameStem(p: string): string {
  const base = p.split(/[\\/]/).pop() || ''
  return base.replace(/\.[^.]+$/, '')
}

/** 默认名 = 所在目录名_文件名（如 money_csv_202601_资产汇总-表格1）。 */
function dirPrefixedStem(p: string): string {
  const parts = p.replace(/\\/g, '/').split('/').filter(Boolean)
  const file = parts.pop()?.replace(/\.[^.]+$/, '') || ''
  const dir = parts[parts.length - 1] || ''
  return dir && dir !== '.' ? `${dir}_${file}` : file
}

export default function SourceDialog({ onClose, onCreated }: Props) {
  const [mode, setMode] = useState<Mode>('sqlite')
  const [name, setName] = useState('')
  const [path, setPath] = useState('')
  const [table, setTable] = useState('')
  const [url, setUrl] = useState('')
  const [busy, setBusy] = useState(false)
  const [info, setInfo] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (mode === 'sqlite') {
      setName(SQLITE_DEFAULT.name)
      setPath(SQLITE_DEFAULT.path)
    } else if (mode === 'csv') {
      setName('')
      setPath('')
      setTable('')
    } else {
      const d = SERVER_DEFAULTS[mode]
      setUrl(d.url)
      setName(d.name)
    }
  }, [mode])

  const pickSqlite = async () => {
    setError(null)
    setInfo(null)
    try {
      const r = await window.electronAPI.pickSqlite()
      if (r) {
        setPath(r.path)
        if (!name) setName(basenameStem(r.path))
      }
    } catch (e) {
      setError(String(e))
    }
  }

  const pickCsv = async () => {
    setError(null)
    setInfo(null)
    try {
      const r = await window.electronAPI.pickCsv()
      if (r) {
        setPath(r.path)
        const stem = dirPrefixedStem(r.path)
        if (!name) setName(stem)
        if (!table) setTable(stem)
      }
    } catch (e) {
      setError(String(e))
    }
  }

  const addSqlite = async () => {
    setError(null)
    setInfo(null)
    if (!path) return setError('请先选择 SQLite 文件')
    const def: SourceDef = { id: slugify(name), name: name.trim() || basenameStem(path), type: 'sqlite', dbPath: path }
    onCreated(def)
    onClose()
  }

  const importCsv = async () => {
    setError(null)
    setInfo(null)
    if (!path) return setError('请先选择 CSV 文件')
    setBusy(true)
    try {
      const r: CsvImportResult = await window.electronAPI.importCsv({ path, table: table.trim() || undefined })
      const def: SourceDef = {
        id: slugify(name),
        name: name.trim() || r.table,
        type: 'sqlite',
        dbPath: r.dbPath,
      }
      onCreated(def)
      onClose()
    } catch (e) {
      setError(String(e))
    } finally {
      setBusy(false)
    }
  }

  const addServer = async () => {
    setError(null)
    setInfo(null)
    if (!url) return setError(`请输入 ${TYPE_LABEL[mode as SourceType]} 连接串`)
    const def: SourceDef = {
      id: slugify(name),
      name: name.trim() || `${TYPE_LABEL[mode as SourceType]} 数据源`,
      type: mode as SourceType,
      url,
    }
    onCreated(def)
    onClose()
  }

  const submit = () => {
    if (mode === 'sqlite') void addSqlite()
    else if (mode === 'csv') void importCsv()
    else void addServer()
  }

  return (
    <div className="modal-mask" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <h2>添加数据源</h2>
          <button className="modal-close" onClick={onClose}>
            ✕
          </button>
        </div>

        <div className="dialog-tabs" role="tablist">
          {TAB_ORDER.map((t) => (
            <button key={t} role="tab" aria-selected={mode === t} className={mode === t ? 'active' : ''} onClick={() => setMode(t)}>
              {t === 'csv' ? 'CSV 导入' : TYPE_LABEL[t as SourceType]}
            </button>
          ))}
        </div>

        <section className="modal-sec">
          <div className="field">
            <span className="field-label">名称</span>
            <input type="text" spellCheck={false} placeholder="如「销售明细」" value={name} onChange={(e) => setName(e.target.value)} />
          </div>

          {(mode === 'sqlite' || mode === 'csv') && (
            <div className="file-row">
              <button className="btn-ghost" onClick={mode === 'sqlite' ? pickSqlite : pickCsv}>
                {mode === 'csv' ? '选择 CSV 文件' : '选择 SQLite 文件'}
              </button>
              {path && <span className="file-path">{path}</span>}
            </div>
          )}
          {mode === 'csv' && (
            <div className="field">
              <span className="field-label">表名（可选）</span>
              <input type="text" spellCheck={false} placeholder="导入后使用的中文表名" value={table} onChange={(e) => setTable(e.target.value)} />
            </div>
          )}
          {(mode === 'postgres' || mode === 'mysql') && (
            <>
              <div className="field">
                <span className="field-label">连接串</span>
                <input
                  type="password"
                  spellCheck={false}
                  placeholder={TYPE_HINT[mode as SourceType]}
                  value={url}
                  onChange={(e) => setUrl(e.target.value)}
                />
              </div>
              <p className="sec-sub">连接串仅保存在本机设置文件，不会被写入代码或提交。</p>
            </>
          )}

          {mode === 'csv' && <p className="sec-sub">CSV 将自动导入为本地 SQLite 数据库（首行作为字段名，自动推断类型）。</p>}
        </section>

        <div className="modal-foot">
          {error && <span className="saved-err">{error}</span>}
          {info && <span className="saved-ok">{info}</span>}
          <button className="btn-ghost" onClick={onClose}>
            取消
          </button>
          <button className="btn-primary" onClick={submit} disabled={busy}>
            {busy ? '导入中…' : mode === 'csv' ? '导入' : '添加'}
          </button>
        </div>
      </div>
    </div>
  )
}