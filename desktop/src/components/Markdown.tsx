import type { ReactNode } from 'react'

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

function renderInline(s: string): ReactNode {
  const nodes: ReactNode[] = []
  const re = /(`([^`]+)`|\*\*([^*]+)\*\*)/g
  let last = 0
  let key = 0
  let m: RegExpExecArray | null
  while ((m = re.exec(s))) {
    if (m.index > last) nodes.push(s.slice(last, m.index))
    if (m[2] !== undefined) {
      nodes.push(
        <code key={key++}>{m[2]}</code>,
      )
    } else if (m[3] !== undefined) {
      nodes.push(
        <strong key={key++}>{m[3]}</strong>,
      )
    }
    last = m.index + m[0].length
  }
  if (last < s.length) nodes.push(s.slice(last))
  return nodes
}

type Block =
  | { type: 'p'; text: string }
  | { type: 'h'; level: number; text: string }
  | { type: 'ul'; items: string[] }
  | { type: 'table'; rows: string[][] }

function tokenize(md: string): Block[] {
  const blocks: Block[] = []
  let pendingList: string[] | null = null
  let pendingTable: string[][] | null = null
  const flushList = () => {
    if (pendingList) {
      blocks.push({ type: 'ul', items: pendingList })
      pendingList = null
    }
  }
  const flushTable = () => {
    if (pendingTable) {
      blocks.push({ type: 'table', rows: pendingTable })
      pendingTable = null
    }
  }

  for (const raw of md.split('\n')) {
    const line = raw.trim()
    if (!line) {
      flushList()
      flushTable()
      continue
    }
    // fence delimiters (``` or ```lang) carry no content — drop them so raw
    // triple-backticks never show. Inner text still renders as normal blocks.
    if (/^```/.test(line)) {
      flushList()
      flushTable()
      continue
    }
    if (line.startsWith('|')) {
      flushList()
      const cells = line
        .split('|')
        .slice(1, -1)
        .map((c) => c.trim())
      if (cells.every((c) => /^:?-+:?$/.test(c) || /^-+$/.test(c))) continue
      if (!pendingTable) pendingTable = []
      pendingTable.push(cells)
      continue
    }
    flushTable()
    const head = line.match(/^(#{1,3})\s+(.*)/)
    if (head) {
      flushList()
      blocks.push({ type: 'h', level: head[1].length, text: head[2] })
    } else if (line.startsWith('- ') || line.startsWith('* ')) {
      if (!pendingList) pendingList = []
      pendingList.push(line.slice(2))
    } else {
      flushList()
      blocks.push({ type: 'p', text: line })
    }
  }
  flushList()
  flushTable()
  return blocks
}

export default function Markdown({ md }: { md: string }) {
  const blocks = tokenize(md)
  return (
    <>
      {blocks.map((b, i) => {
        switch (b.type) {
          case 'h': {
            const Tag = `h${b.level}` as 'h1' | 'h2' | 'h3'
            return <Tag key={i}>{renderInline(b.text)}</Tag>
          }
          case 'ul':
            return (
              <ul key={i}>
                {b.items.map((it, j) => (
                  <li key={j}>{renderInline(it)}</li>
                ))}
              </ul>
            )
          case 'table':
            return (
              <table key={i}>
                <tbody>
                  {b.rows.map((row, j) => (
                    <tr key={j}>
                      {row.map((c, k) => (
                        <td key={k}>{renderInline(escapeHtml(c))}</td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            )
          default:
            return <p key={i}>{renderInline(escapeHtml(b.text))}</p>
        }
      })}
    </>
  )
}
