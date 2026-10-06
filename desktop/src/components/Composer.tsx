import { useEffect, useRef, useState } from 'react'
import type { SourceDef } from '../types'
import { sourcePlaceholder } from '../starterQuestions'

interface Props {
  source: SourceDef | null
  disabled: boolean
  focusNonce: number
  onSubmit: (q: string) => void
}

export default function Composer({ source, disabled, focusNonce, onSubmit }: Props) {
  const [value, setValue] = useState('')
  const ref = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    ref.current?.focus()
  }, [focusNonce])

  useEffect(() => {
    if (!disabled) ref.current?.focus()
  }, [disabled])

  const send = () => {
    if (!value.trim() || disabled) return
    onSubmit(value)
    setValue('')
  }

  return (
    <footer className="composer">
      <textarea
        ref={ref}
        rows={2}
        value={value}
        disabled={disabled}
        placeholder={source ? sourcePlaceholder(source) : '请先在左侧添加数据源'}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
            e.preventDefault()
            send()
          }
        }}
      />
      <button className="send-btn" disabled={disabled || !source} onClick={send}>
        查询
      </button>
    </footer>
  )
}