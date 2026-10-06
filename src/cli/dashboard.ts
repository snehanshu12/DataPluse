import fs from 'node:fs'
import path from 'node:path'
import { buildSource } from './sourceConn.js'
import { generateDashboardSpec } from '../bi/generate.js'
import { renderDashboard } from '../bi/render.js'

const args = process.argv.slice(2)
const jsonMode = args.includes('--json')
const request = args.filter((a) => a !== '--json').join(' ').trim()

if (!request) {
  console.error('Usage: npm run dashboard -- "dashboard description" [--json]')
  console.error('Example: npm run dashboard -- "monthly revenue trend, revenue share by category, top cities"')
  process.exit(1)
}

const { source, close, driver } = buildSource()
console.error(`[data] driver=${driver}`)
try {
  const spec = await generateDashboardSpec(source, request)
  if (jsonMode) {
    console.log(JSON.stringify(spec))
  } else {
    const html = renderDashboard(spec)
    const outputDir = path.resolve(process.cwd(), 'output')
    fs.mkdirSync(outputDir, { recursive: true })
    const htmlFile = path.join(outputDir, `dashboard-${Date.now()}.html`)
    fs.writeFileSync(htmlFile, html)
    console.log(`\nDashboard written to ${htmlFile}`)
    console.log(`Open it: open ${htmlFile}`)
  }
} catch (err) {
  // Failure must not leak a raw stack into the desktop's error bubble —
  // surface it as a clean, answerable message instead.
  const message = err instanceof Error ? err.message : String(err)
  if (jsonMode) {
    console.log(JSON.stringify({ title: '无法生成图表', summary: `图表生成失败：${message}`, charts: [], error: message }))
  } else {
    console.error(`dashboard 生成失败: ${message}`)
  }
} finally {
  await close()
}