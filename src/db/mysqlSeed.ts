import type { MySqlClient } from '../agent/text2sql/mysql.js'

/** Same deterministic PRNG as the e-commerce / CRM seeds. */
function mulberry32(seed: number) {
  return function () {
    let t = (seed += 0x6d2b79f5)
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const PUBLISHERS = ['人民邮电', '机械工业', '中信', '电子工业', '上海译文', '读客', '中华书局', '北京联合']
const CITIES = ['北京', '上海', '深圳', '杭州', '成都', '广州']
const AUTHORS = [
  ['刘', '慈欣'], ['余', '华'], ['金', '庸'], ['村上', '春树'], ['加西亚', '马尔克斯'],
  ['吴', '军'], ['阮', '一峰'], ['张', '小龙'], ['杰夫', '贝索斯'], ['埃里克', '莱斯'],
  ['冯', '诺依曼'], ['陈', '嘉映'], ['迟', '子建'], ['贾', '平凹'], ['许', '倬云'],
] as const
const CATEGORIES = ['小说', '科技', '历史', '少儿', '社科', '文学']
const TITLES = [
  '三体', '活着', '鹿鼎记', '挪威的森林', '百年孤独', '浪潮之巅', '深入浅出Node.js',
  '启示录', '精益创业', '重构', '计算机组成原理', '何为良好生活', '额尔古纳河右岸',
  '秦腔', '万古江河',
]
const LEVELS = ['basic', 'basic', 'plus', 'plus', 'pro']

export interface MysqlSeedOptions {
  publishers?: number
  authors?: number
  books?: number
  members?: number
  borrows?: number
  seed?: number
  from?: Date
  to?: Date
}

function randInt(rnd: () => number, min: number, max: number): number {
  return min + Math.floor(rnd() * (max - min + 1))
}

function randItem<T>(rnd: () => number, arr: readonly T[]): T {
  return arr[Math.floor(rnd() * arr.length)]!
}

function randDate(rnd: () => number, from: Date, to: Date): Date {
  return new Date(from.getTime() + rnd() * (to.getTime() - from.getTime()))
}

function fmt(d: Date, withTime = false): string {
  const s = d.toISOString()
  return withTime ? s.replace('T', ' ').slice(0, 19) : s.slice(0, 10)
}

/** Insert deterministic mock library data. Truncates then re-inserts. */
export async function seedMysql(client: MySqlClient, opts: MysqlSeedOptions = {}): Promise<Record<string, number>> {
  const nPublishers = opts.publishers ?? 8
  const nAuthors = opts.authors ?? 15
  const nBooks = opts.books ?? 180
  const nMembers = opts.members ?? 60
  const nBorrows = opts.borrows ?? 260
  const rnd = mulberry32(opts.seed ?? 7)
  const from = opts.from ?? new Date(Date.UTC(2023, 0, 1))
  const to = opts.to ?? new Date(Date.UTC(2026, 7, 1))

  await client.query('SET FOREIGN_KEY_CHECKS = 0')
  try {
    for (const t of ['borrows', 'books', 'members', 'authors', 'publishers']) {
      await client.query(`TRUNCATE TABLE ${t}`)
    }

    const publisherRows = PUBLISHERS.slice(0, nPublishers).map((name) => [
      name,
      randItem(rnd, CITIES),
      randInt(rnd, 1950, 2010),
    ])
    await client.query(
      'INSERT INTO publishers(name, city, founded_year) VALUES ?',
      [publisherRows],
    )

    const authorRows = AUTHORS.slice(0, Math.min(nAuthors, AUTHORS.length)).map(([a, b]) => [
      `${a}${b}`,
      randItem(rnd, ['中国', '美国', '日本', '哥伦比亚', '法国', '英国']),
    ])
    await client.query('INSERT INTO authors(name, country) VALUES ?', [authorRows])

    const bookRows: unknown[][] = []
    for (let i = 0; i < nBooks; i++) {
      const model = AUTHORS[Math.floor(rnd() * AUTHORS.length)]!
      bookRows.push([
        `978-${randInt(rnd, 1000, 9999)}-${randInt(rnd, 1000, 9999)}-${randInt(rnd, 100, 999)}-${randInt(rnd, 0, 9)}`,
        `${randItem(rnd, TITLES)} · ${Math.floor(rnd() * 100)}`,
        randItem(rnd, CATEGORIES),
        Number((randInt(rnd, 20, 180) * 10).toFixed(2)),
        randInt(rnd, 5, 120),
        randInt(rnd, 1, nAuthors),
        randInt(rnd, 1, nPublishers),
        fmt(randDate(rnd, new Date(Date.UTC(1990, 0, 1)), to)),
      ])
    }
    await client.query(
      'INSERT INTO books(isbn, title, category, price, stock, author_id, publisher_id, published_at) VALUES ?',
      [bookRows],
    )

    const memberRows: unknown[][] = []
    for (let i = 0; i < nMembers; i++) {
      memberRows.push([
        `会员${String(i + 1).padStart(3, '0')}`,
        `m${Math.floor(rnd() * 1e9)}@example.com`,
        randItem(rnd, CITIES),
        randItem(rnd, LEVELS),
        fmt(randDate(rnd, from, to)),
      ])
    }
    await client.query(
      'INSERT INTO members(name, email, city, level, joined_at) VALUES ?',
      [memberRows],
    )

    const borrowRows: unknown[][] = []
    for (let i = 0; i < nBorrows; i++) {
      const borrowed = randDate(rnd, from, to)
      const due = new Date(borrowed.getTime() + randInt(rnd, 14, 30) * 86400000)
      const returned = rnd() < 0.75 ? new Date(due.getTime() - randInt(rnd, 0, 6) * 86400000) : null
      borrowRows.push([
        randInt(rnd, 1, nBooks),
        randInt(rnd, 1, nMembers),
        fmt(borrowed, true),
        fmt(due),
        returned ? fmt(returned, true) : null,
      ])
    }
    await client.query(
      'INSERT INTO borrows(book_id, member_id, borrowed_at, due_date, returned_at) VALUES ?',
      [borrowRows],
    )
  } finally {
    await client.query('SET FOREIGN_KEY_CHECKS = 1')
  }

  const counts: Record<string, number> = {}
  for (const t of ['publishers', 'authors', 'books', 'members', 'borrows']) {
    const { rows } = await client.query(`SELECT COUNT(*) AS c FROM ${t}`)
    counts[t] = Number(rows[0]!.c)
  }
  return counts
}