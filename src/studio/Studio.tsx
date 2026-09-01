/**
 * Heval chart studio - the configurable graph editor over Harbor output.
 *
 * The controls drive `buildChart` from src/charts/recipes.ts, which is the same
 * function the static report compiles headlessly. Whatever you see here is what
 * `bun run report` will emit for the same state, and the state travels in the
 * URL so a chart can be linked from the report and back.
 *
 * The editor is deliberately not a free-form Vega playground: the controls only
 * expose choices the recipes can honor (and the recipes refuse a fifth
 * categorical color rather than inventing a hue). The Spec tab is the escape
 * hatch - edit the compiled JSON directly and it renders, but that edit does not
 * round-trip back into the controls, so it is for probing, not for authoring.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import embed, { type Result as EmbedResult } from 'vega-embed'
import {
  buildChart,
  DEFAULT_STATE,
  formatValue,
  RECIPE_DEFAULTS,
  RECIPE_LABEL,
  type Aggregate,
  type ChartState,
  type Recipe,
  type SortOrder,
} from '../charts/recipes'
import { paramsFromState, readUrl } from '../charts/url'
import {
  DIMENSIONS,
  DIMENSION_LABEL,
  MEASURES,
  MEASURE_LABEL,
  type Dimension,
  type JobExport,
  type JobIndex,
  type JobIndexEntry,
  type Measure,
} from '../charts/trial'

const RESULTS = '/results/harbor'
const RECIPES: Recipe[] = ['bar', 'scatter', 'strip', 'matrix']
const AGGREGATES: Aggregate[] = ['mean', 'median', 'sum', 'min', 'max']
const SORTS: { value: SortOrder; label: string }[] = [
  { value: 'alpha', label: 'Alphabetical' },
  { value: 'desc', label: 'Highest first' },
  { value: 'asc', label: 'Lowest first' },
]

/** Which controls a recipe actually reads. Hiding the rest keeps the panel honest. */
const USES: Record<Recipe, Set<keyof ChartState>> = {
  bar: new Set(['x', 'color', 'facet', 'measure', 'aggregate', 'sort', 'labels', 'intervals']),
  scatter: new Set(['x', 'color', 'measure', 'xMeasure', 'aggregate', 'labels']),
  strip: new Set(['x', 'color', 'facet', 'measure', 'aggregate', 'sort']),
  matrix: new Set(['x', 'row', 'measure', 'aggregate', 'sort', 'labels']),
}

type Tab = 'chart' | 'table' | 'spec' | 'rows'

function download(name: string, blob: Blob) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = name
  a.click()
  URL.revokeObjectURL(url)
}

export function Studio() {
  const initial = useMemo(() => readUrl(window.location.search), [])
  const [state, setState] = useState<ChartState>(initial.state)
  const [index, setIndex] = useState<JobIndexEntry[]>([])
  const [job, setJob] = useState<string | null>(initial.job)
  const [data, setData] = useState<JobExport | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [tab, setTab] = useState<Tab>('chart')
  const [override, setOverride] = useState<string | null>(null)
  const [embedError, setEmbedError] = useState<string | null>(null)
  const [dragging, setDragging] = useState(false)

  const host = useRef<HTMLDivElement>(null)
  const filePicker = useRef<HTMLInputElement>(null)
  const view = useRef<EmbedResult['view'] | null>(null)

  const set = useCallback(<K extends keyof ChartState>(key: K, value: ChartState[K]) => {
    setState((prev) => ({ ...prev, [key]: value }))
  }, [])

  // -- data ------------------------------------------------------------------

  useEffect(() => {
    fetch(`${RESULTS}/index.json`)
      .then((r) => (r.ok ? r.json() : { jobs: [] }))
      .then((catalog: JobIndex) => {
        setIndex(catalog.jobs ?? [])
        setJob((current) => current ?? catalog.jobs?.[0]?.job ?? null)
      })
      .catch(() => setIndex([]))
  }, [])

  useEffect(() => {
    if (!job) return
    let live = true
    fetch(`${RESULTS}/${job}.json`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`${r.status} ${r.statusText}`))))
      .then((exp: JobExport) => {
        if (!live) return
        setData(exp)
        setLoadError(null)
      })
      .catch((e: Error) => live && setLoadError(`Could not load ${job}.json (${e.message}). Run bun run report <job-dir> first, or open an export below.`))
    return () => { live = false }
  }, [job])

  // -- url + theme -----------------------------------------------------------

  useEffect(() => {
    const params = paramsFromState(state, job ? { job } : {})
    window.history.replaceState(null, '', `${window.location.pathname}?${params.toString()}`)
    document.documentElement.dataset.theme = state.theme
  }, [state, job])

  // -- chart -----------------------------------------------------------------

  const chart = useMemo(() => (data ? buildChart(data.rows, state) : null), [data, state])

  // The generated spec is the source of truth for the Spec tab until the user
  // edits it; after that their text wins so keystrokes are not overwritten.
  const specText = override ?? (chart ? JSON.stringify(chart.spec, null, 2) : '')

  // Parsing the override is a derivation, not a side effect - doing it in an
  // effect would mean a render pass just to report a syntax error.
  const rendered = useMemo((): { spec: object | null; error: string | null } => {
    if (override === null) return { spec: chart?.spec ?? null, error: null }
    try {
      return { spec: JSON.parse(override) as object, error: null }
    } catch (e) {
      return { spec: null, error: (e as Error).message }
    }
  }, [override, chart])

  useEffect(() => {
    if (!rendered.spec || !host.current) return
    let disposed = false
    embed(host.current, rendered.spec as never, { actions: false, renderer: 'svg' })
      .then((result) => {
        if (disposed) return result.finalize()
        view.current = result.view
        setEmbedError(null)
      })
      .catch((e: Error) => setEmbedError(e.message))
    return () => { disposed = true }
  }, [rendered])

  const exportSvg = async () => {
    if (!view.current) return
    download(`${job ?? 'chart'}-${state.recipe}.svg`, new Blob([await view.current.toSVG()], { type: 'image/svg+xml' }))
  }

  const exportPng = async () => {
    if (!view.current) return
    const canvas = await view.current.toCanvas(2)
    canvas.toBlob((blob) => blob && download(`${job ?? 'chart'}-${state.recipe}.png`, blob))
  }

  const openFile = async (file: File) => {
    try {
      const exp = JSON.parse(await file.text()) as JobExport
      if (!Array.isArray(exp.rows)) throw new Error('not a Heval job export (no rows array)')
      setData(exp)
      setJob(exp.job ?? file.name.replace(/\.json$/, ''))
      setLoadError(null)
    } catch (e) {
      setLoadError(`${file.name}: ${(e as Error).message}`)
    }
  }

  const uses = USES[state.recipe]
  const entry = index.find((i) => i.job === job)

  const dimField = (key: 'x' | 'color' | 'facet' | 'row', label: string, allowNone: boolean) => (
    <div className="field" key={key}>
      <label htmlFor={`f-${key}`}>{label}</label>
      <select
        id={`f-${key}`}
        value={state[key]}
        onChange={(e) => {
          const value = e.target.value
          if (key === 'color' || key === 'facet') set(key, value as Dimension | 'none')
          else set(key, value as Dimension)
        }}
      >
        {allowNone && <option value="none">None</option>}
        {DIMENSIONS.map((d) => <option key={d} value={d}>{DIMENSION_LABEL[d]}</option>)}
      </select>
    </div>
  )

  const measureField = (key: 'measure' | 'xMeasure', label: string) => (
    <div className="field" key={key}>
      <label htmlFor={`f-${key}`}>{label}</label>
      <select id={`f-${key}`} value={state[key]} onChange={(e) => set(key, e.target.value as Measure)}>
        {MEASURES.map((m) => <option key={m} value={m}>{MEASURE_LABEL[m]}</option>)}
      </select>
    </div>
  )

  return (
    <div
      className={`studio${dragging ? ' dragging' : ''}`}
      onDragOver={(e) => { e.preventDefault(); setDragging(true) }}
      onDragLeave={() => setDragging(false)}
      onDrop={(e) => {
        e.preventDefault()
        setDragging(false)
        const file = e.dataTransfer.files[0]
        if (file) void openFile(file)
      }}
    >
      <aside className="side">
        <div className="brand">
          Chart studio
          <small>Harbor job output &rarr; Vega-Lite</small>
        </div>

        <div className="group">
          <h3>Job</h3>
          <div className="field">
            <label htmlFor="f-job">Export</label>
            <select id="f-job" value={job ?? ''} onChange={(e) => setJob(e.target.value)}>
              {!index.length && <option value="">No exports found</option>}
              {index.map((i) => <option key={i.job} value={i.job}>{i.job}</option>)}
            </select>
          </div>
          <p className="hint">
            {entry
              ? `${entry.trials} trials · ${entry.agents.join(', ')} · exported ${entry.generatedAt.slice(0, 10)}`
              : 'Drop a <job>.json export anywhere on this page, or pick a file.'}
          </p>
          <div className="row">
            <input
              ref={filePicker}
              type="file"
              accept="application/json"
              style={{ display: 'none' }}
              onChange={(e) => { const f = e.target.files?.[0]; if (f) void openFile(f) }}
            />
            <button type="button" onClick={() => filePicker.current?.click()}>Open file&hellip;</button>
          </div>
        </div>

        <div className="group">
          <h3>Form</h3>
          <div className="field">
            <label htmlFor="f-recipe">Recipe</label>
            <select
              id="f-recipe"
              value={state.recipe}
              onChange={(e) => {
                // Switching form resets only the fields that form reads, so a
                // recipe never inherits a nonsensical encoding from the last one.
                const recipe = e.target.value as Recipe
                setState((prev) => ({ ...prev, recipe, ...RECIPE_DEFAULTS[recipe] }))
                setOverride(null)
              }}
            >
              {RECIPES.map((r) => <option key={r} value={r}>{RECIPE_LABEL[r]}</option>)}
            </select>
          </div>
          {uses.has('x') && dimField('x', state.recipe === 'matrix' ? 'Columns' : 'Group by', false)}
          {uses.has('row') && dimField('row', 'Rows', false)}
          {uses.has('color') && dimField('color', 'Color', true)}
          {uses.has('facet') && dimField('facet', 'Facet', true)}
        </div>

        <div className="group">
          <h3>Measure</h3>
          {uses.has('measure') && measureField('measure', state.recipe === 'scatter' ? 'Y (quality)' : 'Value')}
          {uses.has('xMeasure') && measureField('xMeasure', 'X (cost)')}
          {uses.has('aggregate') && (
            <div className="field">
              <label htmlFor="f-agg">Aggregate</label>
              <select id="f-agg" value={state.aggregate} onChange={(e) => set('aggregate', e.target.value as Aggregate)}>
                {AGGREGATES.map((a) => <option key={a} value={a}>{a}</option>)}
              </select>
            </div>
          )}
          {uses.has('sort') && (
            <div className="field">
              <label htmlFor="f-sort">Sort</label>
              <select id="f-sort" value={state.sort} onChange={(e) => set('sort', e.target.value as SortOrder)}>
                {SORTS.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
              </select>
            </div>
          )}
        </div>

        <div className="group">
          <h3>Presentation</h3>
          <div className="checks">
            {uses.has('labels') && (
              <label className="check">
                <input type="checkbox" checked={state.labels} onChange={(e) => set('labels', e.target.checked)} />
                Value labels
              </label>
            )}
            {uses.has('intervals') && (
              <label className="check">
                <input type="checkbox" checked={state.intervals} onChange={(e) => set('intervals', e.target.checked)} />
                95% intervals
              </label>
            )}
            <label className="check">
              <input
                type="checkbox"
                checked={state.theme === 'dark'}
                onChange={(e) => set('theme', e.target.checked ? 'dark' : 'light')}
              />
              Dark mode
            </label>
          </div>
          <div className="field">
            <label htmlFor="f-title">Title</label>
            <input id="f-title" type="text" value={state.title} placeholder="optional" onChange={(e) => set('title', e.target.value)} />
          </div>
          <div className="field">
            <label htmlFor="f-sub">Subtitle</label>
            <input id="f-sub" type="text" value={state.subtitle} placeholder="optional" onChange={(e) => set('subtitle', e.target.value)} />
          </div>
        </div>

        <div className="group">
          <h3>Export</h3>
          <div className="row">
            <button type="button" onClick={() => void exportSvg()} disabled={!chart}>SVG</button>
            <button type="button" onClick={() => void exportPng()} disabled={!chart}>PNG @2x</button>
            <button
              type="button"
              onClick={() => void navigator.clipboard?.writeText(window.location.href)}
              disabled={!chart}
            >
              Copy link
            </button>
          </div>
          <p className="hint">SVG is the canonical export; the static report embeds the same geometry.</p>
        </div>

        <div className="group">
          <button type="button" onClick={() => { setState({ ...DEFAULT_STATE, theme: state.theme }); setOverride(null) }}>
            Reset controls
          </button>
        </div>
      </aside>

      <main className="main">
        <div className="head">
          <h1>{job ?? 'No job loaded'}</h1>
          <span className="meta">
            {data ? `${data.rows.length} trials · ${Object.entries(data.agentVersions).map(([a, v]) => `${a} ${v.join('/')}`).join(', ') || 'versions not recorded'}` : ''}
          </span>
        </div>

        {loadError && <div className="warn err">{loadError}</div>}
        {chart?.warnings.map((w) => <div className="warn" key={w}>{w}</div>)}
        {(rendered.error ?? embedError) && <div className="warn err">Spec error: {rendered.error ?? embedError}</div>}

        <div className="tabs" role="tablist">
          {(['chart', 'table', 'spec', 'rows'] as Tab[]).map((t) => (
            <button
              key={t}
              type="button"
              role="tab"
              className="tab"
              aria-selected={tab === t}
              onClick={() => setTab(t)}
            >
              {t === 'chart' ? 'Chart' : t === 'table' ? 'Table view' : t === 'spec' ? 'Vega-Lite spec' : 'Raw trials'}
            </button>
          ))}
        </div>

        {/* The chart host stays mounted across tabs: re-embedding on every tab
            switch would throw away the Vega view the exporters need. */}
        <div className="card" style={{ display: tab === 'chart' ? 'block' : 'none' }}>
          {!data && !loadError ? <div className="drop">Loading…</div> : <div ref={host} />}
        </div>

        {tab === 'table' && chart && (
          <div className="card">
            <table>
              <thead>
                <tr>{chart.columns.map((c) => <th key={c} className={NUMERIC.has(c) ? 'num' : undefined}>{columnLabel(c, state.measure, state.xMeasure)}</th>)}</tr>
              </thead>
              <tbody>
                {chart.table.map((r, i) => (
                  <tr key={i}>
                    {chart.columns.map((c) => (
                      <td key={c} className={NUMERIC.has(c) ? 'num' : undefined}>{cellText(r[c], c, state.measure, state.xMeasure)}</td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {tab === 'spec' && (
          <div className="card">
            <div className="row" style={{ marginBottom: 10 }}>
              <button type="button" onClick={() => setOverride(null)} disabled={override === null}>
                Revert to controls
              </button>
              <button
                type="button"
                onClick={() => void navigator.clipboard?.writeText(specText)}
              >
                Copy spec
              </button>
              <span className="hint">
                {override === null ? 'Generated from the controls.' : 'Edited - the controls no longer drive this chart.'}
              </span>
            </div>
            <textarea
              className="spec"
              spellCheck={false}
              value={specText}
              onChange={(e) => setOverride(e.target.value)}
            />
          </div>
        )}

        {tab === 'rows' && data && (
          <div className="card">
            <table>
              <thead>
                <tr>
                  <th>Trial</th><th>Task</th><th>Harness</th><th>Model</th>
                  <th className="num">Reward</th><th className="num">Agent time</th>
                  <th className="num">Input</th><th className="num">Cache</th><th className="num">Output</th>
                  <th className="num">Cost</th><th>Error</th>
                </tr>
              </thead>
              <tbody>
                {data.rows.map((r) => (
                  <tr key={r.trial}>
                    <td>{r.trial}</td><td>{r.task}</td><td>{r.agent}</td><td>{r.modelShort}</td>
                    <td className="num">{formatValue(r.reward, 'reward')}</td>
                    <td className="num">{formatValue(r.agentSeconds, 'agentSeconds')}</td>
                    <td className="num">{formatValue(r.inputTokens, 'inputTokens')}</td>
                    <td className="num">{formatValue(r.cacheTokens, 'cacheTokens')}</td>
                    <td className="num">{formatValue(r.outputTokens, 'outputTokens')}</td>
                    <td className="num">{formatValue(r.costUsd, 'costUsd')}</td>
                    <td>{r.error ?? ''}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </main>
    </div>
  )
}

// -- table helpers -----------------------------------------------------------

const NUMERIC = new Set(['value', 'xValue', 'n', 'lo', 'hi'])

function columnLabel(c: string, measure: Measure, xMeasure: Measure): string {
  if (c === 'value') return MEASURE_LABEL[measure]
  if (c === 'xValue') return MEASURE_LABEL[xMeasure]
  if (c === 'n') return 'Trials'
  if (c === 'lo') return '95% low'
  if (c === 'hi') return '95% high'
  if (c === 'frontier') return 'On frontier'
  return DIMENSION_LABEL[c as Dimension] ?? c
}

function cellText(v: unknown, c: string, measure: Measure, xMeasure: Measure): string {
  if (v === null || v === undefined) return '-'
  if (c === 'value' || c === 'lo' || c === 'hi') return formatValue(v as number, measure)
  if (c === 'xValue') return formatValue(v as number, xMeasure)
  if (typeof v === 'boolean') return v ? 'yes' : ''
  return String(v)
}
