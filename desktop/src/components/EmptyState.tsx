import type { SourceDef } from '../types'
import { startersFor, sourceHint, TYPE_LABEL } from '../starterQuestions'

interface Props {
  source: SourceDef | null
  starters: string[] | null
  loading: boolean
  onRefresh?: () => void
  onAsk: (q: string) => void
}

export default function EmptyState({ source, starters, loading, onRefresh, onAsk }: Props) {
  const noSource = !source
  const generating = !noSource && loading && !starters
  const list = starters ?? (noSource ? [] : startersFor(source))
  return (
    <div className="empty">
      <div className="empty-title">
        {noSource ? '先添加一个数据源' : `「${source.name}」数据 · 问点业务问题`}
      </div>
      <div className="empty-sub">
        {noSource
          ? '支持 SQLite 文件、CSV 导入、PostgreSQL 与 MySQL 连接。'
          : `${TYPE_LABEL[source.type]} · ${sourceHint(source)}。例如……`}
      </div>
      {generating ? (
        <div className="starters-loading">
          <span className="spinner" />
          正在实时解析数据库结构并生成推荐问题…
        </div>
      ) : (
        <div className="chips">
          {list.map((s) => (
            <button key={s} onClick={() => onAsk(s)}>
              {s}
            </button>
          ))}
        </div>
      )}
      {!noSource && !generating && (
        <div className="dynamic-note">
          <span>
            {loading
              ? '正在实时解析数据库结构并生成推荐问题…'
              : starters
                ? '问题基于当前库结构实时生成'
                : '通用问题（可点击上面提问）'}
          </span>
          {onRefresh && (
            <button className="regen-btn" onClick={onRefresh} disabled={loading}>
              ↻ 重新生成
            </button>
          )}
        </div>
      )}
    </div>
  )
}