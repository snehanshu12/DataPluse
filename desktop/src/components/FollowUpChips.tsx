export default function FollowUpChips({ list, onAsk }: { list: string[]; onAsk: (q: string) => void }) {
  if (!list.length) return null
  return (
    <div className="followups">
      <div className="followups-label">可以接着问：</div>
      <div className="chips">
        {list.map((f) => (
          <button key={f} onClick={() => onAsk(f)}>
            {f}
          </button>
        ))}
      </div>
    </div>
  )
}
