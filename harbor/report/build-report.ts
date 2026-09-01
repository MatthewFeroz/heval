/**
 * Harbor job -> normalized rows + self-contained HTML eval report.
 *
 *   bun harbor/report/build-report.ts jobs/terminal-bench-glm53-2x2
 *   bun run report jobs/terminal-bench-glm53-2x2
 *
 * Writes, under results/harbor/ (override with --out <dir>):
 *
 *   <job>.json   normalized TrialRow[] - what the graph editor loads
 *   <job>.html   static report: four recipe charts rendered to SVG in both
 *                themes, stat tiles, warnings, table view, provenance
 *   index.json   catalog of exported jobs the studio's job picker reads
 *
 * The charts are the same recipes the studio renders (src/charts/recipes.ts),
 * compiled headlessly, so an adjustment made in the editor and copied into a
 * recipe shows up here unchanged. Open any chart in the studio from the report
 * via its "Open in studio" link, which carries the recipe state in the URL.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { THEMES, type ThemeMode } from '../../src/charts/palette'
import { buildChart, formatValue, type ChartState } from '../../src/charts/recipes'
import { paramsFromState } from '../../src/charts/url'
import { DIMENSION_LABEL, MEASURE_LABEL, type JobExport, type JobIndex, type Measure, type TrialRow } from '../../src/charts/trial'
import { renderSvg } from './render-svg'
import { exportJob } from './trials'

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
const pct = (n: number) => `${Math.round(n * 100)}%`
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`

type Section = { id: string; heading: string; lede: string; state: Partial<ChartState> }

const SECTIONS: Section[] = [
  {
    id: 'pass-rate',
    heading: 'Pass rate by harness and model',
    lede: 'Color encodes the model and position the harness. Bars carry Wilson 95% intervals; with three trials per cell those are wide by design.',
    state: { recipe: 'bar', x: 'agent', color: 'modelShort', measure: 'passed', intervals: true, labels: true },
  },
  {
    id: 'quality-cost',
    heading: 'Quality versus cost',
    lede: 'Mean provider-reported cost per trial against pass rate, one point per stack. The muted line is the Pareto frontier: nothing above-left of it exists in this job.',
    state: { recipe: 'scatter', x: 'agent', color: 'modelShort', measure: 'passed', xMeasure: 'costUsd', labels: true },
  },
  {
    id: 'agent-time',
    heading: 'Agent time per trial',
    lede: 'Wall-clock of the agent step alone - environment build, harness install and verification are excluded. The tick is the group mean.',
    state: { recipe: 'strip', x: 'agent', color: 'modelShort', measure: 'agentSeconds', aggregate: 'mean', labels: false },
  },
  {
    id: 'per-task',
    heading: 'Per-task breakdown',
    lede: 'Single-hue ramp keyed to pass rate; the job here is magnitude, so one hue light-to-dark is correct. Tasks are the columns because a job has many of them and few stacks.',
    state: { recipe: 'matrix', x: 'task', row: 'stack', measure: 'passed', labels: true },
  },
]

function studioUrl(job: string, state: Partial<ChartState>): string {
  return `/studio?${paramsFromState(state, { job }).toString()}`
}

async function chartBlock(job: string, rows: TrialRow[], section: Section): Promise<{ html: string; warnings: string[] }> {
  const warnings = new Set<string>()
  const svgs: Record<ThemeMode, string> = { light: '', dark: '' }
  for (const theme of ['light', 'dark'] as ThemeMode[]) {
    const out = buildChart(rows, { ...section.state, theme })
    out.warnings.forEach((w) => warnings.add(w))
    svgs[theme] = await renderSvg(out.spec)
  }
  const notes = [...warnings].map((w) => `<div class="note">${esc(w)}</div>`).join('')
  const html = `
  <section id="${section.id}">
    <h2>${esc(section.heading)} <a class="studio" href="${studioUrl(job, section.state)}">Open in studio &rarr;</a></h2>
    <p class="lede">${esc(section.lede)}</p>
    <div class="card chart">
      <div class="only-light">${svgs.light}</div>
      <div class="only-dark">${svgs.dark}</div>
    </div>
    ${notes}
  </section>`
  return { html, warnings: [...warnings] }
}

function statTiles(rows: TrialRow[]): string {
  const models = [...new Set(rows.map((r) => r.modelShort))].sort()
  const light = THEMES.light, dark = THEMES.dark
  return models
    .map((m, i) => {
      const ts = rows.filter((r) => r.modelShort === m)
      const rate = ts.filter((r) => r.passed).length / ts.length
      const costs = ts.map((r) => r.costUsd).filter((c): c is number => c !== null)
      const cost = costs.length ? costs.reduce((a, b) => a + b, 0) / costs.length : null
      return `<div class="stat">
        <div class="stat-k"><span class="swatch" style="--sw-light:${light.series[i % 4]};--sw-dark:${dark.series[i % 4]}"></span>${esc(m)}</div>
        <div class="stat-v">${pct(rate)}</div>
        <div class="stat-n">${plural(ts.length, 'trial')}${cost !== null ? ` &middot; ${formatValue(cost, 'costUsd')} mean cost${costs.length < ts.length ? ` (${ts.length - costs.length} unpriced)` : ''}` : ' &middot; cost not exposed'}</div>
      </div>`
    })
    .join('')
}

function tableView(rows: TrialRow[]): string {
  // The harness version is provenance and already stated in the footer. It earns
  // a column only when a job actually mixed versions, which would otherwise be
  // invisible - and dropping it lets Cost fit without a horizontal scroll.
  const versionsPerAgent = new Map<string, Set<string>>()
  for (const r of rows) versionsPerAgent.set(r.agent, new Set([...(versionsPerAgent.get(r.agent) ?? []), r.agentVersion ?? '?']))
  const mixedVersions = [...versionsPerAgent.values()].some((v) => v.size > 1)

  const cols: { key: keyof TrialRow; label: string; measure?: Measure; num?: boolean }[] = [
    { key: 'agent', label: DIMENSION_LABEL.agent },
    ...(mixedVersions ? [{ key: 'agentVersion' as keyof TrialRow, label: 'Version' }] : []),
    { key: 'modelShort', label: DIMENSION_LABEL.modelShort },
    { key: 'task', label: DIMENSION_LABEL.task },
    { key: 'reward', label: MEASURE_LABEL.reward, measure: 'reward', num: true },
    { key: 'agentSeconds', label: MEASURE_LABEL.agentSeconds, measure: 'agentSeconds', num: true },
    { key: 'inputTokens', label: 'Input tok', measure: 'inputTokens', num: true },
    { key: 'cacheTokens', label: 'Cache tok', measure: 'cacheTokens', num: true },
    { key: 'outputTokens', label: 'Output tok', measure: 'outputTokens', num: true },
    { key: 'costUsd', label: MEASURE_LABEL.costUsd, measure: 'costUsd', num: true },
  ]
  const head = cols.map((c) => `<th${c.num ? ' class="num"' : ''}>${esc(c.label)}</th>`).join('')
  const body = rows
    .map((r) => `<tr>${cols.map((c) => {
      const v = r[c.key]
      const text = c.measure ? formatValue(typeof v === 'number' ? v : null, c.measure) : esc(v === null || v === undefined ? '-' : String(v))
      return `<td${c.num ? ' class="num"' : ''}>${text}</td>`
    }).join('')}</tr>`)
    .join('')
  return `<table><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table>`
}

function limitations(exp: JobExport): string[] {
  const rows = exp.rows
  const out: string[] = []
  const unpriced = rows.filter((r) => r.costUsd === null)
  if (unpriced.length) out.push(`${plural(unpriced.length, 'trial')} report no cost (${[...new Set(unpriced.map((r) => r.stack))].join(', ')}); the gateway exposes no pricing for that route. Cost comparisons exclude them.`)
  const noCache = rows.filter((r) => (r.cacheTokens ?? 0) < 1000 && (r.inputTokens ?? 0) > 20000)
  if (noCache.length) out.push(`${plural(noCache.length, 'trial')} ran with effectively no prompt caching (${[...new Set(noCache.map((r) => r.stack))].join(', ')}). Their cost is not comparable to cached stacks on a per-token basis.`)
  for (const [agent, versions] of Object.entries(exp.agentVersions)) if (versions.length > 1) out.push(`${agent} ran at ${versions.length} different versions (${versions.join(', ')}) within this job.`)
  const perCell = new Map<string, number>()
  for (const r of rows) perCell.set(`${r.stack}|${r.task}`, (perCell.get(`${r.stack}|${r.task}`) ?? 0) + 1)
  const minN = Math.min(...perCell.values())
  if (minN < 3) out.push(`Smallest cell has ${plural(minN, 'trial')}; docs/first-eval.md requires three attempts per stack before a result is reported.`)
  const tasks = new Set(rows.map((r) => r.task))
  if (tasks.size < 3) out.push(`Only ${plural(tasks.size, 'task')}; a single task cannot separate model from task effects.`)
  return out
}

async function render(exp: JobExport): Promise<string> {
  const rows = exp.rows
  const agents = [...new Set(rows.map((r) => r.agent))].sort()
  const models = [...new Set(rows.map((r) => r.modelShort))].sort()
  const tasks = [...new Set(rows.map((r) => r.task))].sort()
  const light = THEMES.light, dark = THEMES.dark

  const sections: string[] = []
  for (const s of SECTIONS) sections.push((await chartBlock(exp.job, rows, s)).html)
  const limits = limitations(exp)

  return `<!doctype html>
<html lang="en" data-theme="light">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(exp.job)} - heval</title>
<style>
  :root{--bg:${light.bg};--surface:${light.surface};--ink:${light.ink};--muted:${light.inkMuted};--grid:${light.grid}}
  [data-theme="dark"]{--bg:${dark.bg};--surface:${dark.surface};--ink:${dark.ink};--muted:${dark.inkMuted};--grid:${dark.grid}}
  .only-dark{display:none}[data-theme="dark"] .only-dark{display:block}[data-theme="dark"] .only-light{display:none}
  .swatch{background:var(--sw-light)}[data-theme="dark"] .swatch{background:var(--sw-dark)}
  *{box-sizing:border-box}
  body{margin:0;padding:48px 32px;background:var(--bg);color:var(--ink);font-family:system-ui,sans-serif;font-size:14px;line-height:1.5;letter-spacing:0.01em}
  .wrap{max-width:900px;margin:0 auto}
  h1{font-size:30px;font-weight:600;letter-spacing:-0.02em;line-height:1.1;margin:0 0 6px}
  h2{font-size:17px;font-weight:600;letter-spacing:-0.01em;margin:40px 0 4px;display:flex;justify-content:space-between;align-items:baseline;gap:12px}
  .studio{font-size:12px;font-weight:500;color:var(--muted);text-decoration:none}.studio:hover{color:var(--ink)}
  .lede{color:var(--muted);margin:0 0 4px}
  .card{background:var(--surface);border:1px solid var(--grid);border-radius:12px;padding:22px;margin-top:14px;overflow-x:auto}
  .chart svg{display:block}
  .stats{display:flex;gap:12px;margin-top:20px;flex-wrap:wrap}
  .stat{flex:1;min-width:190px;background:var(--surface);border:1px solid var(--grid);border-radius:12px;padding:16px 18px}
  .stat-k{display:flex;align-items:center;gap:8px;color:var(--muted);font-size:13px}
  .stat-v{font-size:38px;font-weight:600;letter-spacing:-0.02em;line-height:1.1;margin-top:6px}
  .stat-n{color:var(--muted);font-size:12px}
  .swatch{width:10px;height:10px;border-radius:3px;display:inline-block;flex:none}
  table{border-collapse:collapse;width:100%;font-size:13px}
  th,td{text-align:left;padding:8px 10px;border-bottom:1px solid var(--grid);white-space:nowrap}
  th{font-weight:500;color:var(--muted)}
  .num{text-align:right;font-variant-numeric:tabular-nums}
  .note{border-left:2px solid var(--muted);padding:10px 14px;margin-top:14px;color:var(--muted);font-size:13px;background:var(--surface);border-radius:0 8px 8px 0}
  ul.limits{margin:8px 0 0;padding-left:20px;color:var(--muted)}
  .toggle{position:fixed;top:18px;right:18px;background:var(--surface);color:var(--ink);border:1px solid var(--grid);border-radius:999px;padding:7px 15px;font:inherit;font-size:12px;cursor:pointer}
  footer{color:var(--muted);font-size:12px;margin-top:36px;border-top:1px solid var(--grid);padding-top:14px}
  code{font-size:12px}
</style>
</head>
<body>
<button class="toggle" id="t">Dark</button>
<div class="wrap">
  <h1>${esc(exp.job)}</h1>
  <p class="lede">${plural(rows.length, 'trial')} &middot; ${plural(agents.length, 'harness', 'harnesses')} &middot; ${plural(models.length, 'model')} &middot; ${plural(tasks.length, 'task')} &middot; generated ${esc(exp.generatedAt.slice(0, 10))}</p>

  <div class="stats">${statTiles(rows)}</div>

  ${sections.join('\n')}

  <h2>Limitations</h2>
  <div class="card">${limits.length ? `<ul class="limits">${limits.map((l) => `<li>${esc(l)}</li>`).join('')}</ul>` : '<p class="lede">None detected automatically. Record vendor routing and any manual interventions by hand.</p>'}</div>

  <h2>Table view</h2>
  <div class="card">${tableView(rows)}</div>

  <footer>
    Generated by <code>harbor/report/build-report.ts</code> from Harbor per-trial output${exp.jobId ? ` (job <code>${esc(exp.jobId)}</code>)` : ''}.
    Harness versions observed in-sandbox: ${Object.entries(exp.agentVersions).map(([a, v]) => `${esc(a)} ${esc(v.join('/'))}`).join(', ') || 'not recorded'}.
    Task digests: ${[...new Set(rows.map((r) => `${r.task} ${r.taskChecksum?.slice(0, 12) ?? '?'}`))].map(esc).join(', ')}.
    Charts are Vega-Lite recipes from <code>src/charts/recipes.ts</code>; series colors are Merge brand hues snapped to validated steps, both modes pass all six accessibility checks.
  </footer>
</div>
<script>
  const b=document.documentElement,t=document.getElementById('t');
  t.onclick=()=>{const d=b.dataset.theme==='dark';b.dataset.theme=d?'light':'dark';t.textContent=d?'Dark':'Light';};
</script>
</body>
</html>`
}

// -- cli ------------------------------------------------------------------------------

const args = process.argv.slice(2)
const jobDir = args.find((a) => !a.startsWith('--'))
const outDir = args.includes('--out') ? args[args.indexOf('--out') + 1] : 'results/harbor'
if (!jobDir) {
  console.error('usage: bun harbor/report/build-report.ts <job-dir> [--out results/harbor]')
  process.exit(2)
}
if (!existsSync(jobDir)) {
  console.error(`no such job directory: ${jobDir}`)
  process.exit(2)
}

const exp = exportJob(jobDir)
if (!exp.rows.length) {
  console.error(`no readable trials in ${jobDir} - is this a finished Harbor job directory?`)
  process.exit(1)
}

mkdirSync(outDir, { recursive: true })
const jsonPath = join(outDir, `${exp.job}.json`)
const htmlPath = join(outDir, `${exp.job}.html`)
writeFileSync(jsonPath, JSON.stringify(exp, null, 2))
writeFileSync(htmlPath, await render(exp))

const indexPath = join(outDir, 'index.json')
const index: JobIndex = existsSync(indexPath) ? JSON.parse(readFileSync(indexPath, 'utf8')) : { schemaVersion: 1, jobs: [] }
index.jobs = [
  ...index.jobs.filter((j) => j.job !== exp.job),
  {
    job: exp.job,
    file: `${exp.job}.json`,
    generatedAt: exp.generatedAt,
    trials: exp.rows.length,
    agents: [...new Set(exp.rows.map((r) => r.agent))].sort(),
    models: [...new Set(exp.rows.map((r) => r.model))].sort(),
    tasks: [...new Set(exp.rows.map((r) => r.task))].sort(),
  },
].sort((a, b) => b.generatedAt.localeCompare(a.generatedAt))
writeFileSync(indexPath, JSON.stringify(index, null, 2))

console.log(`${exp.rows.length} trials -> ${jsonPath}, ${htmlPath}, ${indexPath}`)
