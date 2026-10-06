export type Route = 'text2sql' | 'agent'

// Questions carrying these words are open-ended analysis → keep the ReAct agent.
// Pure data-retrieval/aggregation questions go to the Text2SQL pipeline.
const ANALYSIS_WORDS = [
  '为什么',
  '为何',
  '原因',
  '建议',
  '怎么办',
  '如何',
  '怎么提升',
  '分析',
  '洞察',
  '策略',
  '优化',
  '提升',
  '预测',
  '解释',
  '评价',
  '影响',
  '利弊',
  '复盘',
]

export function route(question: string): Route {
  const q = String(question ?? '')
  return ANALYSIS_WORDS.some((w) => q.includes(w)) ? 'agent' : 'text2sql'
}