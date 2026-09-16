import { useEffect, useRef, useState, type FormEvent } from 'react'
import { ArrowRight, Play, RefreshCw, Square, TerminalSquare } from 'lucide-react'
import { Terminal } from '@xterm/xterm'
import '@xterm/xterm/css/xterm.css'
import { authorizedFetch, type AppAuth } from './auth'
import { HARNESS } from './harnesses'
import type { Run } from '../server/types'
import { ProviderSettings } from './ProviderSettings'

type Config = {
  models: string[]; harnesses: string[]; tasks: { id: string; label: string; description: string }[]
  maxTimeoutMs: number; maxDailyPerUser: number; runnerEnabled: boolean; canRun: boolean
  providerSettings?: boolean; connectionRequired?: boolean
}
const ongoing = (run: Run) => run.active ?? (!run.finishedAt && ['running', 'grading', 'cancelled'].includes(run.status))
const chartable = (run: Run) => Boolean(run.finishedAt && (run.grade || (run.status === 'timed-out' && run.timeoutStage !== 'grader')))
const label = (run: Run) => run.grade ? run.grade.passed ? 'Passed' : 'Tests failed' : run.status.replaceAll('-', ' ')

async function readJson<T>(response: Response): Promise<T> {
  if (!response.ok) {
    const body = await response.json().catch(() => null)
    throw new Error(body?.error || `Request failed (${response.status}). Please retry.`)
  }
  return response.json() as Promise<T>
}

function RunTerminal({ chunks }: { chunks: Run['chunks'] }) {
  const host = useRef<HTMLDivElement>(null)
  const terminal = useRef<Terminal | null>(null)
  const written = useRef(0)
  useEffect(() => {
    if (!host.current) return
    const term = new Terminal({ cols: 96, rows: 20, convertEol: true, disableStdin: true, fontSize: 12,
      fontFamily: '"DM Mono", monospace', scrollback: 5000, theme: { background: '#0d100e', foreground: '#d8ded9' } })
    term.open(host.current); terminal.current = term; written.current = 0
    let frame = 0
    const resize = new ResizeObserver(([entry]) => {
      const cols = Math.max(28, Math.floor(entry.contentRect.width / 7.3))
      // xterm changes its own layout; defer it out of the observer delivery loop.
      cancelAnimationFrame(frame)
      frame = requestAnimationFrame(() => { if (cols !== term.cols) term.resize(cols, 20) })
    })
    resize.observe(host.current)
    return () => { resize.disconnect(); cancelAnimationFrame(frame); terminal.current = null; term.dispose() }
  }, [])
  useEffect(() => {
    if (chunks.length < written.current) { terminal.current?.reset(); written.current = 0 }
    for (const chunk of chunks.slice(written.current)) terminal.current?.write(chunk.data)
    written.current = chunks.length
  }, [chunks])
  return <div className="evaluation-terminal" ref={host} aria-label="Evaluation terminal output" />
}

export function RunWorkbench({ auth }: { auth: AppAuth }) {
  const [config, setConfig] = useState<Config | null>(null)
  const [runs, setRuns] = useState<Run[]>([])
  const [model, setModel] = useState('')
  const [harness, setHarness] = useState('pi-agent')
  const [task, setTask] = useState('concurrent-cache-v1')
  const [seconds, setSeconds] = useState(300)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [detail, setDetail] = useState<Run | null>(null)
  const [compared, setCompared] = useState<string[]>([])
  const [error, setError] = useState('')
  const [connectionError, setConnectionError] = useState('')
  const [busy, setBusy] = useState(false)
  const [refresh, setRefresh] = useState(0)
  const [now, setNow] = useState(() => Date.now())
  const [settingsOpen, setSettingsOpen] = useState(false)

  useEffect(() => {
    const configure = (event: Event) => setHarness((event as CustomEvent<string>).detail)
    window.addEventListener('heval-configure', configure)
    return () => window.removeEventListener('heval-configure', configure)
  }, [])

  useEffect(() => {
    if (!auth.user) return
    const controller = new AbortController()
    let timer: ReturnType<typeof setTimeout>
    async function load() {
      try {
        const [settings, history] = await Promise.all([
          authorizedFetch(auth, '/api/config', { signal: controller.signal }).then(readJson<Config>),
          authorizedFetch(auth, '/api/runs', { signal: controller.signal }).then(readJson<Run[]>),
        ])
        if (controller.signal.aborted) return
        setConfig(settings); setRuns(history); setConnectionError('')
        setModel(current => settings.models.includes(current) ? current : settings.models[0] || '')
        setHarness(current => settings.harnesses.includes(current) ? current : settings.harnesses[0] || 'pi-agent')
        setSeconds(current => Math.min(current, settings.maxTimeoutMs / 1000))
      } catch (cause) {
        if (!controller.signal.aborted) setConnectionError(cause instanceof Error ? cause.message : 'Could not load evaluations.')
      } finally {
        if (!controller.signal.aborted) timer = setTimeout(load, 3000)
      }
    }
    void load()
    return () => { controller.abort(); clearTimeout(timer) }
  }, [auth, refresh])

  useEffect(() => {
    if (!auth.user || !selectedId) return
    const controller = new AbortController()
    let timer: ReturnType<typeof setTimeout>
    let chunks: Run['chunks'] = []
    async function poll() {
      try {
        const result = await authorizedFetch(auth, `/api/runs/${selectedId}?after=${chunks.length}`, { signal: controller.signal }).then(readJson<Run>)
        if (controller.signal.aborted) return
        chunks = [...chunks, ...result.chunks]
        setDetail({ ...result, chunks }); setError('')
        if (!ongoing(result)) return
      } catch (cause) {
        if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : 'Connection lost. Reconnecting…')
      }
      if (!controller.signal.aborted) timer = setTimeout(poll, 1500)
    }
    void poll()
    return () => { controller.abort(); clearTimeout(timer) }
  }, [auth, selectedId, refresh])

  useEffect(() => {
    if (!detail || !ongoing(detail)) return
    const timer = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(timer)
  }, [detail])

  function select(id: string) { setDetail(null); setSelectedId(id); setError('') }
  async function launch(event: FormEvent) {
    event.preventDefault(); setBusy(true); setError('')
    try {
      const run = await authorizedFetch(auth, '/api/runs', { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ harness, model, task, timeoutMs: seconds * 1000 }) }).then(readJson<{ id: string }>)
      select(run.id); setRefresh(value => value + 1)
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not start evaluation.') }
    finally { setBusy(false) }
  }
  async function cancel() {
    if (!selectedId) return
    setBusy(true)
    try {
      await authorizedFetch(auth, `/api/runs/${selectedId}`, { method: 'DELETE' }).then(readJson)
      setRefresh(value => value + 1)
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not cancel evaluation.') }
    finally { setBusy(false) }
  }
  const elapsed = detail ? Math.max(0, Math.round(((detail.finishedAt ? Date.parse(detail.finishedAt) : now) - Date.parse(detail.startedAt)) / 1000)) : 0
  const comparisonIds = compared.filter(id => runs.some(run => run.id === id && chartable(run)))

  return <section className="workbench shell" id="evaluations">
    <div className="workbench-heading"><div><span className="kicker">EVALUATION WORKBENCH</span><h2>Run it. Inspect it. Compare.</h2></div><a href="/studio">Open Studio <ArrowRight size={15} /></a></div>
    {!auth.user ? <div className="workbench-empty"><TerminalSquare size={28} /><h3>Your evaluations, saved.</h3>
      <p>Choose a model and harness, watch the attempt, then compare its test results in Studio.</p>
      {auth.configured ? <button className="primary-button" disabled={auth.isLoading} onClick={auth.signIn}>Sign in to evaluations</button>
        : <p>Live evaluations are not available on this instance yet. You can explore published results or open an export in Studio.</p>}
    </div> : <>
      {config?.providerSettings && <div className="provider-toolbar"><div><strong>{config.connectionRequired ? 'Connect a provider to get started' : 'Using your Merge Gateway connection'}</strong><p>{config.connectionRequired ? 'Add your key once, then choose models for each evaluation.' : 'Your own credits. Saved results stay private to your account.'}</p></div><button onClick={() => setSettingsOpen(value => !value)} aria-expanded={settingsOpen}>Provider settings</button></div>}
      {config?.providerSettings && settingsOpen && <ProviderSettings auth={auth} onChanged={() => setRefresh(value => value + 1)} onClose={() => setSettingsOpen(false)} />}
      <form className="run-config" onSubmit={launch}>
        <label>Model<select value={model} onChange={event => setModel(event.target.value)} disabled={!config}>{config?.models.map(value => <option key={value}>{value}</option>)}</select></label>
        <label>Harness<select value={harness} onChange={event => setHarness(event.target.value)} disabled={!config}>{config?.harnesses.map(value => <option value={value} key={value}>{HARNESS[value]?.name || value}</option>)}</select></label>
        <label>Task<select value={task} onChange={event => setTask(event.target.value)} disabled={!config}>{config?.tasks.map(value => <option key={value.id} value={value.id}>{value.label}</option>)}</select></label>
        <label>Time limit, seconds<input type="number" min="1" step="1" max={(config?.maxTimeoutMs ?? 300000) / 1000} value={seconds} onChange={event => setSeconds(Number(event.target.value))} required /></label>
        <button className="primary-button" disabled={busy || !config?.canRun || !model}><Play size={14} />{busy ? 'Working…' : 'Launch evaluation'}</button>
        <p className="run-config-note">{config?.connectionRequired ? 'Open Provider settings to connect and validate your Gateway key.' : config?.canRun ? config.models.length ? `Uses model credits. Up to ${config.maxDailyPerUser} attempts per day. Each attempt starts in an isolated workspace.` : 'No server-approved models are available through this connection. Revalidate in Provider settings or contact the instance owner.' : config?.runnerEnabled ? 'Evaluation access is by invitation.' : 'Evaluation execution is disabled on this instance.'}</p>
      </form>
      <div className="run-history-heading"><h3>Saved attempts <span>{runs.length}</span></h3><button onClick={() => setRefresh(value => value + 1)} aria-label="Refresh evaluations"><RefreshCw size={15} /></button>
        {comparisonIds.length > 0 && <a className="primary-button" href={`/studio?runs=${comparisonIds.join(',')}`}>Compare {comparisonIds.length} in Studio <ArrowRight size={14} /></a>}
      </div>
      {connectionError && <p role="alert">{connectionError}</p>}
      {!runs.length && !connectionError && <p className="run-empty">No attempts yet. Launch your first evaluation above.</p>}
      <div className="run-history">{runs.map(run => <article key={run.id} className={`run-row ${run.id === selectedId ? 'selected' : ''}`}>
        <input type="checkbox" aria-label={`Compare ${run.id}`} disabled={!chartable(run)} checked={compared.includes(run.id)} onChange={event => setCompared(current => event.target.checked ? [...current, run.id] : current.filter(id => id !== run.id))} />
        <button className="run-select" onClick={() => select(run.id)}><strong>{run.model}</strong><span>{HARNESS[run.harness]?.name || run.harness} · {run.task || 'concurrent-cache-v1'}</span></button>
        <time dateTime={run.startedAt}>{new Date(run.startedAt).toLocaleString()}</time><span className={`run-status ${run.status}`}>{label(run)}</span>
      </article>)}</div>
      {error && <p role="alert">{error}</p>}
      {selectedId && !detail && <p role="status">Loading attempt…</p>}
      {detail && <div className="run-detail">
        <div className="run-detail-heading"><div><span className="kicker">{HARNESS[detail.harness]?.name || detail.harness} / {label(detail)}</span><h3>{detail.model}</h3></div>
          {ongoing(detail) && <button onClick={() => void cancel()} disabled={busy || detail.status === 'cancelled'}><Square size={13} /> Cancel</button>}
          {chartable(detail) && <a className="primary-button" href={`/studio?runs=${detail.id}`}>Review in Studio <ArrowRight size={14} /></a>}
        </div>
        <dl className="run-metrics"><div><dt>Elapsed</dt><dd>{elapsed}s</dd></div><div><dt>Tests</dt><dd>{detail.grade ? detail.grade.passed ? 'Passed' : 'Failed' : 'Awaiting grade'}</dd></div>
          <div><dt>Cost</dt><dd>{detail.costUsd == null ? 'Unavailable' : `$${detail.costUsd.toFixed(4)}`}</dd></div><div><dt>Tokens</dt><dd>{detail.totalTokens == null ? 'Unavailable' : detail.totalTokens.toLocaleString()}</dd></div></dl>
        <p className="run-footnote">Only measured values appear here. Provider usage may be unavailable. A single task does not establish a model ranking.</p>
        {detail.error && <p role="status">{detail.error}</p>}
        <RunTerminal key={detail.id} chunks={detail.chunks} />
        {detail.grade && <details><summary>Verifier output</summary><pre>{detail.grade.output}</pre></details>}
      </div>}
    </>}
  </section>
}
