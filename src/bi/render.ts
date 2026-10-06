import type { ChartSpec, DashboardSpec } from './types.js'

/** Convert one chart spec into an ECharts option object. */
function chartOption(c: ChartSpec): unknown {
  const labels = c.labels ?? c.series[0]?.values.map((_, i) => String(i + 1)) ?? []

  if (c.type === 'pie') {
    const data = labels.map((label, i) => ({
      name: label,
      value: c.series[0]?.values[i] ?? 0,
    }))
    return {
      tooltip: { trigger: 'item' },
      legend: { type: 'scroll', bottom: 0 },
      series: [
        {
          name: c.title,
          type: 'pie',
          radius: ['35%', '70%'],
          data,
        },
      ],
    }
  }

  const common = {
    tooltip: { trigger: 'axis' },
    legend: { bottom: 0 },
    grid: { left: 48, right: 24, top: 36, bottom: 48 },
    xAxis: { type: 'category', data: labels, axisLabel: { rotate: labels.length > 8 ? 30 : 0 } },
    yAxis: { type: 'value' },
    series: c.series.map((s) => ({
      name: s.name,
      type: c.type,
      data: s.values,
      smooth: c.type === 'line',
      areaStyle: c.type === 'line' ? { opacity: 0.15 } : undefined,
    })),
  }
  return common
}

export function renderDashboard(spec: DashboardSpec): string {
  const chartRenderings = spec.charts.map((c) => {
    const option = JSON.stringify(chartOption(c), null, 2)
    const safeId = c.id.replace(/[^a-zA-Z0-9_-]/g, '')
    return {
      id: safeId,
      html: `<div id="${safeId}" class="chart"></div>`,
      js: `
        const el${safeId} = document.getElementById('${safeId}');
        const chart${safeId} = echarts.init(el${safeId});
        chart${safeId}.setOption(${option});`,
    }
  })

  const chartsHtml = chartRenderings.map((r) => r.html).join('\n        ')
  const chartsJs = chartRenderings.map((r) => r.js).join('\n        ')

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${escapeHtml(spec.title)}</title>
  <script src="https://cdn.jsdelivr.net/npm/echarts@5.5.0/dist/echarts.min.js"></script>
  <style>
    :root { color-scheme: light dark; }
    body { margin: 0; font-family: -apple-system, "Segoe UI", Roboto, sans-serif; background: #f5f6f8; color: #1a1a1a; }
    .wrap { max-width: 1200px; margin: 0 auto; padding: 24px 20px 48px; }
    header { margin-bottom: 20px; }
    h1 { margin: 0 0 6px; font-size: 26px; }
    .summary { color: #555; font-size: 14px; line-height: 1.6; max-width: 900px; }
    .meta { margin-top: 8px; font-size: 12px; color: #999; }
    .grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(480px, 1fr)); gap: 16px; }
    .card { background: #fff; border: 1px solid #e4e6eb; border-radius: 10px; padding: 14px; box-shadow: 0 1px 2px rgba(0,0,0,.04); }
    .card h2 { margin: 0 0 10px; font-size: 15px; font-weight: 600; }
    .chart { width: 100%; height: 320px; }
    footer { margin-top: 24px; font-size: 12px; color: #aaa; }
    @media (prefers-color-scheme: dark) {
      body { background: #15171a; color: #eaeaec; }
      .card { background: #1d2024; border-color: #2a2e34; }
      .summary { color: #aaa; }
    }
  </style>
</head>
<body>
  <div class="wrap">
    <header>
      <h1>${escapeHtml(spec.title)}</h1>
      ${spec.summary ? `<p class="summary">${escapeHtml(spec.summary)}</p>` : ''}
      <div class="meta">Generated ${escapeHtml(spec.createdAt)} by DataPulse &middot; ${spec.charts.length} charts</div>
    </header>
    <div class="grid">
        ${chartsHtml}
    </div>
    <footer>DataPulse &mdash; mock e-commerce data</footer>
  </div>
  <script>
    ${chartsJs}
  </script>
</body>
</html>`
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}