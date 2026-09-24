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
import { collapseTo, costPerSuccess, mean, median, medianTimePassed, nums, quantile } from '../../src/charts/metrics'
import { THEMES, type ThemeMode } from '../../src/charts/palette'
import { buildChart, formatValue, RECIPE_LABEL, type ChartState } from '../../src/charts/recipes'
import { paramsFromState } from '../../src/charts/url'
import { DIMENSION_LABEL, MEASURE_LABEL, SLOW_TRIAL_SECONDS, type JobExport, type JobIndex, type Measure, type TrialRow } from '../../src/charts/trial'
import { renderSvg } from './render-svg'
import { exportJob } from './trials'

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
const pct = (n: number) => `${Math.round(n * 100)}%`
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`

type Section = {
  id: string
  heading: string
  lede: string
  state: Partial<ChartState>
  /**
   * Rows to chart, when the section's measure is not a plain per-trial field.
   * Two cases need it, both of them measures Composio published: a median taken
   * over passed trials only, and a ratio of two aggregates (spend / passes)
   * that no single-measure aggregation can express.
   */
  derive?: (rows: TrialRow[]) => TrialRow[]
}

/**
 * The charted sections, resolved against the data.
 *
 * The x dimension is not fixed. A 2x2 grid wants the harness on x with the
 * model in color; a model sweep holds the harness constant, where `x: 'agent'`
 * collapses to one column and six models exceed the palette's four validated
 * series, so color is dropped and the chart says nothing. Picking x by
 * cardinality keeps both shapes correct from the same report builder.
 */
function sectionsFor(rows: TrialRow[]): Section[] {
  const manyAgents = new Set(rows.map((r) => r.agent)).size > 1
  // When the harness varies it is the comparison and the model is the series.
  // When it does not, the model is the comparison and there is no series -
  // `color === x` is dropped by buildChart, so this needs no special case.
  const x = manyAgents ? 'agent' : 'modelShort'
  const color = manyAgents ? 'modelShort' : 'none'

  return [
    {
      id: 'pass-rate',
      heading: manyAgents ? 'Pass rate by harness and model' : 'Tasks completed per model',
      lede: manyAgents
        ? 'Color encodes the model and position the harness. Bars carry Wilson 95% intervals; with three trials per cell those are wide by design.'
        : 'The headline number, and the one to read most carefully: bars carry Wilson 95% intervals, and at one attempt per task those intervals are wide enough to overlap across most of the field. Ranking is fair game; declaring an adjacent pair different is not.',
      state: { recipe: 'bar', x, color, measure: 'passed', intervals: true, labels: true },
    },
    {
      id: 'quality-cost',
      heading: 'Quality versus cost',
      lede: 'Mean cost per trial against pass rate, one point per stack. The muted line is the Pareto frontier: nothing above-left of it exists in this job. Cost per *completed* task is the fairer figure and is charted below - mean per-trial cost rewards a stack for failing cheaply.',
      state: { recipe: 'scatter', x, color, measure: 'passed', xMeasure: 'costUsd', labels: true },
    },
    {
      id: 'cost-per-success',
      heading: 'Cost per completed task',
      lede: 'Total spend divided by passes, which is what a reader actually buys. A stack that fails fast and cheaply looks good on mean per-trial cost and bad here. Stacks that never passed cannot be priced and are absent.',
      // Four decimals, not the shared two: across a model sweep this spans three
      // orders of magnitude, and `$.2f` prints every sub-cent model as `$0.00`.
      state: { recipe: 'bar', x, color: 'none', measure: 'costUsd', aggregate: 'mean', sort: 'asc', intervals: false, labels: true, title: 'Cost per completed task', format: '$.4f' },
      derive: (rs) => collapseTo(rs, 'costUsd', costPerSuccess),
    },
    {
      id: 'median-time-passed',
      heading: 'Median time per completed task',
      lede: 'Median agent-step wall clock over passed trials only. Failures are excluded on purpose: a timed-out run contributes the cap rather than a duration, which would rank a stack faster for giving up sooner.',
      state: { recipe: 'bar', x, color: 'none', measure: 'agentSeconds', aggregate: 'mean', sort: 'asc', intervals: false, labels: true, title: 'Median time per completed task' },
      derive: (rs) => collapseTo(rs, 'agentSeconds', medianTimePassed),
    },
    {
      id: 'agent-time',
      heading: 'Agent time per trial',
      lede: 'Every trial, passed or not - the spread the two medians above are drawn from. Wall-clock of the agent step alone; environment build, harness install and verification are excluded. The tick is the group mean.',
      state: { recipe: 'strip', x, color, measure: 'agentSeconds', aggregate: 'mean', labels: false },
    },
    {
      id: 'tail-latency',
      heading: `Share of trials over ${SLOW_TRIAL_SECONDS / 60} minutes`,
      lede: 'Tail risk, not central tendency. A stack can hold a respectable median and still be unusable if it blows the budget on a third of tasks; timeouts are counted here as well as separately below.',
      state: { recipe: 'bar', x, color, measure: 'overSlow', labels: true },
    },
    {
      id: 'per-task',
      heading: 'Per-task breakdown',
      lede: 'Single-hue ramp keyed to pass rate; the job here is magnitude, so one hue light-to-dark is correct. Tasks are the columns because a job has many of them and few stacks.',
      // No color dimension: the matrix encodes the measure as a single-hue ramp,
      // so leaving `modelShort` on color only earns a "too many series" warning
      // for a channel this recipe never draws.
      state: { recipe: 'matrix', x: 'task', row: 'stack', color: 'none', measure: 'passed', labels: true },
    },
  ]
}

function studioUrl(job: string, state: Partial<ChartState>): string {
  return `/studio?${paramsFromState(state, { job }).toString()}`
}

const usd = (n: number) => (n === 0 ? '$0' : n < 0.01 ? `$${n.toFixed(4)}` : n < 1 ? `$${n.toFixed(3)}` : `$${n.toFixed(2)}`)
const fmtTokens = (n: number | null) => (n === null ? '-' : n >= 1e6 ? `${(n / 1e6).toFixed(2)}M` : n >= 1e3 ? `${(n / 1e3).toFixed(1)}k` : String(n))

/** The same five tiles the studio shows above its chart, computed the same way. */
function summaryTiles(rows: TrialRow[]): string {
  const passed = rows.filter((r) => r.passed).length
  const rate = rows.length ? passed / rows.length : 0
  const stacks = new Set(rows.map((r) => r.stack)).size
  const tasks = new Set(rows.map((r) => r.task)).size
  const secs = nums(rows, 'agentSeconds')
  const costs = nums(rows, 'costUsd')
  const totalCost = costs.length ? costs.reduce((a, b) => a + b, 0) : null
  const inTok = nums(rows, 'inputTokens').reduce((a, b) => a + b, 0)
  const cacheTok = nums(rows, 'cacheTokens').reduce((a, b) => a + b, 0)
  const outTok = nums(rows, 'outputTokens').reduce((a, b) => a + b, 0)
  const total = inTok + outTok
  const fresh = Math.max(0, inTok - cacheTok)
  const share = (n: number) => (total ? `${(n / total) * 100}%` : '0%')
  const meanCost = mean(costs), meanSecs = mean(secs), medSecs = median(secs)

  return `
    <div class="stat">
      <div class="stat-head"><span class="eyebrow">Pass rate</span></div>
      <strong>${pct(rate)}</strong>
      <small>${passed} of ${plural(rows.length, 'trial')} passed</small>
      <div class="bar"><i style="width:${rate * 100}%"></i></div>
    </div>
    <div class="stat">
      <div class="stat-head"><span class="eyebrow">Trials</span></div>
      <strong>${rows.length}</strong>
      <small>${plural(stacks, 'stack')} &middot; ${plural(tasks, 'task')}</small>
      <div class="split"><i style="width:${rows.length ? (passed / rows.length) * 100 : 0}%;background:var(--pass)"></i><i style="width:${rows.length ? ((rows.length - passed) / rows.length) * 100 : 0}%;background:var(--fail)"></i></div>
    </div>
    <div class="stat">
      <div class="stat-head"><span class="eyebrow">Agent time</span></div>
      <strong>${meanSecs === null ? '-' : formatValue(meanSecs, 'agentSeconds')}<small>mean</small></strong>
      <small>median ${medSecs === null ? '-' : formatValue(medSecs, 'agentSeconds')} &middot; agent step only</small>
    </div>
    <div class="stat">
      <div class="stat-head"><span class="eyebrow">Cost</span></div>
      <strong>${meanCost === null ? '-' : formatValue(meanCost, 'costUsd')}<small>per trial</small></strong>
      <small>${totalCost === null ? 'gateway exposes no pricing' : `${formatValue(totalCost, 'costUsd')} total${costs.length < rows.length ? ` &middot; ${rows.length - costs.length} unpriced` : ''}`}</small>
    </div>
    <div class="stat">
      <div class="stat-head"><span class="eyebrow">Tokens</span></div>
      <strong>${fmtTokens(total)}</strong>
      <small>${fmtTokens(rows.length ? Math.round(total / rows.length) : 0)} per trial &middot; ${inTok ? Math.round((cacheTok / inTok) * 100) : 0}% cache hit</small>
      <div class="split"><i style="width:${share(fresh)};background:#4aa5c8"></i><i style="width:${share(Math.min(cacheTok, inTok))};background:#27546a"></i><i style="width:${share(outTok)};background:var(--accent)"></i></div>
    </div>`
}

/** One row per model, keyed to the same categorical slot the charts use. */
function modelTiles(rows: TrialRow[]): string {
  const models = [...new Set(rows.map((r) => r.modelShort))].sort()
  const dark = THEMES.dark
  return models
    .map((m, i) => {
      const ts = rows.filter((r) => r.modelShort === m)
      const rate = ts.filter((r) => r.passed).length / ts.length
      const costs = nums(ts, 'costUsd')
      const cost = mean(costs)
      const harnesses = [...new Set(ts.map((r) => r.agent))].sort()
      return `<div class="stat model">
        <div class="stat-head"><span class="eyebrow"><i class="swatch" style="background:${dark.series[i % 4]}"></i>${esc(m)}</span><span class="pill ${rate >= 0.5 ? 'pass' : 'fail'}"><i></i>${plural(ts.length, 'trial')}</span></div>
        <strong>${pct(rate)}</strong>
        <small>${plural(ts.length, 'trial')} on ${esc(harnesses.join(', '))}${cost !== null ? ` &middot; ${formatValue(cost, 'costUsd')} mean${costs.length < ts.length ? ` (${ts.length - costs.length} unpriced)` : ''}` : ' &middot; cost not exposed'}</small>
        <div class="bar"><i style="width:${rate * 100}%"></i></div>
      </div>`
    })
    .join('')
}

/**
 * Cost and speed normalized by success.
 *
 * Mean cost per *trial* (the tile above) flatters a stack that fails fast and
 * cheaply. What a reader actually buys is a completed task, so the headline is
 * total spend divided by passes, and the speed column is the median over
 * passed trials only - a timed-out run has no meaningful duration to average.
 */
function efficiencyTable(rows: TrialRow[]): string {
  const stacks = [...new Set(rows.map((r) => r.stack))].sort()
  const entries = stacks.map((s) => {
    const ts = rows.filter((r) => r.stack === s)
    const passes = ts.filter((r) => r.passed)
    const costs = nums(ts, 'costUsd')
    // Sum over the trials that reported cost; unpriced trials are called out
    // separately rather than silently treated as free.
    const totalCost = costs.length ? costs.reduce((a, b) => a + b, 0) : null
    return {
      stack: s,
      trials: ts.length,
      passes: passes.length,
      rate: ts.length ? passes.length / ts.length : 0,
      totalCost,
      unpriced: ts.length - costs.length,
      perSuccess: totalCost !== null && passes.length ? totalCost / passes.length : null,
      medianPassSecs: median(nums(passes, 'agentSeconds')),
      derived: ts.filter((r) => r.costSource === 'derived').length,
    }
  })
  // Cheapest per success first; stacks that never passed sort last.
  entries.sort((a, b) => (a.perSuccess ?? Infinity) - (b.perSuccess ?? Infinity))

  const body = entries
    .map((e) => `<tr>
      <td>${esc(e.stack)}</td>
      <td class="num">${e.passes} / ${e.trials}</td>
      <td class="num">${pct(e.rate)}</td>
      <td class="num">${e.totalCost === null ? '-' : usd(e.totalCost)}${e.derived ? ` <span class="muted" title="priced from tokens against the gateway catalog">~</span>` : ''}</td>
      <td class="num">${e.perSuccess === null ? `<span class="muted">${e.passes ? 'unpriced' : 'no passes'}</span>` : `<b>${usd(e.perSuccess)}</b>`}</td>
      <td class="num">${e.medianPassSecs === null ? '-' : formatValue(e.medianPassSecs, 'agentSeconds')}</td>
      <td class="num">${e.unpriced ? `<span class="muted">${e.unpriced}</span>` : '-'}</td>
    </tr>`)
    .join('')
  return `<table>
    <thead><tr>
      <th>Stack</th><th class="num">Passed</th><th class="num">Pass rate</th>
      <th class="num">Total cost</th><th class="num">Cost / success</th>
      <th class="num">Median time (passed)</th><th class="num">Unpriced</th>
    </tr></thead>
    <tbody>${body}</tbody>
  </table>`
}

/**
 * The distribution's right tail, which a mean hides.
 *
 * A stack whose median looks fine but which blows the cap on a third of tasks
 * is not usable, and that only shows up as counts. Timeouts are a subset of the
 * over-threshold count, not a separate bucket.
 */
function tailLatencyTable(rows: TrialRow[]): string {
  const stacks = [...new Set(rows.map((r) => r.stack))].sort()
  const entries = stacks.map((s) => {
    const ts = rows.filter((r) => r.stack === s)
    const secs = nums(ts, 'agentSeconds')
    return {
      stack: s,
      trials: ts.length,
      slow: ts.filter((r) => r.overSlow).length,
      timeouts: ts.filter((r) => r.timedOut).length,
      median: median(secs),
      p95: quantile(secs, 0.95),
      max: secs.length ? Math.max(...secs) : null,
    }
  })
  entries.sort((a, b) => b.timeouts - a.timeouts || b.slow - a.slow)

  const secsCell = (v: number | null) => (v === null ? '-' : formatValue(v, 'agentSeconds'))
  const body = entries
    .map((e) => `<tr>
      <td>${esc(e.stack)}</td>
      <td class="num">${e.slow ? `<b>${e.slow}</b>` : '0'} <span class="muted">/ ${e.trials}</span></td>
      <td class="num">${e.timeouts ? `<span class="pill fail"><i></i>${e.timeouts}</span>` : '0'}</td>
      <td class="num">${secsCell(e.median)}</td>
      <td class="num">${secsCell(e.p95)}</td>
      <td class="num">${secsCell(e.max)}</td>
    </tr>`)
    .join('')
  return `<table>
    <thead><tr>
      <th>Stack</th><th class="num">Over ${SLOW_TRIAL_SECONDS / 60} min</th><th class="num">Timeouts</th>
      <th class="num">Median</th><th class="num">p95</th><th class="num">Slowest</th>
    </tr></thead>
    <tbody>${body}</tbody>
  </table>`
}

/**
 * Where the stacks agree and where they actually separate.
 *
 * Tasks every stack passed carry no signal, and tasks every stack failed are a
 * statement about the suite rather than the stacks. What is left - especially a
 * task exactly one stack solved - is the entire discriminating power of the job,
 * and it is usually a handful of tasks out of thirty.
 */
function taskOverlap(rows: TrialRow[]): string {
  const stacks = [...new Set(rows.map((r) => r.stack))].sort()
  const tasks = [...new Set(rows.map((r) => r.task))].sort()
  if (stacks.length < 2) return '<p class="empty">Overlap needs at least two stacks to compare.</p>'

  // A stack passes a task if any of its attempts on that task passed.
  const passers = new Map<string, string[]>()
  for (const t of tasks) {
    passers.set(t, stacks.filter((s) => rows.some((r) => r.task === t && r.stack === s && r.passed)))
  }
  const all = tasks.filter((t) => passers.get(t)!.length === stacks.length)
  const none = tasks.filter((t) => passers.get(t)!.length === 0)
  const unique = tasks.filter((t) => passers.get(t)!.length === 1)
  const contested = tasks.length - all.length - none.length

  const list = (ts: string[]) => (ts.length ? ts.map((t) => `<code>${esc(t)}</code>`).join(' ') : '<span class="muted">none</span>')
  const uniqueRows = unique.length
    ? unique.map((t) => `<tr><td><code>${esc(t)}</code></td><td>${esc(passers.get(t)![0])}</td></tr>`).join('')
    : `<tr><td colspan="2"><span class="muted">No task was solved by exactly one stack.</span></td></tr>`

  return `<div class="overlap">
    <div class="overlap-stats">
      <div class="stat"><div class="stat-head"><span class="eyebrow">Solved by all</span></div><strong>${all.length}</strong><small>of ${plural(tasks.length, 'task')} &middot; no signal</small></div>
      <div class="stat"><div class="stat-head"><span class="eyebrow">Solved by none</span></div><strong>${none.length}</strong><small>suite ceiling for these stacks</small></div>
      <div class="stat"><div class="stat-head"><span class="eyebrow">Discriminating</span></div><strong>${contested}</strong><small>separate at least one stack</small></div>
      <div class="stat"><div class="stat-head"><span class="eyebrow">Unique wins</span></div><strong>${unique.length}</strong><small>solved by exactly one stack</small></div>
    </div>
    <table>
      <thead><tr><th>Unique win</th><th>Only stack to pass</th></tr></thead>
      <tbody>${uniqueRows}</tbody>
    </table>
    <div class="overlap-lists">
      <p><span class="eyebrow">Passed by every stack</span>${list(all)}</p>
      <p><span class="eyebrow">Failed by every stack</span>${list(none)}</p>
    </div>
  </div>`
}

async function chartBlock(job: string, rows: TrialRow[], section: Section, n: number): Promise<{ html: string; warnings: string[] }> {
  const warnings = new Set<string>()
  const svgs: Record<ThemeMode, string> = { light: '', dark: '' }
  const charted = section.derive ? section.derive(rows) : rows
  for (const theme of ['light', 'dark'] as ThemeMode[]) {
    const out = buildChart(charted, { ...section.state, theme })
    out.warnings.forEach((w) => warnings.add(w))
    svgs[theme] = await renderSvg(out.spec)
  }
  const notes = [...warnings].map((w) => `<div class="warn">${WARN_ICON}<span>${esc(w)}</span></div>`).join('')
  const recipe = section.state.recipe ?? 'bar'
  const html = `
  <section id="${section.id}" class="section">
    <div class="section-head">
      <div>
        <div class="eyebrow">${String(n).padStart(2, '0')} &middot; ${esc(recipe)}</div>
        <h2>${esc(section.heading)}</h2>
        <p class="lede">${esc(section.lede)}</p>
      </div>
      <a class="btn" href="${studioUrl(job, section.state)}">Open in studio</a>
    </div>
    <div class="card">
      <div class="card-head">
        <div class="window-dots"><span></span><span></span><span></span></div>
        <div class="title"><span>${esc(RECIPE_LABEL[recipe])}</span></div>
        <small>${esc(recipe)} &middot; ${plural(section.derive ? rows.length : charted.length, 'trial')}</small>
        <div class="right"><small class="only-dark">surface #101111</small><small class="only-light">surface #ffffff</small></div>
      </div>
      <div class="canvas">
        <div class="only-light">${svgs.light}</div>
        <div class="only-dark">${svgs.dark}</div>
      </div>
    </div>
    ${notes ? `<div class="notes">${notes}</div>` : ''}
  </section>`
  return { html, warnings: [...warnings] }
}

function tableView(rows: TrialRow[]): string {
  // The harness version is provenance and already stated in the footer. It earns
  // a column only when a job actually mixed versions, which would otherwise be
  // invisible - and dropping it lets Cost fit without a horizontal scroll.
  const versionsPerAgent = new Map<string, Set<string>>()
  for (const r of rows) versionsPerAgent.set(r.agent, new Set([...(versionsPerAgent.get(r.agent) ?? []), r.agentVersion ?? '?']))
  const mixedVersions = [...versionsPerAgent.values()].some((v) => v.size > 1)

  const cols: { key: keyof TrialRow; label: string; measure?: Measure; num?: boolean }[] = [
    { key: 'passed', label: 'Result' },
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
      if (c.key === 'passed') return `<td><span class="pill ${r.passed ? 'pass' : 'fail'}"><i></i>${r.passed ? 'pass' : 'fail'}</span></td>`
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
  // Unpinned routing is not a footnote. Measured 2026-09-02, the gateway's
  // default vendor for zai/glm-5.3-flash was 6x slower than the fastest one
  // serving the identical model, so an unpinned job's timings say more about
  // routing than about the model.
  const unpinned = rows.filter((r) => r.vendor === null)
  if (unpinned.length) out.push(`${plural(unpinned.length, 'trial')} ran without a pinned serving vendor (${[...new Set(unpinned.map((r) => r.stack))].join(', ')}); the gateway chose the route. Latency and cost for those trials are not attributable to the model.`)
  const vendors = new Set(rows.map((r) => r.vendor).filter((v): v is string => v !== null))
  if (vendors.size > 1) out.push(`Trials span ${vendors.size} serving vendors (${[...vendors].sort().join(', ')}); vendor throughput varies several-fold for the same model, so cross-stack timing comparisons need to hold it fixed.`)
  const derived = rows.filter((r) => r.costSource === 'derived')
  if (derived.length) out.push(`${plural(derived.length, 'trial')} has cost derived from token counts priced against the gateway catalog rather than reported by the harness (${[...new Set(derived.map((r) => r.stack))].join(', ')}); marked with ~ in the cost table. Codex reports no cost of its own on this route.`)
  const noCache = rows.filter((r) => (r.cacheTokens ?? 0) < 1000 && (r.inputTokens ?? 0) > 20000)
  if (noCache.length) out.push(`${plural(noCache.length, 'trial')} ran with effectively no prompt caching (${[...new Set(noCache.map((r) => r.stack))].join(', ')}). Their cost is not comparable to cached stacks on a per-token basis.`)
  for (const [agent, versions] of Object.entries(exp.agentVersions)) if (versions.length > 1) out.push(`${agent} ran at ${versions.length} different versions (${versions.join(', ')}) within this job.`)
  const perCell = new Map<string, number>()
  for (const r of rows) perCell.set(`${r.stack}|${r.task}`, (perCell.get(`${r.stack}|${r.task}`) ?? 0) + 1)
  const minN = Math.min(...perCell.values())
  if (minN < 3) out.push(`Smallest cell has ${plural(minN, 'trial')}; interpret single-attempt comparisons cautiously.`)
  const tasks = new Set(rows.map((r) => r.task))
  if (tasks.size < 3) out.push(`Only ${plural(tasks.size, 'task')}; a single task cannot separate model from task effects.`)
  return out
}

// Inline SVG for the two icons the page uses (lucide `triangle-alert` and
// `arrow-up-right`), so the report stays a single self-contained file.
const WARN_ICON = '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3"/><path d="M12 9v4"/><path d="M12 17h.01"/></svg>'
const MOON_ICON = '<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z"/></svg>'
const SUN_ICON = '<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="4"/><path d="M12 2v2"/><path d="M12 20v2"/><path d="m4.93 4.93 1.41 1.41"/><path d="m17.66 17.66 1.41 1.41"/><path d="M2 12h2"/><path d="M20 12h2"/><path d="m6.34 17.66-1.41 1.41"/><path d="m19.07 4.93-1.41 1.41"/></svg>'
const DOWNLOAD_ICON = '<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><path d="M7 10l5 5 5-5"/><path d="M12 15V3"/></svg>'

/**
 * The brand tokens are read from src/tokens.css at build time and inlined, so the
 * report is styled by the same file as the landing page and the studio. The chrome
 * is always the dark product surface; only the chart canvas flips between the two
 * validated palette surfaces, exactly as the studio does.
 */
const TOKENS_CSS = readFileSync(new URL('../../src/tokens.css', import.meta.url), 'utf8').replace(/^@import[^\n]+\n/m, '')
const REPORT_CSS = `
  :root {
    --bg: #171717;
    --panel: #202020;
    --panel-2: #262626;
    --panel-3: #303030;
    --line: #525252;
    --line-soft: rgba(245, 242, 238, .08);
    --line-strong: rgba(245, 242, 238, .22);
    --muted: #D4D4D4;
    --faint: #A3A3A3;
    --white: #FAFAFA;
    --accent: #BDBDBD;
    --accent-ink: #171717;
    --sans: 'Inter', system-ui, sans-serif;
    --mono: 'Inter', system-ui, sans-serif;
  }
  *, *::before, *::after { box-sizing: border-box; }
  html { scroll-behavior: smooth; }
  body { margin: 0; min-height: 100vh; background: var(--bg); color: var(--white); font: 400 13px/1.55 var(--sans); letter-spacing: .005em; position: relative; }
  body > * { position: relative; z-index: 1; }
  a { color: inherit; }
  h1, h2, p { margin: 0; }
  h1, h2 { font-family: var(--sans); font-weight: 500; }
  .eyebrow { color: var(--muted); font: 500 11px var(--sans); display: inline-flex; align-items: center; gap: 6px; }
  .num { text-align: right; font-family: var(--mono); font-variant-numeric: tabular-nums; }

  .btn {
    height: 30px; padding: 0 11px;
    display: inline-flex; align-items: center; gap: 7px;
    border: 1px solid var(--line); border-radius: 6px;
    background: var(--panel-2); color: #c9ccc9; text-decoration: none;
    font-size: 12px; font-weight: 600; cursor: pointer; white-space: nowrap;
    transition: border-color .15s, color .15s, background .15s;
  }
  .btn:hover { border-color: var(--line-strong); color: var(--white); background: var(--panel-3); }
  .btn.primary { background: var(--accent); border-color: var(--accent); color: var(--accent-ink); }
  .btn.primary:hover { background: #e4ff85; border-color: #e4ff85; color: var(--accent-ink); }
  .btn svg { color: var(--muted); }
  .btn.primary svg { color: inherit; }

  .pill {
    display: inline-flex; align-items: center; gap: 5px;
    height: 20px; padding: 0 7px;
    border: 1px solid var(--line); border-radius: 5px;
    color: var(--muted); font: 500 10px var(--sans); white-space: nowrap;
  }
  .pill i { display: none; }
  .pill.pass { color: var(--white); border-color: var(--line); background: transparent; }
  .pill.fail { color: var(--muted); border-color: var(--line); background: transparent; }

  /* -- topbar -------------------------------------------------------------- */
  .topbar {
    position: sticky; top: 0; z-index: 50;
    height: 56px; padding: 0 18px;
    display: flex; align-items: center; gap: 14px;
    border-bottom: 1px solid rgba(255, 255, 255, .06);
    background: #171717;
  }
  .brand { display: flex; align-items: center; gap: 10px; font-size: 15px; font-weight: 500; letter-spacing: -.01em; text-decoration: none; }
  .brand svg { width: auto; height: 21px; display: block; }
  .crumbs { display: flex; align-items: center; gap: 8px; min-width: 0; color: var(--faint); font-size: 12px; }
  .crumbs a { color: var(--muted); text-decoration: none; }
  .crumbs a:hover { color: var(--white); }
  .crumbs strong { color: var(--white); font-weight: 700; font-size: 12.5px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .topbar .actions { margin-left: auto; display: flex; align-items: center; gap: 6px; }
  .topbar .divider { width: 1px; height: 18px; background: var(--line); margin: 0 6px; }

  .canvas-toggle { display: inline-flex; gap: 2px; padding: 3px; border: 1px solid var(--line); border-radius: 10px; background: var(--panel); }
  .canvas-btn {
    position: relative; height: 22px; padding: 0 9px; border-radius: 7px;
    display: inline-flex; align-items: center; gap: 6px;
    color: var(--muted); font: 500 10px var(--sans); cursor: pointer;
    transition: color .15s, background .15s;
  }
  .canvas-btn:hover { color: #d4d6d3; }
  .canvas-btn:has(input:checked) { background: var(--panel-3); color: var(--white); box-shadow: inset 0 0 0 1px var(--line); }
  .canvas-btn:has(input:focus-visible) { outline: 2px solid var(--accent); outline-offset: 1px; }
  .sr-only { position: absolute; width: 1px; height: 1px; margin: -1px; padding: 0; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; border: 0; }

  .menu { position: relative; }
  .menu > summary { list-style: none; cursor: pointer; }
  .menu > summary::-webkit-details-marker { display: none; }
  .menu > summary:focus-visible { outline: 2px solid var(--accent); outline-offset: 1px; }
  .menu[open] > summary { border-color: var(--line-strong); color: var(--white); background: var(--panel-3); }
  /* Chrome hides a closed details' children; Safari still paints an absolutely
     positioned one, so say it outright rather than leaning on the UA sheet. */
  .menu:not([open]) .menu-pop { display: none; }
  .menu-pop {
    position: absolute; right: 0; top: calc(100% + 20px); z-index: 30; min-width: 214px;
    display: flex; flex-direction: column; gap: 2px; padding: 5px;
    border: 1px solid var(--line); border-radius: 11px; background: var(--panel);
    box-shadow: 0 14px 34px rgba(0, 0, 0, .5);
  }
  .menu-pop button {
    appearance: none; border: 0; background: none; color: var(--white); font: 500 12px var(--sans);
    display: flex; flex-direction: column; gap: 2px; align-items: flex-start;
    padding: 7px 9px; border-radius: 7px; text-align: left; cursor: pointer;
  }
  .menu-pop button:hover { background: var(--panel-3); }
  .menu-pop button:focus-visible { outline: 2px solid var(--accent); outline-offset: -2px; }
  .menu-pop small { color: var(--muted); font: 400 10px/1.4 var(--sans); }

  /* -- page ---------------------------------------------------------------- */
  .page { max-width: 1120px; margin: 0 auto; padding: 30px 26px 80px; display: flex; flex-direction: column; gap: 26px; }
  .head { display: flex; flex-direction: column; gap: 6px; }
  .head h1 { font-size: 38px; font-weight: 500; letter-spacing: -.03em; line-height: 1.05; }
  .head .meta { color: var(--muted); font-size: 12.5px; display: flex; flex-wrap: wrap; gap: 6px 10px; }
  .head .meta b { color: #c9ccc9; font-weight: 600; }
  .head .meta i { font-style: normal; color: var(--faint); }

  .stats { display: grid; grid-template-columns: repeat(auto-fit, minmax(160px, 1fr)); gap: 10px; }
  .stats.models { grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); }
  .stat {
    min-height: 92px; padding: 13px 14px 12px;
    display: flex; flex-direction: column; justify-content: flex-end; gap: 4px;
    border: 1px solid var(--line-soft); border-radius: 8px; background: var(--panel);
  }
  .stat .stat-head { margin-bottom: auto; display: flex; align-items: center; justify-content: space-between; gap: 8px; color: #777d79; }
  .stat strong { font: 600 22px var(--sans); font-variant-numeric: tabular-nums; letter-spacing: -.02em; color: var(--white); }
  .stat strong small { font-size: 12px; color: var(--muted); margin-left: 3px; }
  .stat > small { color: var(--faint); font-size: 10.5px; }
  .stat .bar { height: 3px; margin-top: 6px; border-radius: 3px; background: #202221; overflow: hidden; }
  .stat .bar i { display: block; height: 100%; background: var(--accent); border-radius: inherit; }
  .stat .split { display: flex; height: 3px; margin-top: 6px; border-radius: 3px; overflow: hidden; background: #202221; gap: 1px; }
  .stat .split i { display: block; height: 100%; }
  .swatch { width: 8px; height: 8px; border-radius: 2px; display: inline-block; flex: none; }
  .stat.model .stat-head .eyebrow { color: #c1c5c2; text-transform: none; letter-spacing: 0; font: 600 12px var(--sans); }

  .block { display: flex; flex-direction: column; gap: 10px; }
  .block-head { display: flex; align-items: baseline; justify-content: space-between; gap: 12px; }
  .block-head h2, .section-head h2 { font-size: 21px; font-weight: 500; letter-spacing: -.02em; margin-top: 4px; }
  .lede { color: var(--muted); font-size: 12.5px; max-width: 720px; margin-top: 4px; }

  .section { display: flex; flex-direction: column; gap: 12px; padding-top: 10px; }
  .section-head { display: flex; align-items: flex-end; justify-content: space-between; gap: 16px; }
  .section-head .btn { flex: none; }

  /* .card is the chart card, addressed as ".card svg" by the studio suite too. */
  .card, .panel { border: 1px solid var(--line-soft); border-radius: 8px; background: var(--panel); overflow: hidden; }
  .card-head {
    height: 42px; padding: 0 14px 0 15px;
    display: flex; align-items: center; gap: 12px;
    border-bottom: 1px solid var(--line-soft); color: #a3a8a5; font-size: 11px; font-weight: 700;
  }
  .card-head .window-dots { display: none; }
  .card-head .title { display: flex; align-items: center; gap: 8px; min-width: 0; }
  .card-head .title span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .card-head small { color: #555a57; font: 400 9px var(--mono); }
  .card-head .right { margin-left: auto; display: flex; align-items: center; gap: 6px; }
  .card-body { padding: 0; overflow-x: auto; }

  /* The canvas is the only region that changes with the chart theme. */
  .canvas { position: relative; padding: 22px 24px; overflow-x: auto; background: #171717; }
  .canvas svg { display: block; max-width: 100%; height: auto; }
  .only-light { display: none; }
  html[data-canvas='light'] .only-light { display: block; }
  html[data-canvas='light'] .only-dark { display: none; }
  html[data-canvas='light'] .canvas { background: #ffffff; color: #2c2a25; }
  html[data-canvas='light'] .canvas::before { content: ''; position: absolute; inset: 0; pointer-events: none; box-shadow: inset 0 0 0 1px rgba(0, 0, 0, .06); }

  .notes { display: flex; flex-direction: column; gap: 6px; }
  .warn {
    display: flex; align-items: flex-start; gap: 10px;
    padding: 9px 12px; border: 1px solid var(--line);
    border-radius: 6px; background: var(--panel); color: var(--muted); font-size: 12px; line-height: 1.5;
  }
  .warn svg { flex: none; margin-top: 2px; color: var(--warn); }
  .limits { margin: 0; padding: 0; list-style: none; }
  .limits li { display: flex; gap: 10px; padding: 11px 16px; border-bottom: 1px solid var(--line-soft); color: #b7bbb9; font-size: 12.5px; }
  .limits li:last-child { border-bottom: 0; }
  .limits li span.n { flex: none; color: var(--warn); font: 500 10px var(--mono); margin-top: 3px; }
  .panel .empty { padding: 16px; color: var(--muted); font-size: 12.5px; }
  .block > .lede { color: var(--muted); font-size: 12.5px; max-width: 78ch; margin-top: -2px; }
  .muted { color: var(--faint); }
  .overlap { display: flex; flex-direction: column; }
  .overlap-stats { display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: 10px; padding: 14px 16px; border-bottom: 1px solid var(--line-soft); }
  .overlap-stats .stat { background: none; border: 0; padding: 0; }
  .overlap-lists { padding: 12px 16px; display: flex; flex-direction: column; gap: 10px; }
  .overlap-lists p { display: flex; flex-wrap: wrap; align-items: baseline; gap: 6px; margin: 0; }
  .overlap-lists .eyebrow { width: 100%; }
  .overlap-lists code, .overlap code { font: 500 11px var(--mono); color: #b7bbb9; background: var(--panel-2); border: 1px solid var(--line-soft); border-radius: 4px; padding: 1px 5px; }

  table { border-collapse: collapse; width: 100%; font-size: 12.5px; }
  th, td { text-align: left; padding: 9px 12px; border-bottom: 1px solid var(--line-soft); white-space: nowrap; }
  th { color: var(--faint); font: 500 10px var(--sans); }
  th.num { text-align: right; }
  tbody tr:last-child td { border-bottom: 0; }
  tbody tr:hover td { background: rgba(255, 255, 255, .015); }
  td.num { color: #d4d6d3; font-size: 12px; }

  footer { color: var(--faint); font-size: 11.5px; line-height: 1.7; padding-top: 18px; border-top: 1px solid var(--line-soft); }
  footer code { font: 400 11px var(--mono); color: var(--muted); }
  footer .row { display: flex; gap: 6px 14px; flex-wrap: wrap; }

  @media (max-width: 720px) {
    .page { padding: 20px 14px 60px; }
    .section-head { flex-direction: column; align-items: flex-start; }
    .crumbs { display: none; }
    .topbar { height: 52px; padding: 0 14px; gap: 8px; }
    .brand > span { display: none; }
    .brand svg { height: 18px; }
    .canvas-toggle, .topbar .divider, .topbar .btn.primary { display: none; }
    .topbar .actions { margin-left: auto; }
  }
  @media (prefers-reduced-motion: reduce) { html { scroll-behavior: auto; } * { transition: none !important; } }
`

async function render(exp: JobExport): Promise<string> {
  const rows = exp.rows
  const agents = [...new Set(rows.map((r) => r.agent))].sort()
  const models = [...new Set(rows.map((r) => r.modelShort))].sort()
  const tasks = [...new Set(rows.map((r) => r.task))].sort()

  const sections: string[] = []
  const jobSections = sectionsFor(rows)
  for (const [i, s] of jobSections.entries()) sections.push((await chartBlock(exp.job, rows, s, i + 1)).html)
  const limits = limitations(exp)

  return `<!doctype html>
<html lang="en" data-theme="dark" data-canvas="dark">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="theme-color" content="#171717">
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap">
<title>${esc(exp.job)} &middot; Heval report</title>
<style>
${TOKENS_CSS}
${REPORT_CSS}
</style>
</head>
<body>
<header class="topbar">
  <a class="brand" href="/"><span>Heval evaluation report</span></a>
  <div class="crumbs"><a href="/#reports">Reports</a><span>/</span><strong>${esc(exp.job)}</strong></div>
  <div class="actions">
    <div class="canvas-toggle" role="radiogroup" aria-label="Chart canvas">
      <label class="canvas-btn"><input type="radio" name="canvas" value="dark" class="sr-only" checked>${MOON_ICON}Dark mode</label>
      <label class="canvas-btn"><input type="radio" name="canvas" value="light" class="sr-only">${SUN_ICON}Light mode</label>
    </div>
    <span class="divider"></span>
    <details class="menu">
      <summary class="btn">${DOWNLOAD_ICON}Export</summary>
      <div class="menu-pop">
        <button type="button" data-export="html">Standalone HTML<small>This page as one shareable file</small></button>
        <button type="button" data-export="csv">Trials CSV<small>${plural(rows.length, 'row')} for a spreadsheet</small></button>
        <button type="button" data-export="json">Trials JSON<small>Reload into the studio</small></button>
      </div>
    </details>
    <a class="btn primary" href="${studioUrl(exp.job, jobSections[0].state)}">Open in studio</a>
  </div>
</header>

<main class="page">
  <div class="head">
    <span class="eyebrow">Static report &middot; generated ${esc(exp.generatedAt.slice(0, 10))}</span>
    <h1>${esc(exp.job)}</h1>
    <div class="meta">
      <span><b>${rows.length}</b> trials</span><i>&middot;</i>
      <span><b>${agents.length}</b> ${agents.length === 1 ? 'harness' : 'harnesses'}: ${esc(agents.join(', '))}</span><i>&middot;</i>
      <span><b>${models.length}</b> ${models.length === 1 ? 'model' : 'models'}: ${esc(models.join(', '))}</span><i>&middot;</i>
      <span><b>${tasks.length}</b> ${tasks.length === 1 ? 'task' : 'tasks'}: ${esc(tasks.join(', '))}</span>
    </div>
  </div>

  <div class="stats">${summaryTiles(rows)}</div>

  <div class="block">
    <div class="block-head"><div><span class="eyebrow">By model</span><h2>Pass rate per model</h2></div></div>
    <div class="stats models">${modelTiles(rows)}</div>
  </div>

  ${sections.join('\n')}

  <div class="block" id="efficiency">
    <div class="block-head"><div><span class="eyebrow">Normalized by success</span><h2>Cost and speed per completed task</h2></div></div>
    <p class="lede">Mean cost per trial rewards a stack for failing cheaply. This divides total spend by passes instead, and takes the median duration over passed trials only.</p>
    <div class="panel"><div class="card-body">${efficiencyTable(rows)}</div></div>
  </div>

  <div class="block" id="tail">
    <div class="block-head"><div><span class="eyebrow">Right tail</span><h2>Slow trials and timeouts</h2></div></div>
    <p class="lede">Counts, because this is where a usable median hides an unusable stack. Timeouts are a subset of the over-threshold column, not a separate bucket.</p>
    <div class="panel"><div class="card-body">${tailLatencyTable(rows)}</div></div>
  </div>

  <div class="block" id="overlap">
    <div class="block-head"><div><span class="eyebrow">Where stacks separate</span><h2>Task overlap</h2></div></div>
    <p class="lede">Tasks every stack solved carry no signal and tasks none solved describe the suite, not the stacks. What remains is the job's entire discriminating power.</p>
    <div class="panel">${taskOverlap(rows)}</div>
  </div>

  <div class="block" id="limitations">
    <div class="block-head"><div><span class="eyebrow">Read before quoting</span><h2>Limitations</h2></div></div>
    <div class="panel">${limits.length ? `<ul class="limits">${limits.map((l, i) => `<li><span class="n">${String(i + 1).padStart(2, '0')}</span><span>${esc(l)}</span></li>`).join('')}</ul>` : '<p class="empty">None detected automatically. Record vendor routing and any manual interventions by hand.</p>'}</div>
  </div>

  <div class="block" id="table">
    <div class="block-head"><div><span class="eyebrow">Every trial</span><h2>Table view</h2></div><a class="btn" href="${studioUrl(exp.job, jobSections[0].state)}">Explore in studio</a></div>
    <div class="panel"><div class="card-body">${tableView(rows)}</div></div>
  </div>

  <footer>
    <div class="row">
      <span>Generated by <code>harbor/report/build-report.ts</code> from Harbor per-trial output${exp.jobId ? ` (job <code>${esc(exp.jobId)}</code>)` : ''}.</span>
      <span>Harness versions observed in-sandbox: ${Object.entries(exp.agentVersions).map(([a, v]) => `<code>${esc(a)} ${esc(v.join('/'))}</code>`).join(', ') || 'not recorded'}.</span>
    </div>
    <div class="row">
      <span>Task digests: ${[...new Set(rows.map((r) => `${r.task} ${r.taskChecksum?.slice(0, 12) ?? '?'}`))].map((d) => `<code>${esc(d)}</code>`).join(', ')}.</span>
    </div>
    <div class="row">
      <span>Charts are Vega-Lite recipes from <code>src/charts/recipes.ts</code>, rendered once per palette surface. The dark report uses the shared chart palette (see <code>src/charts/palette.ts</code>).</span>
    </div>
  </footer>
</main>

<script type="application/json" id="heval-data" data-heval>${JSON.stringify(exp).replace(/</g, '\\u003c')}</script>
<script data-heval>
  (() => {
    const data = JSON.parse(document.getElementById('heval-data').textContent)
    const menu = document.querySelector('.menu')

    const save = (name, mime, text) => {
      const url = URL.createObjectURL(new Blob([text], { type: mime }))
      const a = Object.assign(document.createElement('a'), { href: url, download: name })
      a.click()
      setTimeout(() => URL.revokeObjectURL(url), 1000)
    }

    const csv = () => {
      const cols = Object.keys(data.rows[0] || {})
      const cell = (v) => {
        if (v === null || v === undefined) return ''
        const s = String(v)
        return /[",\\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s
      }
      return [cols.join(','), ...data.rows.map((r) => cols.map((c) => cell(r[c])).join(','))].join('\\n')
    }

    // Every link on this page that starts at the site root - the brand, the
    // crumbs, the studio buttons - needs a server behind it, and a copy sent to
    // someone has none. Drop the actions and flatten the nav to plain text so a
    // shared file has nothing dead in it. The charts are inline SVG and the rows
    // are embedded above, so once those links are gone the file is whole.
    const standalone = () => {
      const doc = document.documentElement.cloneNode(true)
      doc.dataset.canvas = document.documentElement.dataset.canvas
      doc.querySelectorAll('a[href^="/"]').forEach((a) => {
        if (a.classList.contains('btn')) return a.remove()
        const span = document.createElement('span')
        span.className = a.className
        span.innerHTML = a.innerHTML
        a.replaceWith(span)
      })
      doc.querySelectorAll('details.menu').forEach((d) => d.removeAttribute('open'))
      // Served through Vite in development, the page also carries an HMR client
      // and a refresh preamble pointing at /@vite/. Those are the host's, not the
      // report's, and they 404 the moment the file leaves this machine.
      doc.querySelectorAll('script:not([data-heval])').forEach((e) => e.remove())
      return '<!doctype html>\\n' + doc.outerHTML
    }

    const exporters = {
      html: () => save(data.job + '.html', 'text/html', standalone()),
      csv: () => save(data.job + '.csv', 'text/csv', csv()),
      json: () => save(data.job + '.json', 'application/json', JSON.stringify(data, null, 2)),
    }

    menu.querySelectorAll('[data-export]').forEach((b) =>
      b.addEventListener('click', () => { exporters[b.dataset.export](); menu.removeAttribute('open') }))
    document.addEventListener('click', (e) => { if (!menu.contains(e.target)) menu.removeAttribute('open') })
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape') menu.removeAttribute('open') })
  })()
</script>

<script data-heval>
  (() => {
    const html = document.documentElement
    const radios = document.querySelectorAll('input[name="canvas"]')
    const apply = (v) => { html.dataset.canvas = v; radios.forEach((r) => { r.checked = r.value === v }); try { localStorage.setItem('heval:canvas', v) } catch {} }
    const fromUrl = new URLSearchParams(location.search).get('theme')
    let saved = null
    try { saved = localStorage.getItem('heval:canvas') } catch {}
    const initial = fromUrl === 'light' || fromUrl === 'dark' ? fromUrl : saved === 'light' || saved === 'dark' ? saved : 'dark'
    apply(initial)
    radios.forEach((r) => r.addEventListener('change', () => apply(r.value)))
  })()
</script>
</body>
</html>`
}

// -- cli ------------------------------------------------------------------------------

const args = process.argv.slice(2)
const jobDir = args.find((a) => !a.startsWith('--'))
const outDir = args.includes('--out') ? args[args.indexOf('--out') + 1] : 'results/harbor'
if (!jobDir) {
  console.error('usage: bun harbor/report/build-report.ts <job-dir|job.json> [--out results/harbor]')
  process.exit(2)
}
if (!existsSync(jobDir)) {
  console.error(`no such job directory: ${jobDir}`)
  process.exit(2)
}

// A normalized export may carry a deliberate pricing adjustment that is not
// present in the raw Harbor output. Render it directly instead of rebuilding
// it from the trial directories and discarding that adjustment.
const fromExport = jobDir.endsWith('.json')
const exp = fromExport
  ? (JSON.parse(readFileSync(jobDir, 'utf8')) as JobExport)
  : exportJob(jobDir)
if (!exp.rows.length) {
  console.error(`no readable trials in ${jobDir} - is this a finished Harbor job directory?`)
  process.exit(1)
}

mkdirSync(outDir, { recursive: true })
const jsonPath = join(outDir, `${exp.job}.json`)
const htmlPath = join(outDir, `${exp.job}.html`)
if (!fromExport) writeFileSync(jsonPath, JSON.stringify(exp, null, 2))
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
if (!fromExport) writeFileSync(indexPath, JSON.stringify(index, null, 2))

console.log(
  fromExport
    ? `${exp.rows.length} trials from ${jobDir} -> ${htmlPath}`
    : `${exp.rows.length} trials -> ${jsonPath}, ${htmlPath}, ${indexPath}`,
)
