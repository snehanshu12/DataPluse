import type { SourceDef, SourceType } from './types'

/** Keywords that switch a question onto the dashboard (chart) pipeline. */
export const CHART_HINT_RE = /图表|柱状图|折线图|饼图|画个图|趋势图|分布图|占比/

/** Guarantee at least one chart suggestion — the LLM doesn't always add one,
 *  but the feature should never be invisible. */
export function ensureChartHint(list: string[], fallback: string): string[] {
  return list.some((q) => CHART_HINT_RE.test(q)) ? list : [...list, fallback]
}

export const TYPE_LABEL: Record<SourceType, string> = {
  sqlite: 'SQLite',
  postgres: 'PostgreSQL',
  mysql: 'MySQL',
}

export const TYPE_HINT: Record<SourceType, string> = {
  sqlite: '本地 SQLite 数据库文件',
  postgres: 'PostgreSQL 连接串，如 postgres://user:pass@host:5432/db',
  mysql: 'MySQL 连接串，如 mysql://user:pass@host:3306/db',
}

/** Generic, schema-agnostic starters — work against any imported/connected database. */
const GENERIC_STARTERS = [
  '介绍一下这个数据库里有哪些表，各自行数多少？',
  '每张表有哪些字段？请给出概览',
  '按最新数据统计总体情况，给出几个关键数字',
  '各主要维度的人数/数量排名如何？',
  '画个柱状图：各主要维度的数量对比',
  '最近一段时间的趋势怎么样？',
]

const ECOMMERCE_STARTERS = [
  '最近3个月哪个品类营收最高？',
  '画个折线图：最近6个月每月订单量趋势',
  '2026年最畅销的5个商品是哪些？',
  '各城市的平均客单价对比',
  '会员与非会员的人均消费差异',
  '最近一个月的日均订单量是多少？',
]

const CRM_STARTERS = [
  '各行业已成交商机金额排名',
  '画个饼图：本月新增商机的阶段分布',
  '成交商机数量最多的3个行业',
  '成交金额最高的5个客户公司',
  '各城市客户的成交率对比',
  '最近30天跟进活动的类型分布',
]

const MYSQL_STARTERS = [
  '借出最多的5本图书',
  '各分类图书的平均定价',
  '目前未归还的借阅记录有多少？',
  '画个柱状图：各出版社的图书数量排名',
  '各会员等级的平均借阅次数',
  '近一年每月借阅量趋势如何？',
]

/** Starter chips for a source: demo-specific when the id matches, generic otherwise. */
export function startersFor(source: SourceDef): string[] {
  if (source.id === 'ecommerce') return ECOMMERCE_STARTERS
  if (source.id === 'crm') return CRM_STARTERS
  if (source.id === 'mysql') return MYSQL_STARTERS
  return GENERIC_STARTERS
}

/** Strip credentials out of a connection URL for display: keep the scheme,
 *  host, port and db, replace `user:pass@` and even just `user@` with `***@` —
 *  a password must never be painted into the UI (screenshots, history text). */
export function redactConnectionUrl(raw: string): string {
  const s = String(raw ?? '')
  return s.replace(/^(postgres|mysql|https?):\/\/([^/@\s]+?)(?::[^/@\s]*)?@/, '$1://***@')
}

export function sourceHint(source: SourceDef): string {
  if (source.type === 'sqlite') return `SQLite · ${source.dbPath}`
  if (source.type === 'postgres') return `PostgreSQL · ${redactConnectionUrl(source.url ?? '')}`
  return `MySQL · ${redactConnectionUrl(source.url ?? '')}`
}

export function sourcePlaceholder(source: SourceDef): string {
  const demo =
    source.id === 'ecommerce'
      ? '如「最近三个月哪个品类营收最高」'
      : source.id === 'crm'
        ? '如「各行业成交金额排名」'
        : source.id === 'mysql'
          ? '如「借出最多的5本图书」'
          : '如「有哪些表，各自行数多少」'
  return `分析「${source.name}」，${demo}…`
}