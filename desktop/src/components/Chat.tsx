import type { Thread } from '../types'
import FollowUpChips from './FollowUpChips'
import AssistantMsg from './AssistantMsg'

interface Props {
  thread: Thread
  onAsk: (q: string) => void
}

export default function Chat({ thread, onAsk }: Props) {
  if (thread.turns.length === 0) return null
  return (
    <>
      {thread.turns.map((t, i) => (
        <div key={i}>
          <div className="msg user">
            <div className="role">YOU</div>
            <div className="bubble">{t.user}</div>
          </div>
          {t.status && (
            <div className="status">
              <div className="spinner" />
              <span>{t.status}</span>
            </div>
          )}
          {t.error && <div className="error-msg">{t.error}</div>}
          {t.answer != null && (
            <>
              <AssistantMsg events={t.events} answer={t.answer} question={t.user} charts={t.charts} />
              {t.followUps.length > 0 && (
                <FollowUpChips
                  list={t.followUps}
                  onAsk={(q) => {
                    // fragment wrapper is not interactive; delegate to parent
                    onAsk(q)
                  }}
                />
              )}
            </>
          )}
        </div>
      ))}
    </>
  )
}