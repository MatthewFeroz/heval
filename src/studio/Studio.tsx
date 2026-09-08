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
 * round-trip back into the controls, and is stored with the analysis or presentation in project files.
 *
 * Around the chart the page is a trace viewer for the job: stat tiles over the
 * loaded trials, filter chips that narrow every view at once, and a trial list
 * with a detail drawer, so the number on a bar can be walked back to the runs
 * that produced it without leaving the page.
 */

import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode, type SetStateAction } from 'react'
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
  Film,
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
  Save,
  SlidersHorizontal,
  Sun,
  Table2,
  X,
} from 'lucide-react'
import { useChartPreview } from './useChartPreview'
import { useChartDocument } from './useChartDocument'
import { saveDocument, viewDocument } from '../project/editor'
import { MotionPreview } from './MotionPreview'
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
  DIMENSION_LABEL,
  MEASURE_LABEL,
  type Dimension,
  type JobExport,
  type JobIndex,
  type JobIndexEntry,
  type Measure,
  type TrialRow,
} from '../charts/trial'
import { compatibleSources, presentationChart, projectRows, projectFields, presentationAnalysis, snapshotPresentations } from '../project/accessors'
import {
  adaptJobExportV1,
  makeBundle,
  newPresentation,
  newProject,
  parseBundle,
  parseEvaluationArtifact,
  parseProject,
  sourceFromArtifact,
  verifyContentHash,
  type EvaluationArtifact,
  type HevalProject,
  type Presentation,
} from '../project/schema'
import { CANVAS_IDS, MOTION_CANVASES } from '../charts/motion-options'
import { MOTION_THEMES, THEME_IDS } from '../charts/motion-themes'

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

type Tab = 'chart' | 'motion' | 'table' | 'spec' | 'rows'
type StudioMode = 'analysis' | 'presentation'

/** The three dimensions a person actually slices a job by. */
type FilterKey = string
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
  try {
    const custom: unknown = JSON.parse(params.get('filters') ?? '{}')
    if (custom && typeof custom === 'object' && !Array.isArray(custom)) {
      for (const [key, values] of Object.entries(custom)) if (Array.isArray(values) && values.every((value) => typeof value === 'string')) out[key] = values
    }
  } catch { /* Ignore malformed optional URL filters. */ }
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
  const editor = useChartDocument({ chart: initial.state, filters: Object.entries(readFilters(window.location.search)).filter(([, values]) => values.length).map(([field, values]) => ({ field, values })), sourceIds: [], customSpec: null })
  const { setState, setSourceIds, setOverride: setAnalysisOverride, setDocumentFilters } = editor
  const { chart: state, sourceIds, customSpec: analysisOverride } = editor.document
  const filters = useMemo(() => {
    const result: Filters = { ...NO_FILTERS }
    for (const filter of editor.document.filters) result[filter.field] = filter.values
    return result
  }, [editor.document.filters])
  const setFilters = (action: SetStateAction<Filters>) => {
    const next = typeof action === 'function' ? action(filters) : action
    setDocumentFilters(Object.entries(next).filter(([, values]) => values.length).map(([field, values]) => ({ field, values })))
  }
  const [mode, setMode] = useState<StudioMode>(() => new URLSearchParams(window.location.search).get('mode') === 'presentation' ? 'presentation' : 'analysis')
  const [index, setIndex] = useState<JobIndexEntry[]>([])
  const [job, setJob] = useState<string | null>(initial.job)
  const [data, setData] = useState<JobExport | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [tab, setTab] = useState<Tab>('chart')
  const [specDraft, setSpecDraft] = useState<string | null>(null)
  const [dragging, setDragging] = useState(false)
  const [selected, setSelected] = useState<string | null>(null)
  const [copied, setCopied] = useState<string | null>(null)
  const [runSort, setRunSort] = useState<RunSort>({ key: 'agent', dir: 1 })
  const [project, setProject] = useState<HevalProject | null>(null)
  const [artifacts, setArtifacts] = useState<Map<string, EvaluationArtifact>>(() => new Map())
  const [activeViewId, setActiveViewId] = useState<string | null>(null)
  const [activePresentationId, setActivePresentationId] = useState<string | null>(null)

  const filePicker = useRef<HTMLInputElement>(null)
  const importedHashes = useRef(new Map<string, string>())

  const set = useCallback(<K extends keyof ChartState>(key: K, value: ChartState[K]) => {
    setState((prev) => ({ ...prev, [key]: value }))
  }, [setState])

  const addArtifact = useCallback(async (artifact: EvaluationArtifact, uri: string, replaceProject = false) => {
    if (!await verifyContentHash(artifact)) throw new Error(`Content hash mismatch for ${artifact.label}`)
    const priorHash = importedHashes.current.get(artifact.id)
    if (priorHash && priorHash !== artifact.contentHash) throw new Error(`Artifact ${artifact.id} already exists with different content. Give the new snapshot a distinct artifact id.`)
    importedHashes.current.set(artifact.id, artifact.contentHash)
    const source = await sourceFromArtifact(artifact, uri)
    setArtifacts((current) => new Map(current).set(artifact.id, artifact))
    setProject((current) => {
      if (!current || replaceProject) {
        const created = newProject(source, artifact)
        created.analysisViews[0].chart = { ...created.analysisViews[0].chart, ...initial.state }
        setActiveViewId(created.analysisViews[0].id)
        return created
      }
      const prior = current.sources.find((item) => item.artifactId === artifact.id && item.contentHash === artifact.contentHash)
      if (prior) return current
      return { ...current, sources: [...current.sources, source], updatedAt: new Date().toISOString() }
    })
    setSourceIds([source.id])
  }, [initial.state, setSourceIds])

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
      .then(async (exp: JobExport) => {
        if (!live) return
        const uri = `${RESULTS}/${job}.json`
        const artifact = await adaptJobExportV1(exp, uri)
        if (!live) return
        await addArtifact(artifact, uri)
        setData(exp)
        setLoadError(null)
        setSelected(null)
      })
      .catch((e: Error) => live && setLoadError(`Could not load ${job}.json (${e.message}). Run bun run report <job-dir> first, or open an export.`))
    return () => { live = false }
  }, [job, addArtifact])

  const activeView = useMemo(
    () => project?.analysisViews.find((viewItem) => viewItem.id === activeViewId) ?? project?.analysisViews[0] ?? null,
    [project, activeViewId],
  )
  const activePresentation = useMemo(
    () => project?.presentations.find((item) => item.id === activePresentationId) ?? project?.presentations[0] ?? null,
    [project, activePresentationId],
  )
  const presentationView = project && activePresentation ? presentationAnalysis(project, activePresentation) : null
  const override = mode === 'presentation' && activePresentation ? activePresentation.customSpec ?? null : analysisOverride
  const chartState = mode === 'presentation' && activePresentation
    ? presentationChart(presentationView?.chart, activePresentation.graphOverrides, activePresentation.narrative.title)
    : state

  const updatePresentation = useCallback((change: (current: Presentation) => Presentation) => {
    if (!activePresentation) return
    setProject((current) => current ? {
      ...current,
      updatedAt: new Date().toISOString(),
      presentations: current.presentations.map((item) => item.id === activePresentation.id ? change(item) : item),
    } : current)
  }, [activePresentation])

  const setOverride = (spec: string | null) => {
    if (mode === 'presentation') updatePresentation((current) => ({ ...current, customSpec: spec, updatedAt: new Date().toISOString() }))
    else setAnalysisOverride(spec)
  }

  const setChart = useCallback(<K extends keyof ChartState>(key: K, value: ChartState[K]) => {
    if (mode === 'analysis') set(key, value)
    else updatePresentation((current) => ({ ...current, graphOverrides: { ...current.graphOverrides, [key]: value }, updatedAt: new Date().toISOString() }))
  }, [mode, set, updatePresentation])

  const switchMode = (next: StudioMode) => {
    if (next === 'presentation' && (!project || !activeView)) return
    if (next === 'presentation' && project && activeView) {
      const saved = saveDocument(activeView, editor.document)
      const created = activePresentation ?? newPresentation(project, saved)
      setProject({ ...project, analysisViews: project.analysisViews.map((item) => item.id === activeView.id ? saved : item), presentations: activePresentation ? project.presentations : [...project.presentations, created], updatedAt: new Date().toISOString() })
      setActivePresentationId(created.id)
    }
    setMode(next)
    setTab('chart')
    setSpecDraft(null)
  }

  // -- url + theme -----------------------------------------------------------

  useEffect(() => {
    const extra: Record<string, string> = job ? { job } : {}
    if (mode === 'presentation') extra.mode = mode
    for (const k of FILTER_KEYS) if (filters[k].length) extra[FILTER_PARAM[k]] = filters[k].join(',')
    const extraFilters = Object.fromEntries(Object.entries(filters).filter(([key, values]) => !FILTER_KEYS.includes(key) && values.length))
    if (Object.keys(extraFilters).length) extra.filters = JSON.stringify(extraFilters)
    const params = paramsFromState(chartState, extra)
    window.history.replaceState(null, '', `${window.location.pathname}?${params.toString()}`)
    document.documentElement.dataset.theme = chartState.theme
  }, [chartState, job, filters, mode])

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

  const selectedSourceIds = mode === 'presentation' && presentationView ? presentationView.sourceIds : sourceIds
  const fields = useMemo(() => project ? projectFields(project, artifacts, selectedSourceIds) : [], [project, artifacts, selectedSourceIds])
  const compatibility = useMemo(() => {
    if (!project) return { sourceIds: [], incompatible: [] }
    const y = compatibleSources(project, artifacts, selectedSourceIds, chartState.measure)
    if (chartState.recipe !== 'scatter') return y
    const x = compatibleSources(project, artifacts, y.sourceIds, chartState.xMeasure)
    return { sourceIds: x.sourceIds, incompatible: [...new Set([...y.incompatible, ...x.incompatible])] }
  }, [project, artifacts, selectedSourceIds, chartState.measure, chartState.xMeasure, chartState.recipe])
  const allRows = useMemo(() => project ? projectRows(project, artifacts, compatibility.sourceIds) : [], [project, artifacts, compatibility.sourceIds])
  const visibleFilters = useMemo(() => {
    if (mode === 'analysis') return filters
    const saved: Filters = { ...NO_FILTERS }
    for (const filter of presentationView?.filters ?? []) {
      saved[filter.field] = filter.values
    }
    return saved
  }, [mode, filters, presentationView])
  const rows = useMemo(
    () => allRows.filter((r) => Object.entries(visibleFilters).every(([key, values]) => !values.length || values.includes(String(r[key])))),
    [allRows, visibleFilters],
  )
  const filtering = Object.values(visibleFilters).some((values) => values.length > 0)

  const chart = useMemo(() => {
    if (!project || !rows.length) return null
    const output = buildChart(rows, chartState, fields)
    if (mode === 'presentation' && activePresentation) {
      output.spec.usermeta = {
        ...(output.spec.usermeta as Record<string, unknown> | undefined),
        hevalPresentation: {
          id: activePresentation.id,
          revision: activePresentation.revision,
          snapshotPins: activePresentation.snapshotPins,
          renderer: activePresentation.renderer,
        },
      }
    }
    return output
  }, [project, rows, chartState, mode, activePresentation, fields])

  // The generated spec is the source of truth for the Spec tab until the user
  // edits it; after that their text wins so keystrokes are not overwritten.
  const specText = specDraft ?? override ?? (chart ? JSON.stringify(chart.spec, null, 2) : '')

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

  const { host, view, error: embedError, setError: setEmbedError } = useChartPreview(rendered.spec)

  const exportSvg = async () => {
    if (!view.current) return
    download(`${project?.label ?? job ?? 'chart'}-${chartState.recipe}.svg`, new Blob([await view.current.toSVG()], { type: 'image/svg+xml' }))
  }

  const exportPng = async () => {
    if (!view.current) return
    const canvas = await view.current.toCanvas(2)
    canvas.toBlob((blob) => blob && download(`${project?.label ?? job ?? 'chart'}-${chartState.recipe}.png`, blob))
  }

  const copy = (what: string, text: string) => {
    void navigator.clipboard?.writeText(text)
    setCopied(what)
  }

  const installProject = async (next: HevalProject, embedded: EvaluationArtifact[] = []) => {
    const loaded = new Map<string, EvaluationArtifact>()
    for (const artifact of embedded) {
      if (!await verifyContentHash(artifact)) throw new Error(`Content hash mismatch for ${artifact.label}`)
      if (loaded.has(artifact.id) && loaded.get(artifact.id)!.contentHash !== artifact.contentHash) throw new Error(`Conflicting snapshots for ${artifact.id}`)
      loaded.set(artifact.id, artifact)
    }
    for (const source of next.sources) {
      if (loaded.has(source.artifactId)) {
        if (loaded.get(source.artifactId)!.contentHash !== source.contentHash) throw new Error(`Pinned content hash does not match ${source.label}`)
        continue
      }
      const response = await fetch(source.uri)
      if (!response.ok) throw new Error(`Could not load ${source.uri} (${response.status})`)
      const value = await response.json() as unknown
      const artifact = (value as { artifactType?: unknown }).artifactType === 'heval-evaluation'
        ? parseEvaluationArtifact(value)
        : await adaptJobExportV1(value as JobExport, source.uri)
      if (artifact.contentHash !== source.contentHash || !await verifyContentHash(artifact)) throw new Error(`Pinned content hash does not match ${source.label}`)
      loaded.set(artifact.id, artifact)
    }
    for (const presentation of next.presentations) for (const pin of presentation.snapshotPins) {
      const source = next.sources.find((item) => item.id === pin.sourceId)
      if (!source || source.artifactId !== pin.artifactId || source.runId !== pin.runId || source.contentHash !== pin.contentHash) throw new Error(`Presentation snapshot does not match source ${pin.sourceId}`)
    }
    const firstView = next.analysisViews[0]
    setProject(snapshotPresentations(next))
    setArtifacts(loaded)
    importedHashes.current = new Map([...loaded].map(([id, artifact]) => [id, artifact.contentHash]))
    setActiveViewId(firstView?.id ?? null)
    setActivePresentationId(next.presentations[0]?.id ?? null)
    if (firstView) editor.load(viewDocument(firstView))
    setSpecDraft(null)
    setMode('analysis')
    setJob(null)
    setData(null)
    setLoadError(null)
  }

  const openFile = async (file: File) => {
    try {
      const value = JSON.parse(await file.text()) as unknown
      const kind = (value as { artifactType?: unknown }).artifactType
      if (kind === 'heval-bundle') {
        const bundle = parseBundle(value)
        if (!await verifyContentHash(bundle)) throw new Error('Bundle content hash does not match its contents')
        await installProject(bundle.project, bundle.artifacts)
      } else if (kind === 'heval-project') {
        await installProject(parseProject(value))
      } else {
        const artifact = kind === 'heval-evaluation'
          ? parseEvaluationArtifact(value)
          : await adaptJobExportV1(value as JobExport, `./${file.name}`)
        await addArtifact(artifact, `./${file.name}`)
        if ('rows' in (value as object)) setData(value as JobExport)
      }
      setLoadError(null)
      setSelected(null)
    } catch (e) {
      setLoadError(`${file.name}: ${(e as Error).message}`)
    }
  }

  const saveAnalysisView = (asNew: boolean) => {
    if (!project) return
    const now = new Date().toISOString()
    if (!activeView || asNew) {
      const created = { id: crypto.randomUUID(), label: `Analysis ${project.analysisViews.length + 1}`, ...editor.document, createdAt: now, updatedAt: now }
      setProject({ ...project, analysisViews: [...project.analysisViews, created], updatedAt: now })
      setActiveViewId(created.id)
      return
    }
    setProject({ ...project, analysisViews: project.analysisViews.map((item) => item.id === activeView.id ? saveDocument(item, editor.document) : item), updatedAt: now })
  }

  const selectView = (id: string) => {
    const selectedView = project?.analysisViews.find((item) => item.id === id)
    if (!selectedView) return
    if (project && activeView) setProject({ ...project, analysisViews: project.analysisViews.map((item) => item.id === activeView.id ? saveDocument(item, editor.document) : item) })
    setActiveViewId(id)
    editor.load(viewDocument(selectedView))
    setSpecDraft(null)
  }

  const projectWithDraft = () => project && mode === 'analysis' && activeView ? {
    ...project,
    updatedAt: new Date().toISOString(),
    analysisViews: project.analysisViews.map((item) => item.id === activeView.id ? saveDocument(item, editor.document) : item),
  } : project

  const saveProjectFile = () => {
    if (!project) return
    download(`${project.label}.heval-project.json`, new Blob([JSON.stringify(projectWithDraft(), null, 2)], { type: 'application/json' }))
  }

  const saveBundleFile = async () => {
    if (!project) return
    const bundle = await makeBundle(projectWithDraft()!, project.sources.map((source) => artifacts.get(source.artifactId)).filter((artifact): artifact is EvaluationArtifact => !!artifact))
    download(`${project.label}.heval-bundle.json`, new Blob([JSON.stringify(bundle, null, 2)], { type: 'application/json' }))
  }

  const toggleFilter = (key: FilterKey, value: string) =>
    setFilters((f) => ({ ...f, [key]: (f[key] ?? []).includes(value) ? f[key].filter((v) => v !== value) : [...(f[key] ?? []), value] }))

  const uses = USES[chartState.recipe]
  const entry = index.find((i) => i.job === job)
  const selectedRow = selected ? allRows.find((r) => r.trial === selected) ?? null : null

  const dimField = (key: 'x' | 'color' | 'facet' | 'row', label: string, allowNone: boolean) => (
    <div className="field" key={key}>
      <label htmlFor={`f-${key}`}>{label}</label>
      <select
        id={`f-${key}`}
        value={chartState[key]}
        onChange={(e) => {
          const value = e.target.value
          if (key === 'color' || key === 'facet') setChart(key, value as Dimension | 'none')
          else setChart(key, value as Dimension)
        }}
      >
        {allowNone && <option value="none">None</option>}
        {!fields.some((field) => field.key === chartState[key]) && chartState[key] !== 'none' && <option value={chartState[key]}>{chartState[key]} (unavailable)</option>}
        {fields.filter((field) => field.kind === 'dimension').map((field) => <option key={field.key} value={field.key}>{field.label}</option>)}
      </select>
    </div>
  )

  const measureField = (key: 'measure' | 'xMeasure', label: string) => (
    <div className="field" key={key}>
      <label htmlFor={`f-${key}`}>{label}</label>
      <select id={`f-${key}`} value={chartState[key]} onChange={(e) => setChart(key, e.target.value as Measure)}>
        {!fields.some((field) => field.key === chartState[key]) && <option value={chartState[key]}>{chartState[key]} (unavailable)</option>}
        {fields.filter((field) => field.kind === 'metric').map((field) => <option key={field.key} value={field.key}>{field.label}</option>)}
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
          <span className="beta-pill">STUDIO</span>
        </a>

        <div className="crumbs">
          <ChevronRight size={14} />
          <span>{project ? 'project' : 'jobs'}</span>
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
          <button type="button" className="btn" onClick={saveProjectFile} disabled={!project}><Save size={14} />Project</button>
          <button type="button" className="btn" onClick={() => void saveBundleFile()} disabled={!project}><Download size={14} />Bundle</button>
          <span className="divider" />
          <button type="button" className="btn" onClick={() => void exportSvg()} disabled={!chart}><Download size={14} />SVG</button>
          <button type="button" className="btn" onClick={() => void exportPng()} disabled={!chart}><ImageIcon size={14} />PNG @2x</button>
          <button type="button" className="btn primary" onClick={() => copy('link', window.location.href)} disabled={!chart || override !== null}>
            {copied === 'link' ? <Check size={14} /> : <Link2 size={14} />}{copied === 'link' ? 'Copied' : 'Copy link'}
          </button>
        </div>
      </header>

      <div className="modebar">
        <div className="mode-switch" role="tablist" aria-label="Studio mode">
          <button type="button" role="tab" aria-selected={mode === 'analysis'} onClick={() => switchMode('analysis')}>Analysis</button>
          <button type="button" role="tab" aria-selected={mode === 'presentation'} disabled={!project || !activeView} onClick={() => switchMode('presentation')}>Presentation</button>
        </div>
        <span>{mode === 'analysis' ? 'Compare compatible metrics across sources and save the analysis.' : 'Pin an analysis snapshot, then shape the chart, poster, and motion output.'}</span>
        {project && <strong>{project.label} · {project.sources.length} {project.sources.length === 1 ? 'source' : 'sources'}</strong>}
      </div>

      <div className="workspace">
        <aside className="side">
          {mode === 'analysis' && project && (
            <div className="group project-config">
              <div className="group-head"><span className="eyebrow"><Layers size={11} />Project</span></div>
              <div className="field">
                <label htmlFor="f-project-name">Name</label>
                <input id="f-project-name" type="text" value={project.label} onChange={(event) => setProject({ ...project, label: event.target.value, updatedAt: new Date().toISOString() })} />
              </div>
              <div className="field">
                <label htmlFor="f-view">Saved view</label>
                <select id="f-view" value={activeView?.id ?? ''} onChange={(event) => selectView(event.target.value)}>
                  {project.analysisViews.map((viewItem) => <option key={viewItem.id} value={viewItem.id}>{viewItem.label}</option>)}
                </select>
              </div>
              <div className="source-list" aria-label="Project sources">
                {project.sources.map((source) => (
                  <label className="source-check" key={source.id}>
                    <input type="checkbox" checked={sourceIds.includes(source.id)} onChange={() => setSourceIds((current) => current.includes(source.id) ? current.filter((id) => id !== source.id) : [...current, source.id])} />
                    <span><strong>{source.label}</strong><small>{artifacts.get(source.artifactId)?.benchmark.label ?? 'Unavailable'} · {artifacts.get(source.artifactId)?.run.status ?? 'missing'} · {source.runId.slice(0, 8)}</small></span>
                  </label>
                ))}
              </div>
              <div className="row"><button type="button" className="btn sm" disabled={!editor.canUndo} onClick={editor.undo}>Undo</button><button type="button" className="btn sm" disabled={!editor.canRedo} onClick={editor.redo}>Redo</button><small>{activeView && JSON.stringify(viewDocument(activeView)) !== JSON.stringify(editor.document) ? 'Unsaved changes' : 'Saved'}</small></div>
              <div className="row">
                <button type="button" className="btn sm" onClick={() => saveAnalysisView(false)}><Save size={12} />Save view</button>
                <button type="button" className="btn sm ghost" onClick={() => saveAnalysisView(true)}>Save as new</button>
              </div>
            </div>
          )}

          {mode === 'presentation' && activePresentation && (
            <div className="group project-config">
              <div className="group-head"><span className="eyebrow"><Film size={11} />Presentation</span></div>
              <div className="field"><label htmlFor="f-revision">Revision</label><select id="f-revision" value={activePresentation.id} onChange={(event) => { setActivePresentationId(event.target.value); setSpecDraft(null) }}>{project?.presentations.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}</select></div>
              <div className="field">
                <label htmlFor="f-presentation-name">Name</label>
                <input id="f-presentation-name" type="text" value={activePresentation.label} onChange={(event) => updatePresentation((current) => ({ ...current, label: event.target.value, updatedAt: new Date().toISOString() }))} />
              </div>
              <div className="field">
                <label htmlFor="f-presentation-view">Analysis view</label>
                <select id="f-presentation-view" value={activePresentation.analysisViewId} onChange={(event) => {
                  const nextView = project?.analysisViews.find((item) => item.id === event.target.value)
                  if (!nextView || !project) return
                  const refreshed = newPresentation(project, nextView)
                  updatePresentation((current) => ({ ...current, analysisViewId: nextView.id, snapshotPins: refreshed.snapshotPins, analysisSnapshot: refreshed.analysisSnapshot, customSpec: refreshed.customSpec, updatedAt: new Date().toISOString() }))
                }}>
                  {project?.analysisViews.map((viewItem) => <option key={viewItem.id} value={viewItem.id}>{viewItem.label}</option>)}
                </select>
              </div>
              <div className="field">
                <label htmlFor="f-presentation-theme">Theme preset</label>
                <select id="f-presentation-theme" value={activePresentation.theme} onChange={(event) => {
                  const theme = event.target.value as typeof activePresentation.theme
                  updatePresentation((current) => ({ ...current, theme, graphOverrides: { ...current.graphOverrides, theme: theme === 'plain-light' ? 'light' : 'dark' }, motion: { ...current.motion, theme }, updatedAt: new Date().toISOString() }))
                }}>
                  {THEME_IDS.map((id) => <option key={id} value={id}>{MOTION_THEMES[id].label}</option>)}
                </select>
                <p className="hint">Applies recommended colors. The graph controls below remain editable.</p>
              </div>
              <div className="field">
                <label htmlFor="f-presentation-canvas">Canvas</label>
                <select id="f-presentation-canvas" value={activePresentation.canvas} onChange={(event) => {
                  const canvas = event.target.value as typeof activePresentation.canvas
                  updatePresentation((current) => ({ ...current, canvas, motion: { ...current.motion, canvas }, updatedAt: new Date().toISOString() }))
                }}>
                  {CANVAS_IDS.map((id) => <option key={id} value={id}>{MOTION_CANVASES[id].label}</option>)}
                </select>
              </div>
              {(['title', 'kicker', 'cue', 'note', 'source'] as const).map((key) => (
                <div className="field" key={key}>
                  <label htmlFor={`f-narrative-${key}`}>{key === 'note' ? 'Footer left' : key === 'source' ? 'Footer right' : key[0].toUpperCase() + key.slice(1)}</label>
                  <input id={`f-narrative-${key}`} type="text" value={activePresentation.narrative[key]} onChange={(event) => {
                    const value = event.target.value
                    updatePresentation((current) => ({ ...current, narrative: { ...current.narrative, [key]: value }, motion: { ...current.motion, [key]: value }, updatedAt: new Date().toISOString() }))
                  }} />
                </div>
              ))}
              <p className="pin-note"><Hash size={11} />{activePresentation.snapshotPins.length} immutable source {activePresentation.snapshotPins.length === 1 ? 'snapshot' : 'snapshots'} pinned</p>
              <button type="button" className="btn sm" onClick={() => {
                if (!project) return
                const now = new Date().toISOString()
                const revision: Presentation = { ...activePresentation, id: crypto.randomUUID(), label: `${activePresentation.label.replace(/ · r\d+$/, '')} · r${activePresentation.revision + 1}`, revision: activePresentation.revision + 1, parentPresentationId: activePresentation.id, createdAt: now, updatedAt: now }
                setProject({ ...project, presentations: [...project.presentations, revision], updatedAt: now })
                setActivePresentationId(revision.id)
              }}><Save size={12} />New editorial revision</button>
            </div>
          )}

          <fieldset disabled={override !== null} style={{ border: 0, padding: 0, margin: 0, minWidth: 0 }}>
          <div className="group">
            <div className="group-head">
              <span className="eyebrow"><SlidersHorizontal size={11} />Form</span>
            </div>
            <div className="field">
              <label htmlFor="f-recipe">Recipe</label>
              <select
                id="f-recipe"
                value={chartState.recipe}
                onChange={(e) => {
                  setChart('recipe', e.target.value as Recipe)
                }}
              >
                {RECIPES.map((r) => <option key={r} value={r}>{RECIPE_LABEL[r]}</option>)}
              </select>
            </div>
            <button type="button" className="btn sm ghost" onClick={() => {
              const defaults = RECIPE_DEFAULTS[chartState.recipe]
              if (mode === 'analysis') setState((current) => ({ ...current, ...defaults }))
              else updatePresentation((current) => ({ ...current, graphOverrides: { ...current.graphOverrides, ...defaults } }))
            }}>Use recipe defaults</button>
            {uses.has('x') && dimField('x', chartState.recipe === 'matrix' ? 'Columns' : 'Group by', false)}
            {uses.has('row') && dimField('row', 'Rows', false)}
            {uses.has('color') && dimField('color', 'Color', true)}
            {uses.has('facet') && dimField('facet', 'Facet', true)}
            <p className="hint">
              {chartState.recipe === 'matrix'
                ? 'One hue, light to dark: the matrix encodes magnitude, not category.'
                : 'Color is capped at four series - the palette validates no further. Facet past that.'}
            </p>
          </div>

          <div className="group">
            <div className="group-head">
              <span className="eyebrow"><Ruler size={11} />Measure</span>
            </div>
            {uses.has('measure') && measureField('measure', chartState.recipe === 'scatter' ? 'Y (quality)' : 'Value')}
            {uses.has('xMeasure') && measureField('xMeasure', 'X (cost)')}
            {uses.has('aggregate') && (
              <div className="field">
                <label htmlFor="f-agg">Aggregate</label>
                <select id="f-agg" value={chartState.aggregate} onChange={(e) => setChart('aggregate', e.target.value as Aggregate)}>
                  {AGGREGATES.map((a) => <option key={a} value={a}>{a}</option>)}
                </select>
              </div>
            )}
            {uses.has('sort') && (
              <div className="field">
                <label htmlFor="f-sort">Sort</label>
                <select id="f-sort" value={chartState.sort} onChange={(e) => setChart('sort', e.target.value as SortOrder)}>
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
                  <input type="checkbox" checked={chartState.labels} onChange={(e) => setChart('labels', e.target.checked)} />
                  Value labels
                  <small>direct</small>
                </label>
              )}
              {uses.has('intervals') && (
                <label className="check">
                  <input type="checkbox" checked={chartState.intervals} onChange={(e) => setChart('intervals', e.target.checked)} />
                  95% intervals
                  <small>wilson</small>
                </label>
              )}
            </div>
            {mode === 'analysis' && <div className="field">
              <label htmlFor="f-title">Title</label>
              <input id="f-title" type="text" value={state.title} placeholder="optional" onChange={(e) => set('title', e.target.value)} />
            </div>}
            {mode === 'analysis' && <div className="field">
              <label htmlFor="f-sub">Subtitle</label>
              <input id="f-sub" type="text" value={state.subtitle} placeholder="optional" onChange={(e) => set('subtitle', e.target.value)} />
            </div>}
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
            {project?.sources.map((source) => <p className="hint" key={source.id}><code>{source.uri}</code></p>)}
            <div className="row">
              {job && index.some((i) => i.job === job) && (
                <a className="btn sm" href={`${RESULTS}/${job}.html`} target="_blank" rel="noreferrer">
                  <ExternalLink size={12} />Static report
                </a>
              )}
              <button
                type="button"
                className="btn sm ghost"
                onClick={() => {
                  if (mode === 'analysis') setState({ ...DEFAULT_STATE, theme: chartState.theme })
                  else updatePresentation((current) => ({ ...current, graphOverrides: { theme: current.graphOverrides.theme ?? chartState.theme }, updatedAt: new Date().toISOString() }))
                  setOverride(null); setFilters(NO_FILTERS)
                }}
              >
                <RotateCcw size={12} />Reset
              </button>
            </div>
          </div>
          </fieldset>
        </aside>

        <main className="main">
          <div className="head">
            <div>
              <span className="eyebrow">{mode === 'analysis' ? 'Analysis project' : 'Pinned presentation'}</span>
              <h1>{project?.label ?? job ?? 'No project loaded'}</h1>
              {project && (
                <div className="meta">
                  <span><Rows3 size={12} />{allRows.length} trials{filtering ? ` · ${rows.length} shown` : ''}</span>
                  <span><Cpu size={12} />{project.sources.length} source{project.sources.length === 1 ? '' : 's'}{versions ? ` · ${versions}` : ''}</span>
                  <span><Hash size={12} /><code>{project.id.slice(0, 8)}</code></span>
                  <span><Clock3 size={12} />updated {project.updatedAt.slice(0, 10)}</span>
                </div>
              )}
            </div>
          </div>

          {project && <StatTiles rows={rows} />}

          {project && mode === 'analysis' && (
            <FilterBar
              rows={allRows}
              dimensions={fields.filter((field) => field.kind === 'dimension')}
              filters={filters}
              onToggle={toggleFilter}
              onClear={() => setFilters(NO_FILTERS)}
            />
          )}

          {(loadError || compatibility.incompatible.length || chart?.warnings.length || rendered.error || embedError || (project && !rows.length)) ? (
            <div className="notes">
              {loadError && <div className="warn err"><AlertTriangle size={14} /><span>{loadError}</span></div>}
              {project && !rows.length && <div className="warn"><Filter size={14} /><span>No selected source has compatible data for this metric and filter set.</span></div>}
              {compatibility.incompatible.length > 0 && <div className="warn"><AlertTriangle size={14} /><span>Excluded incompatible sources for {MEASURE_LABEL[chartState.measure]}: {compatibility.incompatible.join(', ')}.</span></div>}
              {chart?.warnings.map((w) => <div className="warn" key={w}><AlertTriangle size={14} /><span>{w}</span></div>)}
              {(rendered.error ?? embedError) && <div className="warn err"><AlertTriangle size={14} /><span>Spec error: {rendered.error ?? embedError}</span></div>}
            </div>
          ) : null}

          {override !== null && <div className="notes"><div className="warn"><Braces size={14} /><span>Preview uses a custom spec. Return to controls to edit the recipe. The table describes the recipe. Custom specs are saved in project and bundle files.</span><button type="button" className="btn sm" onClick={() => { setOverride(null); setSpecDraft(null) }}>Return to controls</button></div></div>}

          <div className="tabbar">
            <div className="tabs" role="tablist">
              {((mode === 'analysis' ? [
                ['chart', 'Chart', <BarChart3 size={13} key="i" />, null],
                ['table', 'Table view', <Table2 size={13} key="i" />, chart ? chart.table.length : null],
                ['spec', 'Vega-Lite spec', <Braces size={13} key="i" />, null],
                ['rows', 'Raw trials', <Activity size={13} key="i" />, project ? rows.length : null],
              ] : [
                ['chart', 'Poster', <ImageIcon size={13} key="i" />, null],
                ['motion', 'Motion', <Film size={13} key="i" />, null],
                ['spec', 'Vega-Lite spec', <Braces size={13} key="i" />, null],
              ]) as [Tab, string, ReactNode, number | null][]).map(([t, label, icon, count]) => (
                <button key={t} type="button" role="tab" className="tab" aria-selected={tab === t} disabled={t === 'spec' && !chart && override === null} onClick={() => setTab(t)}>
                  {icon}{label}{count !== null && <small>{count}</small>}
                </button>
              ))}
            </div>
            <span className="spacer" />
            {/* Switches the canvas between the two validated chart surfaces; the
                chrome around it stays the product's dark. */}
            <div className="canvas-toggle" role="radiogroup" aria-label="Chart canvas" style={{ display: tab === 'motion' ? 'none' : undefined }}>
              <label className="canvas-btn">
                <input type="radio" name="canvas" className="sr-only" checked={chartState.theme === 'dark'} onChange={() => setChart('theme', 'dark')} />
                <Moon size={11} />Dark mode
              </label>
              <label className="canvas-btn">
                <input type="radio" name="canvas" className="sr-only" checked={chartState.theme === 'light'} onChange={() => setChart('theme', 'light')} />
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
                <span>{mode === 'presentation' ? activePresentation?.label ?? 'Presentation poster' : RECIPE_LABEL[chartState.recipe]}</span>
                <small>{chartState.recipe} · {rows.length} trials · {chartState.theme === 'dark' ? 'surface #2c2a25' : 'surface #ffffff'}</small>
              </div>
              <div className="right">
                <small>{chart ? `${chart.table.length} plotted groups` : ''}</small>
              </div>
            </div>
            <div className={`canvas${mode === 'presentation' ? ' presentation-canvas' : ''}`} data-canvas={chartState.theme} data-format={activePresentation?.canvas}>
              {!project && !loadError ? (
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

          {tab === 'motion' && <MotionPreview
            key={activePresentation?.id}
            job={project?.label ?? job}
            rows={rows}
            unavailableReason={project && compatibility.sourceIds.some((id) => {
              const sourceFields = projectFields(project, artifacts, [id])
              return !sourceFields.some((field) => field.key === 'passed') || !sourceFields.some((field) => field.key === 'modelShort')
            }) ? 'The completion animation requires pass results and model names in every selected source.' : undefined}
            options={activePresentation?.motion}
            onOptionsChange={(motion) => updatePresentation((current) => ({ ...current, motion, theme: motion.theme, canvas: motion.canvas, narrative: { title: motion.title, kicker: motion.kicker, cue: motion.cue, note: motion.note, source: motion.source }, updatedAt: new Date().toISOString() }))}
          />}

          {tab === 'table' && chart && (
            <div className="panel">
              <div className="card-head">
                <div className="title"><Table2 size={13} /><span>Plotted numbers</span><small>what the marks encode, after aggregation</small></div>
              </div>
              <table>
                <thead>
                  <tr>{chart.columns.map((c) => <th key={c} className={NUMERIC.has(c) ? 'num' : undefined}>{fields.find((field) => field.key === (c === 'value' ? chartState.measure : c === 'xValue' ? chartState.xMeasure : c))?.label ?? columnLabel(c, chartState.measure, chartState.xMeasure)}</th>)}</tr>
                </thead>
                <tbody>
                  {chart.table.map((r, i) => (
                    <tr key={i}>
                      {chart.columns.map((c) => (
                        <td key={c} className={NUMERIC.has(c) ? 'num' : undefined}>{cellText(r[c], c, chartState.measure, chartState.xMeasure)}</td>
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
                  <button type="button" className="btn sm" onClick={() => { setOverride(null); setSpecDraft(null) }} disabled={override === null && specDraft === null}>
                    <RotateCcw size={12} />Revert to controls
                  </button>
                  <button type="button" className="btn sm" disabled={specDraft === null} onClick={() => {
                    try {
                      const parsed: unknown = JSON.parse(specText)
                      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('The spec must be a JSON object.')
                      setOverride(specText); setSpecDraft(null); setEmbedError(null)
                    } catch (error) { setEmbedError((error as Error).message) }
                  }}>Apply spec</button>
                  <button type="button" className="btn sm" onClick={() => copy('spec', specText)}>
                    {copied === 'spec' ? <Check size={12} /> : <Copy size={12} />}{copied === 'spec' ? 'Copied' : 'Copy spec'}
                  </button>
                </div>
              </div>
              <textarea className="spec" spellCheck={false} value={specText} aria-label="Vega-Lite JSON" onChange={(e) => setSpecDraft(e.target.value)} />
            </div>
          )}

          {tab === 'rows' && project && (
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

function FilterBar({ rows, dimensions, filters, onToggle, onClear }: {
  rows: TrialRow[]
  dimensions: { key: string; label: string }[]
  filters: Filters
  onToggle: (key: FilterKey, value: string) => void
  onClear: () => void
}) {
  const [open, setOpen] = useState<FilterKey | null>(null)
  const [added, setAdded] = useState<string[]>([])
  const keys = [...new Set([...FILTER_KEYS, ...added, ...Object.keys(filters).filter((key) => filters[key].length)])]
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
  const active = Object.values(filters).some((values) => values.length > 0)

  return (
    <div className="filters" ref={wrap}>
      <span className="eyebrow label"><ListFilter size={11} />Filter</span>
      {keys.map((key) => {
        const values = filters[key] ?? []
        const on = values.length > 0
        return (
          <div className="filter-menu" key={key}>
            <button
              type="button"
              className={`chip${on ? ' on' : ''}`}
              aria-expanded={open === key}
              aria-haspopup="menu"
              onClick={() => setOpen((o) => (o === key ? null : key))}
            >
              {FILTER_LABEL[key] ?? dimensions.find((field) => field.key === key)?.label ?? key}
              {on ? <small>{values.length === 1 ? values[0] : `${values.length} selected`}</small> : <small>all</small>}
              <ChevronDown size={12} />
            </button>
            {open === key && (
              <div className="menu" role="menu">
                {counts(key).map(([value, n]) => (
                  <button
                    key={value}
                    type="button"
                    role="menuitemcheckbox"
                    aria-checked={values.includes(value)}
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
      <select aria-label="Add filter" value="" onChange={(event) => { setAdded((current) => [...current, event.target.value]); setOpen(event.target.value) }}>
        <option value="">Add filter…</option>
        {dimensions.filter((field) => !keys.includes(field.key)).map((field) => <option key={field.key} value={field.key}>{field.label}</option>)}
      </select>
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
