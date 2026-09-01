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
 *
 * Around the chart the page is a trace viewer for the job: stat tiles over the
 * loaded trials, filter chips that narrow every view at once, and a trial list
 * with a detail drawer, so the number on a bar can be walked back to the runs
 * that produced it without leaving the page.
 */

import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react'
import {
  Activity,
  AlertTriangle,
  ArrowUpDown,
  BarChart3,
  Braces,
  Check,
  ChevronDown,
  ChevronRight,
  Clock3,
  Coins,
  Copy,
  Cpu,
  Download,
  ExternalLink,
  FileJson,
  Filter,
  FolderOpen,
  Hash,
  Image as ImageIcon,
  Layers,
  Link2,
  ListFilter,
  Moon,
  Palette,
  RotateCcw,
  Rows3,
  Ruler,
  SlidersHorizontal,
  Sun,
  Table2,
  X,
} from 'lucide-react'
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
  type TrialRow,
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

/**
 * Harness identity as the landing page draws it (src/data.ts). Unknown
 * harnesses get initials in a neutral tone rather than a made-up brand color.
 */
const HARNESS: Record<string, { name: string; logo: string; color: string }> = {
  'claude-code': { name: 'Claude Code', logo: '/harnesses/claude.svg', color: '#e99572' },
  codex: { name: 'Codex CLI', logo: '/harnesses/codex.svg', color: '#79b8ff' },
  opencode: { name: 'OpenCode', logo: '/harnesses/opencode.svg', color: '#b9e769' },
  pi: { name: 'Pi Agent', logo: '/harnesses/pi.svg', color: '#c69cff' },
  'pi-agent': { name: 'Pi Agent', logo: '/harnesses/pi.svg', color: '#c69cff' },
}

type Tab = 'chart' | 'table' | 'spec' | 'rows'

/** The three dimensions a person actually slices a job by. */
type FilterKey = 'agent' | 'modelShort' | 'task'
type Filters = Record<FilterKey, string[]>
const FILTER_KEYS: FilterKey[] = ['agent', 'modelShort', 'task']
const FILTER_PARAM: Record<FilterKey, string> = { agent: 'agent', modelShort: 'model', task: 'task' }
const NO_FILTERS: Filters = { agent: [], modelShort: [], task: [] }

type RunSort = { key: 'passed' | 'agent' | 'modelShort' | 'task' | 'agentSeconds' | 'totalTokens' | 'costUsd'; dir: 1 | -1 }

function download(name: string, blob: Blob) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = name
  a.click()
  URL.revokeObjectURL(url)
}

function readFilters(search: string): Filters {
  const params = new URLSearchParams(search)
  const out: Filters = { ...NO_FILTERS }
  for (const k of FILTER_KEYS) {
    const v = params.get(FILTER_PARAM[k])
    out[k] = v ? v.split(',').filter(Boolean) : []
  }
  return out
}

const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null)
const median = (xs: number[]) => {
  if (!xs.length) return null
  const s = [...xs].sort((a, b) => a - b)
  const m = Math.floor(s.length / 2)
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2
}
const nums = (rows: TrialRow[], key: 'agentSeconds' | 'totalSeconds' | 'costUsd' | 'totalTokens' | 'inputTokens' | 'cacheTokens' | 'outputTokens') =>
  rows.map((r) => r[key]).filter((v): v is number => typeof v === 'number')

const fmtTokens = (n: number | null | undefined) =>
  n === null || n === undefined ? '-' : n >= 1e6 ? `${(n / 1e6).toFixed(2)}M` : n >= 1e3 ? `${(n / 1e3).toFixed(n >= 1e5 ? 0 : 1)}k` : String(n)
const fmtSeconds = (s: number | null | undefined) =>
  s === null || s === undefined ? '-' : s >= 60 ? `${Math.floor(s / 60)}m ${Math.round(s % 60)}s` : `${s.toFixed(s < 10 ? 1 : 0)}s`
const fmtCost = (c: number | null | undefined) => (c === null || c === undefined ? '-' : `$${c.toFixed(c < 1 ? 3 : 2)}`)
const pct = (n: number) => `${Math.round(n * 100)}%`

/** Cache is a subset of input in the provider accounting, so split it out. */
function tokenSplit(r: TrialRow): { fresh: number; cache: number; out: number; total: number } | null {
  if (r.inputTokens === null && r.outputTokens === null) return null
  const input = r.inputTokens ?? 0
  const cache = Math.min(r.cacheTokens ?? 0, input)
  const out = r.outputTokens ?? 0
  return { fresh: input - cache, cache, out, total: input + out }
}

export function Studio() {
  const initial = useMemo(() => readUrl(window.location.search), [])
  const [state, setState] = useState<ChartState>(initial.state)
  const [filters, setFilters] = useState<Filters>(() => readFilters(window.location.search))
  const [index, setIndex] = useState<JobIndexEntry[]>([])
  const [job, setJob] = useState<string | null>(initial.job)
  const [data, setData] = useState<JobExport | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [tab, setTab] = useState<Tab>('chart')
  const [override, setOverride] = useState<string | null>(null)
  const [embedError, setEmbedError] = useState<string | null>(null)
  const [dragging, setDragging] = useState(false)
  const [selected, setSelected] = useState<string | null>(null)
  const [copied, setCopied] = useState<string | null>(null)
  const [runSort, setRunSort] = useState<RunSort>({ key: 'agent', dir: 1 })

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
        setSelected(null)
      })
      .catch((e: Error) => live && setLoadError(`Could not load ${job}.json (${e.message}). Run bun run report <job-dir> first, or open an export.`))
    return () => { live = false }
  }, [job])

  // -- url + theme -----------------------------------------------------------

  useEffect(() => {
    const extra: Record<string, string> = job ? { job } : {}
    for (const k of FILTER_KEYS) if (filters[k].length) extra[FILTER_PARAM[k]] = filters[k].join(',')
    const params = paramsFromState(state, extra)
    window.history.replaceState(null, '', `${window.location.pathname}?${params.toString()}`)
    document.documentElement.dataset.theme = state.theme
  }, [state, job, filters])

  useEffect(() => {
    if (!copied) return
    const t = setTimeout(() => setCopied(null), 1400)
    return () => clearTimeout(t)
  }, [copied])

  useEffect(() => {
    if (!selected) return
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setSelected(null) }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [selected])

  // -- rows + chart -----------------------------------------------------------

  const allRows = useMemo(() => data?.rows ?? [], [data])
  const rows = useMemo(
    () => allRows.filter((r) => FILTER_KEYS.every((k) => !filters[k].length || filters[k].includes(String(r[k])))),
    [allRows, filters],
  )
  const filtering = FILTER_KEYS.some((k) => filters[k].length > 0)

  const chart = useMemo(() => (data && rows.length ? buildChart(rows, state) : null), [data, rows, state])

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

  const copy = (what: string, text: string) => {
    void navigator.clipboard?.writeText(text)
    setCopied(what)
  }

  const openFile = async (file: File) => {
    try {
      const exp = JSON.parse(await file.text()) as JobExport
      if (!Array.isArray(exp.rows)) throw new Error('not a Heval job export (no rows array)')
      setData(exp)
      setJob(exp.job ?? file.name.replace(/\.json$/, ''))
      setLoadError(null)
      setSelected(null)
    } catch (e) {
      setLoadError(`${file.name}: ${(e as Error).message}`)
    }
  }

  const toggleFilter = (key: FilterKey, value: string) =>
    setFilters((f) => ({ ...f, [key]: f[key].includes(value) ? f[key].filter((v) => v !== value) : [...f[key], value] }))

  const uses = USES[state.recipe]
  const entry = index.find((i) => i.job === job)
  const selectedRow = selected ? allRows.find((r) => r.trial === selected) ?? null : null

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

  const versions = data ? Object.entries(data.agentVersions).map(([a, v]) => `${a} ${v.join('/')}`).join(' · ') : ''

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
      <header className="topbar">
        <a className="brand" href="/" aria-label="Heval home">
          <span className="brand-mark"><span>H</span></span>
          <span className="brand-name">Heval</span>
          <span className="beta-pill">CHART STUDIO</span>
        </a>

        <div className="crumbs">
          <ChevronRight size={14} />
          <span>jobs</span>
          <ChevronRight size={14} />
          <div className="job-select">
            <select id="f-job" aria-label="Job export" value={job ?? ''} disabled={!index.length} onChange={(e) => setJob(e.target.value)}>
              {!index.length && <option value="">{job ?? 'No exports found'}</option>}
              {index.map((i) => <option key={i.job} value={i.job}>{i.job}</option>)}
            </select>
          </div>
        </div>

        <div className="actions">
          <input
            ref={filePicker}
            type="file"
            accept="application/json"
            style={{ display: 'none' }}
            onChange={(e) => { const f = e.target.files?.[0]; if (f) void openFile(f) }}
          />
          <button type="button" className="btn ghost" onClick={() => filePicker.current?.click()}>
            <FolderOpen size={14} /><span className="label-text">Open export</span>
          </button>
          <span className="divider" />
          <button type="button" className="btn" onClick={() => void exportSvg()} disabled={!chart}><Download size={14} />SVG</button>
          <button type="button" className="btn" onClick={() => void exportPng()} disabled={!chart}><ImageIcon size={14} />PNG @2x</button>
          <button type="button" className="btn primary" onClick={() => copy('link', window.location.href)} disabled={!chart}>
            {copied === 'link' ? <Check size={14} /> : <Link2 size={14} />}{copied === 'link' ? 'Copied' : 'Copy link'}
          </button>
        </div>
      </header>

      <div className="workspace">
        <aside className="side">
          <div className="group">
            <div className="group-head">
              <span className="eyebrow"><SlidersHorizontal size={11} />Form</span>
            </div>
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
            <p className="hint">
              {state.recipe === 'matrix'
                ? 'One hue, light to dark: the matrix encodes magnitude, not category.'
                : 'Color is capped at four series - the palette validates no further. Facet past that.'}
            </p>
          </div>

          <div className="group">
            <div className="group-head">
              <span className="eyebrow"><Ruler size={11} />Measure</span>
            </div>
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
            <div className="group-head">
              <span className="eyebrow"><Palette size={11} />Presentation</span>
            </div>
            <div className="checks">
              {uses.has('labels') && (
                <label className="check">
                  <input type="checkbox" checked={state.labels} onChange={(e) => set('labels', e.target.checked)} />
                  Value labels
                  <small>direct</small>
                </label>
              )}
              {uses.has('intervals') && (
                <label className="check">
                  <input type="checkbox" checked={state.intervals} onChange={(e) => set('intervals', e.target.checked)} />
                  95% intervals
                  <small>wilson</small>
                </label>
              )}
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
            <div className="group-head">
              <span className="eyebrow"><FileJson size={11} />Source</span>
            </div>
            <p className="hint">
              {entry
                ? <>{entry.trials} trials · exported {entry.generatedAt.slice(0, 10)}<br />{entry.agents.join(', ')}</>
                : 'Drop a <job>.json export anywhere on this page, or open one from the top bar.'}
            </p>
            {data?.source && <p className="hint"><code>{data.source}</code></p>}
            <div className="row">
              {job && index.some((i) => i.job === job) && (
                <a className="btn sm" href={`${RESULTS}/${job}.html`} target="_blank" rel="noreferrer">
                  <ExternalLink size={12} />Static report
                </a>
              )}
              <button
                type="button"
                className="btn sm ghost"
                onClick={() => { setState({ ...DEFAULT_STATE, theme: state.theme }); setOverride(null); setFilters(NO_FILTERS) }}
              >
                <RotateCcw size={12} />Reset
              </button>
            </div>
          </div>
        </aside>

        <main className="main">
          <div className="head">
            <div>
              <span className="eyebrow">Harbor job</span>
              <h1>{job ?? 'No job loaded'}</h1>
              {data && (
                <div className="meta">
                  <span><Rows3 size={12} />{allRows.length} trials{filtering ? ` · ${rows.length} shown` : ''}</span>
                  <span><Cpu size={12} />{versions || 'versions not recorded'}</span>
                  {data.jobId && <span><Hash size={12} /><code>{data.jobId.slice(0, 8)}</code></span>}
                  <span><Clock3 size={12} />exported {data.generatedAt.slice(0, 10)}</span>
                </div>
              )}
            </div>
          </div>

          {data && <StatTiles rows={rows} />}

          {data && (
            <FilterBar
              rows={allRows}
              filters={filters}
              onToggle={toggleFilter}
              onClear={() => setFilters(NO_FILTERS)}
            />
          )}

          {(loadError || chart?.warnings.length || rendered.error || embedError || (data && !rows.length)) ? (
            <div className="notes">
              {loadError && <div className="warn err"><AlertTriangle size={14} /><span>{loadError}</span></div>}
              {data && !rows.length && <div className="warn"><Filter size={14} /><span>The active filters exclude every trial. Clear one to draw a chart.</span></div>}
              {chart?.warnings.map((w) => <div className="warn" key={w}><AlertTriangle size={14} /><span>{w}</span></div>)}
              {(rendered.error ?? embedError) && <div className="warn err"><AlertTriangle size={14} /><span>Spec error: {rendered.error ?? embedError}</span></div>}
            </div>
          ) : null}

          <div className="tabbar">
            <div className="tabs" role="tablist">
              {([
                ['chart', 'Chart', <BarChart3 size={13} key="i" />, null],
                ['table', 'Table view', <Table2 size={13} key="i" />, chart ? chart.table.length : null],
                ['spec', 'Vega-Lite spec', <Braces size={13} key="i" />, null],
                ['rows', 'Raw trials', <Activity size={13} key="i" />, data ? rows.length : null],
              ] as [Tab, string, ReactNode, number | null][]).map(([t, label, icon, count]) => (
                <button key={t} type="button" role="tab" className="tab" aria-selected={tab === t} onClick={() => setTab(t)}>
                  {icon}{label}{count !== null && <small>{count}</small>}
                </button>
              ))}
            </div>
            <span className="spacer" />
            {/* Switches the canvas between the two validated chart surfaces; the
                chrome around it stays the product's dark. */}
            <div className="canvas-toggle" role="radiogroup" aria-label="Chart canvas">
              <label className="canvas-btn">
                <input type="radio" name="canvas" className="sr-only" checked={state.theme === 'dark'} onChange={() => set('theme', 'dark')} />
                <Moon size={11} />Dark mode
              </label>
              <label className="canvas-btn">
                <input type="radio" name="canvas" className="sr-only" checked={state.theme === 'light'} onChange={() => set('theme', 'light')} />
                <Sun size={11} />Light mode
              </label>
            </div>
          </div>

          {/* The chart host stays mounted across tabs: re-embedding on every tab
              switch would throw away the Vega view the exporters need. */}
          <div className="card" style={{ display: tab === 'chart' ? 'block' : 'none' }}>
            <div className="card-head">
              <div className="window-dots"><span /><span /><span /></div>
              <div className="title">
                <span>{RECIPE_LABEL[state.recipe]}</span>
                <small>{state.recipe} · {rows.length} trials · {state.theme === 'dark' ? 'surface #101111' : 'surface #ffffff'}</small>
              </div>
              <div className="right">
                <small>{chart ? `${chart.table.length} plotted groups` : ''}</small>
              </div>
            </div>
            <div className="canvas" data-canvas={state.theme}>
              {!data && !loadError ? (
                <div className="placeholder"><div><strong>Loading export</strong><p>Reading {job ?? 'the job index'} from {RESULTS}.</p></div></div>
              ) : !chart ? (
                <div className="placeholder">
                  <div>
                    <strong>Nothing to draw</strong>
                    <p>{loadError ? 'Load a job export to start.' : 'Every trial is filtered out.'}</p>
                  </div>
                </div>
              ) : null}
              <div ref={host} />
            </div>
          </div>

          {tab === 'table' && chart && (
            <div className="panel">
              <div className="card-head">
                <div className="title"><Table2 size={13} /><span>Plotted numbers</span><small>what the marks encode, after aggregation</small></div>
              </div>
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
            <div className="panel">
              <div className="card-head">
                <div className="title"><Braces size={13} /><span>Vega-Lite</span>
                  <small>{override === null ? 'generated from the controls' : 'edited - the controls no longer drive this chart'}</small>
                </div>
                <div className="right">
                  <button type="button" className="btn sm" onClick={() => setOverride(null)} disabled={override === null}>
                    <RotateCcw size={12} />Revert to controls
                  </button>
                  <button type="button" className="btn sm" onClick={() => copy('spec', specText)}>
                    {copied === 'spec' ? <Check size={12} /> : <Copy size={12} />}{copied === 'spec' ? 'Copied' : 'Copy spec'}
                  </button>
                </div>
              </div>
              <textarea className="spec" spellCheck={false} value={specText} onChange={(e) => setOverride(e.target.value)} />
            </div>
          )}

          {tab === 'rows' && data && (
            <RunList
              rows={rows}
              sort={runSort}
              onSort={(key) => setRunSort((s) => ({ key, dir: s.key === key ? (s.dir === 1 ? -1 : 1) : key === 'agent' || key === 'modelShort' || key === 'task' ? 1 : -1 }))}
              selected={selected}
              onSelect={(id) => setSelected((cur) => (cur === id ? null : id))}
            />
          )}
        </main>
      </div>

      {selectedRow && (
        <RunDrawer
          row={selectedRow}
          onClose={() => setSelected(null)}
          onFocus={() => { setFilters({ agent: [selectedRow.agent], modelShort: [selectedRow.modelShort], task: [] }); setTab('chart') }}
          onCopy={() => copy('trial', selectedRow.trial)}
          copied={copied === 'trial'}
        />
      )}
    </div>
  )
}

// -- stat tiles -------------------------------------------------------------

function StatTiles({ rows }: { rows: TrialRow[] }) {
  const n = rows.length
  const passed = rows.filter((r) => r.passed).length
  const rate = n ? passed / n : 0
  const stacks = new Set(rows.map((r) => r.stack)).size
  const tasks = new Set(rows.map((r) => r.task)).size
  const agentT = nums(rows, 'agentSeconds')
  const costs = nums(rows, 'costUsd')
  const tokens = nums(rows, 'totalTokens')
  const fresh = rows.reduce((a, r) => a + Math.max(0, (r.inputTokens ?? 0) - Math.min(r.cacheTokens ?? 0, r.inputTokens ?? 0)), 0)
  const cache = rows.reduce((a, r) => a + Math.min(r.cacheTokens ?? 0, r.inputTokens ?? 0), 0)
  const out = rows.reduce((a, r) => a + (r.outputTokens ?? 0), 0)
  const tokTotal = fresh + cache + out || 1

  return (
    <div className="stats">
      <div className="stat">
        <div className="stat-head"><span className="eyebrow">Pass rate</span><Activity size={14} /></div>
        <strong>{n ? pct(rate) : '-'}</strong>
        <small>{passed} of {n} trials passed</small>
        <div className="bar"><i style={{ width: `${rate * 100}%` }} /></div>
      </div>
      <div className="stat">
        <div className="stat-head"><span className="eyebrow">Trials</span><Layers size={14} /></div>
        <strong>{n}</strong>
        <small>{stacks} {stacks === 1 ? 'stack' : 'stacks'} · {tasks} {tasks === 1 ? 'task' : 'tasks'}</small>
        <div className="split">
          <i style={{ width: `${(passed / (n || 1)) * 100}%`, background: 'var(--pass)' }} />
          <i style={{ width: `${((n - passed) / (n || 1)) * 100}%`, background: 'var(--fail)' }} />
        </div>
      </div>
      <div className="stat">
        <div className="stat-head"><span className="eyebrow">Agent time</span><Clock3 size={14} /></div>
        <strong>{fmtSeconds(mean(agentT))}<small>mean</small></strong>
        <small>median {fmtSeconds(median(agentT))} · agent step only</small>
      </div>
      <div className="stat">
        <div className="stat-head"><span className="eyebrow">Cost</span><Coins size={14} /></div>
        <strong>{fmtCost(mean(costs))}<small>/ trial</small></strong>
        <small>
          {costs.length ? `${fmtCost(costs.reduce((a, b) => a + b, 0))} total` : 'not exposed by the gateway'}
          {costs.length && costs.length < n ? ` · ${n - costs.length} unpriced` : ''}
        </small>
      </div>
      <div className="stat">
        <div className="stat-head"><span className="eyebrow">Tokens</span><Cpu size={14} /></div>
        <strong>{fmtTokens(tokens.length ? tokens.reduce((a, b) => a + b, 0) : null)}</strong>
        <small>{tokens.length ? `${fmtTokens(mean(tokens))} per trial · ${pct(cache / tokTotal)} cache hits` : 'not reported'}</small>
        <div className="split">
          <i className="tok-in" style={{ width: `${(fresh / tokTotal) * 100}%` }} />
          <i className="tok-cache" style={{ width: `${(cache / tokTotal) * 100}%` }} />
          <i className="tok-out" style={{ width: `${(out / tokTotal) * 100}%` }} />
        </div>
      </div>
    </div>
  )
}

// -- filters -------------------------------------------------------------------

const FILTER_LABEL: Record<FilterKey, string> = { agent: 'Harness', modelShort: 'Model', task: 'Task' }

function FilterBar({ rows, filters, onToggle, onClear }: {
  rows: TrialRow[]
  filters: Filters
  onToggle: (key: FilterKey, value: string) => void
  onClear: () => void
}) {
  const [open, setOpen] = useState<FilterKey | null>(null)
  const wrap = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => { if (!wrap.current?.contains(e.target as Node)) setOpen(null) }
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(null) }
    window.addEventListener('mousedown', onDown)
    window.addEventListener('keydown', onKey)
    return () => { window.removeEventListener('mousedown', onDown); window.removeEventListener('keydown', onKey) }
  }, [open])

  const counts = (key: FilterKey) => {
    const m = new Map<string, number>()
    for (const r of rows) m.set(String(r[key]), (m.get(String(r[key])) ?? 0) + 1)
    return [...m.entries()].sort((a, b) => a[0].localeCompare(b[0]))
  }
  const active = FILTER_KEYS.some((k) => filters[k].length > 0)

  return (
    <div className="filters" ref={wrap}>
      <span className="eyebrow label"><ListFilter size={11} />Filter</span>
      {FILTER_KEYS.map((key) => {
        const on = filters[key].length > 0
        return (
          <div className="filter-menu" key={key}>
            <button
              type="button"
              className={`chip${on ? ' on' : ''}`}
              aria-expanded={open === key}
              aria-haspopup="menu"
              onClick={() => setOpen((o) => (o === key ? null : key))}
            >
              {FILTER_LABEL[key]}
              {on ? <small>{filters[key].length === 1 ? filters[key][0] : `${filters[key].length} selected`}</small> : <small>all</small>}
              <ChevronDown size={12} />
            </button>
            {open === key && (
              <div className="menu" role="menu">
                {counts(key).map(([value, n]) => (
                  <button
                    key={value}
                    type="button"
                    role="menuitemcheckbox"
                    aria-checked={filters[key].includes(value)}
                    onClick={() => onToggle(key, value)}
                  >
                    <span>{value}</span>
                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}><small>{n}</small><Check size={13} /></span>
                  </button>
                ))}
              </div>
            )}
          </div>
        )
      })}
      {active && (
        <button type="button" className="btn ghost sm" onClick={onClear}><X size={12} />Clear</button>
      )}
    </div>
  )
}

// -- trial list (trace viewer) ------------------------------------------------

function Avatar({ agent }: { agent: string }) {
  const h = HARNESS[agent]
  const style = { '--runner-color': h?.color ?? '#8d9290' } as CSSProperties
  return (
    <span className="avatar" style={style} aria-hidden="true">
      {h ? <img src={h.logo} alt="" /> : agent.slice(0, 2).toUpperCase()}
    </span>
  )
}

function TokenBar({ row, max, thick }: { row: TrialRow; max: number; thick?: boolean }) {
  const t = tokenSplit(row)
  if (!t) return <small>-</small>
  const w = (n: number) => `${(n / (max || 1)) * 100}%`
  return (
    <div className="split" style={thick ? { height: 6 } : undefined} title={`${fmtTokens(t.fresh)} fresh · ${fmtTokens(t.cache)} cache · ${fmtTokens(t.out)} out`}>
      <i className="tok-in" style={{ width: w(t.fresh) }} />
      <i className="tok-cache" style={{ width: w(t.cache) }} />
      <i className="tok-out" style={{ width: w(t.out) }} />
    </div>
  )
}

function RunList({ rows, sort, onSort, selected, onSelect }: {
  rows: TrialRow[]
  sort: RunSort
  onSort: (key: RunSort['key']) => void
  selected: string | null
  onSelect: (id: string) => void
}) {
  const max = Math.max(1, ...rows.map((r) => tokenSplit(r)?.total ?? 0))
  const sorted = useMemo(() => {
    const val = (r: TrialRow) => r[sort.key]
    return [...rows].sort((a, b) => {
      const x = val(a), y = val(b)
      if (x === y) return a.trial.localeCompare(b.trial)
      if (x === null || x === undefined) return 1
      if (y === null || y === undefined) return -1
      return (typeof x === 'number' && typeof y === 'number' ? x - y : String(x).localeCompare(String(y))) * sort.dir
    })
  }, [rows, sort])

  const th = (key: RunSort['key'], label: string, cls = '') => (
    <th className={cls}>
      <button type="button" className={sort.key === key ? 'on' : ''} onClick={() => onSort(key)}>
        {label}<ArrowUpDown size={9} />
      </button>
    </th>
  )

  return (
    <div className="panel">
      <div className="card-head">
        <div className="title"><Activity size={13} /><span>Trials</span><small>{rows.length} runs · click a row for the trace detail</small></div>
        <div className="right"><small>tokens: fresh / cache / output</small></div>
      </div>
      {rows.length ? (
        <table className="runs">
          <thead>
            <tr className="run-head">
              <th colSpan={2}>
                <button type="button" className={sort.key === 'passed' ? 'on' : ''} onClick={() => onSort('passed')}>
                  Result<ArrowUpDown size={9} />
                </button>
              </th>
              {th('agent', 'Harness')}
              {th('modelShort', 'Model', 'hide-mobile')}
              {th('task', 'Task')}
              <th className="hide-narrow">Tokens</th>
              {th('agentSeconds', 'Agent', 'num hide-mobile')}
              {th('costUsd', 'Cost', 'num')}
              <th />
            </tr>
          </thead>
          <tbody>
            {sorted.map((r) => {
              const h = HARNESS[r.agent]
              const t = tokenSplit(r)
              return (
                <tr
                  key={r.trial}
                  className="run-row"
                  aria-selected={selected === r.trial}
                  tabIndex={0}
                  onClick={() => onSelect(r.trial)}
                  onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onSelect(r.trial) } }}
                >
                  <td><span className={`status ${r.passed ? 'pass' : 'fail'}`} title={r.passed ? 'passed' : 'failed'} /></td>
                  <td><Avatar agent={r.agent} /></td>
                  <td className="who">
                    <strong>{h?.name ?? r.agent}</strong>
                    <small>{r.agent}{r.agentVersion ? ` ${r.agentVersion}` : ''}</small>
                  </td>
                  <td className="what hide-mobile">
                    <strong>{r.modelShort}</strong>
                    <small>{r.provider ?? '-'}</small>
                  </td>
                  <td className="what">
                    <strong>{r.task}</strong>
                    <small>{r.taskFull ?? ''}</small>
                  </td>
                  <td className="tokens hide-narrow">
                    <TokenBar row={r} max={max} />
                    <small>{t ? `${fmtTokens(t.total)} · ${pct(t.total ? t.cache / t.total : 0)} cached` : 'not reported'}</small>
                  </td>
                  <td className="num hide-mobile">{fmtSeconds(r.agentSeconds)}</td>
                  <td className={`num${r.costUsd === null ? ' faint' : ''}`}>{fmtCost(r.costUsd)}</td>
                  <td className="chev"><ChevronRight size={14} /></td>
                </tr>
              )
            })}
          </tbody>
        </table>
      ) : (
        <div className="empty-runs">No trials match the active filters.</div>
      )}
    </div>
  )
}

function RunDrawer({ row, onClose, onFocus, onCopy, copied }: {
  row: TrialRow
  onClose: () => void
  onFocus: () => void
  onCopy: () => void
  copied: boolean
}) {
  const h = HARNESS[row.agent]
  const t = tokenSplit(row)
  const overhead = row.totalSeconds !== null && row.agentSeconds !== null ? row.totalSeconds - row.agentSeconds : null
  return (
    <aside className="drawer" role="dialog" aria-label={`Trial ${row.trial}`}>
      <div className="drawer-head">
        <Avatar agent={row.agent} />
        <div className="who">
          <strong>{h?.name ?? row.agent} · {row.modelShort}</strong>
          <small>{row.trial}</small>
        </div>
        <span className={`pill ${row.passed ? 'pass' : 'fail'}`}><i />{row.passed ? 'passed' : 'failed'}</span>
        <button type="button" className="btn icon ghost" aria-label="Close" onClick={onClose}><X size={14} /></button>
      </div>

      <div className="drawer-body">
        <div className="mini-stats">
          <div className="mini-stat"><span>Reward</span><strong>{formatValue(row.reward, 'reward')}</strong></div>
          <div className="mini-stat"><span>Agent</span><strong>{fmtSeconds(row.agentSeconds)}</strong></div>
          <div className="mini-stat"><span>Cost</span><strong>{fmtCost(row.costUsd)}</strong></div>
        </div>

        <section>
          <span className="eyebrow">Tokens</span>
          {t ? (
            <>
              <TokenBar row={row} max={t.total} thick />
              <div className="tok-legend">
                <span><i className="tok-in" />{fmtTokens(t.fresh)} fresh</span>
                <span><i className="tok-cache" />{fmtTokens(t.cache)} cache</span>
                <span><i className="tok-out" />{fmtTokens(t.out)} out</span>
              </div>
            </>
          ) : <p className="hint">The provider reported no token usage for this trial.</p>}
        </section>

        <section>
          <span className="eyebrow">Stack</span>
          <dl className="kv">
            <dt>Harness</dt><dd>{row.agent}{row.agentVersion ? <span className="dim"> · {row.agentVersion}</span> : null}</dd>
            <dt>Model</dt><dd className="mono">{row.model}</dd>
            <dt>Provider</dt><dd>{row.provider ?? '-'}</dd>
          </dl>
        </section>

        <section>
          <span className="eyebrow">Task</span>
          <dl className="kv">
            <dt>Task</dt><dd>{row.taskFull ?? row.task}</dd>
            <dt>Checksum</dt><dd className="mono">{row.taskChecksum ?? '-'}</dd>
          </dl>
        </section>

        <section>
          <span className="eyebrow">Timing</span>
          <dl className="kv">
            <dt>Agent step</dt><dd className="mono">{fmtSeconds(row.agentSeconds)}</dd>
            <dt>Total</dt><dd className="mono">{fmtSeconds(row.totalSeconds)}</dd>
            <dt>Overhead</dt><dd className="mono">{overhead !== null ? `${fmtSeconds(overhead)} build + verify` : '-'}</dd>
            <dt>Started</dt><dd className="mono">{row.startedAt ? row.startedAt.replace('T', ' ').slice(0, 19) : '-'}</dd>
          </dl>
        </section>

        {row.error && (
          <section>
            <span className="eyebrow">Error</span>
            <pre>{row.error}</pre>
          </section>
        )}
      </div>

      <div className="drawer-foot">
        <button type="button" className="btn sm" onClick={onFocus}><Filter size={12} />Focus this stack</button>
        <button type="button" className="btn sm ghost" onClick={onCopy}>{copied ? <Check size={12} /> : <Copy size={12} />}{copied ? 'Copied' : 'Copy trial id'}</button>
      </div>
    </aside>
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
