import { PageHeader } from '../reports/PageHeader'
import { useEffect, useRef, useState } from 'react'
import { useMutation, useQuery, useConvexAuth } from 'convex/react'
import type { FunctionReturnType } from 'convex/server'
import { api } from '../../convex/_generated/api'
import type { Id } from '../../convex/_generated/dataModel'
import { WorkspaceLayout } from '../reports/WorkspaceLayout'
import { ProjectReportView } from '../reports/ProjectReportView'
import { useAppAuth } from '../auth'
import { message, token } from '../reports/helpers'
import { executionTimeoutSeconds, validateRunSettings, type RunSettings, RUNNER_ONLINE_MS, terminalStates } from './protocol'
import { benchmarkFor } from './benchmarks'
import './evaluations.css'
import { LiveRunMonitor } from './LiveRunMonitor'
import { HarnessPicker } from './HarnessPicker'
import { ModelPicker } from './ModelPicker'
import { IndividualRuns } from './IndividualRuns'
import harnessCatalog from '../harness-catalog.json'
import { HARNESS } from '../harnesses'

type Machine = FunctionReturnType<typeof api.runners.list>[number]
const agentLabel = (s: string) => HARNESS[s]?.name ?? (s === 'terminus-2' ? 'Terminus 2' : s)
const toggle = (items: string[], item: string) => items.includes(item) ? items.filter(i => i !== item) : [...items, item]
const done = (s: string) => (terminalStates as readonly string[]).includes(s)

function ExperimentReport({ id }: { id: Id<'reports'> }) {
  const report = useQuery(api.reports.get, { id })
  const share = useMutation(api.reports.share), revoke = useMutation(api.reports.revoke), publish = useMutation(api.reportProjects.publish)
  const [busy, setBusy] = useState(false), [status, setStatus] = useState(''), [error, setError] = useState('')
  async function act(run: () => Promise<unknown>, success: string) {
    setBusy(true); setStatus(''); setError('')
    try { await run(); setStatus(success) } catch (e) { setError(message(e)) } finally { setBusy(false) }
  }
  if (report === undefined) return <p role="status">Preparing the combined evaluation report…</p>
  if (!report) return <p role="alert">The combined report is unavailable to this account.</p>
  const shareUrl = report.shareToken ? `${location.origin}/share#${report.shareToken}` : ''
  return <>
    <section className="report-card evaluation-result-actions" aria-label="Analyze evaluation">
      <span className="report-eyebrow">RESULTS READY</span><h2>Inspect, shape, and publish this evaluation.</h2>
      <p>Heval combined every available harness/model run into one report. The original run reports remain available above for diagnosis.</p>
      <div className="report-actions"><a className="report-button primary" href={`/studio?report=${id}`}>Edit charts in Studio</a><a href={`/reports?id=${id}`}>Open report details</a></div>
    </section>
    <ProjectReportView data={report.data} project={report.project} context="evaluation" />
    <section className="report-card evaluation-publish" id="publish" aria-label="Publish evaluation">
      <span className="report-eyebrow">PUBLISH</span><h2>{shareUrl ? 'This evaluation has a public link.' : 'Publish when the result is ready.'}</h2>
      <p>{shareUrl ? 'Anyone with the link can view the published version without signing in. Draft chart edits remain private until you publish them.' : 'Creating a link publishes the current report. You can revoke access later without deleting your evaluation.'}</p>
      {shareUrl && <label>Share link<input readOnly value={shareUrl} onFocus={event => event.target.select()} /></label>}
      <div className="report-actions">
        {!shareUrl && <button disabled={busy} onClick={() => void act(() => share({ id, token: token() }), 'Evaluation published. Share link created.')}>{busy ? 'Publishing…' : 'Publish evaluation'}</button>}
        {shareUrl && <><button disabled={busy} onClick={() => void act(() => navigator.clipboard.writeText(shareUrl), 'Share link copied.')}>Copy link</button><a href={shareUrl} target="_blank" rel="noreferrer">Open published view ↗</a>
          {report.publishedVersion !== null && report.version !== report.publishedVersion && <button disabled={busy} onClick={() => void act(() => publish({ id, expectedVersion: report.version }), 'Latest chart changes published.')}>Publish latest changes</button>}
          <button className="secondary" disabled={busy} onClick={() => void act(() => revoke({ id }), 'Public link revoked. The evaluation remains saved.')}>Revoke link</button></>}
      </div>
      {status && <p role="status">{status}</p>}{error && <p role="alert">{error}</p>}
    </section>
  </>
}

function Wizard({ machines, now }: { machines: Machine[]; now: number }) {
  const create = useMutation(api.experiments.create)
  const [worker, setWorker] = useState(''), [task, setTask] = useState('')
  const [agents, setAgents] = useState<string[]>(() => {
    const requested = new URLSearchParams(location.search).get('harness')
    return requested ? [requested === 'pi-agent' ? 'pi' : requested] : []
  }), [models, setModels] = useState<string[]>([])
  const [vendors, setVendors] = useState<Record<string, string>>({}), [attempts, setAttempts] = useState(1), [title, setTitle] = useState('')
  const [concurrency, setConcurrency] = useState(1), [retries, setRetries] = useState(0)
  const [cpus, setCpus] = useState(''), [memory, setMemory] = useState(''), [deadline, setDeadline] = useState('')
  const [busy, setBusy] = useState(false), [error, setError] = useState('')
  const pending = useRef<{ selection: string; id: string } | null>(null)
  const machine = machines.find(m => m.id === worker) ?? machines[0]
  const ready = !!machine && machine.enabled && machine.ready && now-machine.lastSeen < RUNNER_ONLINE_MS
  const catalog = machine?.profiles.filter(p => !p.setupCheck && p.taskSet && p.vendor && p.maxAttempts !== undefined) ?? []
  const taskSets = [...new Map(catalog.map(p => [p.taskSet!,p])).values()]
  const taskSet = task || taskSets[0]?.taskSet || ''
  const choices = catalog.filter(p => p.taskSet === taskSet)
  const vendorFor = (model: string) => vendors[model] || [...new Set(choices.filter(p => p.model === model).map(p => p.vendor!))].sort()[0] || ''
  const matrix = agents.flatMap(agent => models.map(model => ({ agent, model, profile: choices.find(p => p.agent === agent && p.model === model && p.vendor === vendorFor(model)) })))
  const maxAttempts = matrix.length ? Math.min(...matrix.map(c => c.profile?.maxAttempts ?? 0)) : 0
  const trials = matrix.reduce((n,c) => n + (c.profile?.tasks ?? 0)*attempts,0)
  const configurable = matrix.length > 0 && matrix.every(c => c.profile?.runSettingsVersion === 1)
  const settings: RunSettings | undefined = configurable ? { concurrency, retries, ...(cpus ? { cpus: Number(cpus) } : {}), ...(memory ? { memoryMb: Number(memory) } : {}), ...(deadline ? { timeoutSeconds: Number(deadline) * 60 } : {}) } : undefined
  let settingsError = ''
  try { for (const cell of matrix) if (cell.profile) validateRunSettings(cell.profile, settings) } catch (e) { settingsError = message(e) }
  const supportedSelection = agents.every(agent => harnessCatalog.find(h => h.id === agent)?.merge !== false)
  const valid = supportedSelection && !settingsError && ready && matrix.length > 0 && matrix.every(c => c.profile) && Number.isSafeInteger(attempts) && attempts >= 1 && attempts <= maxAttempts && Number.isSafeInteger(trials)
  const review = matrix.flatMap(c => c.profile ? [c.profile] : [])
  async function submit() {
    if (!machine || !title.trim() || !valid) return
    const input = { runner: machine.id, title: title.trim(), attempts, ...(settings ? { runSettings: settings } : {}), profiles: review.map(p => ({ id:p.id,digest:p.digest })) }
    const selection = JSON.stringify(input)
    pending.current = pending.current?.selection === selection ? pending.current : { selection, id: token() }
    setBusy(true);setError('')
    try { const id = await create({ ...input, requestId: pending.current.id }); window.location.assign(`/evaluations?experiment=${id}`) }
    catch(e) { setError(message(e));setBusy(false) }
  }
  return <section className="report-card evaluation-wizard" aria-label="New evaluation">
    <h2>Configure evaluation</h2>
    <div className="evaluation-config-layout"><div className="evaluation-config-fields">
      <label data-tour="worker">Worker<select value={machine?.id ?? ''} onChange={e=>{setWorker(e.target.value);setTask('');setAgents([]);setModels([]);setVendors({});setAttempts(1)}}><option value="" disabled>Connect a worker first</option>{machines.map(m=><option key={m.id} value={m.id}>{m.name}{!m.enabled?' · Off':now-m.lastSeen>=RUNNER_ONLINE_MS?' · Offline':''}</option>)}</select></label>
      {!machines.length && <p><a href="/machines">Connect your first worker</a> to see its available tasks and model connections.</p>}
      {machine && !ready && <p role="status">{!machine.enabled ? <>{machine.name} is switched off. Switch it on in <a href="/machines">Runner setup</a> before launching.</> : <>This worker is {now-machine.lastSeen>=RUNNER_ONLINE_MS?'offline':`not ready: ${machine.health}`}. Reconnect it before launching.</>}</p>}
      <fieldset data-tour="benchmark"><legend>Benchmark</legend>
        <p>Choose a task set installed on this computer.</p>
        {machine && !catalog.length && <p className="report-notice">No benchmarks are installed on {machine.name} yet. Add a benchmark on the worker to make it available here. For your own task sets, follow the <a href="https://github.com/MatthewFeroz/heval/blob/main/docs/connected-runners.md">worker setup guide</a>. Older workers need the updated CLI.</p>}
        <div className="evaluation-choices">{taskSets.map(p=>{const b=benchmarkFor(p.taskSet);return <label className="evaluation-choice evaluation-benchmark" key={p.taskSet}><input type="radio" name="task-set" checked={taskSet===p.taskSet} onChange={()=>{setTask(p.taskSet!);setAgents([]);setModels([]);setVendors({});setAttempts(1)}}/><span><strong>{b?.title ?? p.benchmark}</strong><small>{b ? `${b.publisher} · ` : ''}{p.tasks} {p.tasks===1?'task':'tasks'} <span className="report-badge" data-tone="success">Installed</span>{b?.status==='preview' && <span className="report-badge" data-tone="warning">Preview</span>}</small><small>{b ? b.summary : 'Custom task set approved on this worker.'}</small>{b && <small>{b.note}</small>}</span></label>})}
        </div>

      </fieldset>
      <HarnessPicker profiles={choices} selected={agents} onToggle={agent => setAgents(toggle(agents, agent))} setupHref={`/machines?setup=1&provider=1&worker=${machine?.id ?? ''}`} />
      <p role="status">{agents.filter(agent => choices.some(p => p.agent === agent) && harnessCatalog.find(h => h.id === agent)?.merge !== false).length} harnesses selected</p>
      {!!catalog.length && <>
      <p>Each harness runs with each selected model.</p>
      <ModelPicker catalog={machine?.modelCatalog} setupHref={`/machines?setup=1&provider=1&worker=${machine?.id ?? ""}`} profiles={choices} selected={models} vendors={vendors} onToggle={model => setModels(toggle(models, model))} onVendor={(model, vendor) => setVendors(current => ({ ...current, [model]: vendor }))} />
      <details className="evaluation-advanced" data-tour="advanced"><summary>Advanced settings</summary>
        <label>Attempts per task<input type="number" min={1} max={Math.max(1,maxAttempts)} value={attempts} onChange={e=>setAttempts(Number(e.target.value))}/></label>
        <fieldset disabled={!configurable}><legend>Execution settings</legend>
          <label>Parallel trials per run<input type="number" min={1} step={1} value={concurrency} onChange={e=>setConcurrency(Number(e.target.value))}/></label>
          <label>Retries per trial error<input type="number" min={0} step={1} value={retries} onChange={e=>setRetries(Number(e.target.value))}/></label>
          <label>CPUs per trial<input type="number" min={1} step={1} placeholder="Task requirement" value={cpus} onChange={e=>setCpus(e.target.value)}/></label>
          <label>RAM per trial (MiB)<input type="number" min={1} step={1} placeholder="Task requirement" value={memory} onChange={e=>setMemory(e.target.value)}/></label>
          <label>Run deadline (minutes)<input type="number" min={0.5} step="any" placeholder="Use profile deadline" value={deadline} onChange={e=>setDeadline(e.target.value)}/></label>
        </fieldset>
        {!configurable && <p className="report-notice">Select combinations on an updated worker to configure parallel trials and resources. Older workers run one trial at a time.</p>}
        <p className="report-muted">Parallel trials share the Docker engine's resources. Leave CPU and RAM blank to keep task requirements; overrides change benchmark conditions. Harness/model combinations run sequentially. Retries can add model charges. The deadline applies to each whole run, including retries.</p>
      </details>
      {settingsError && <p role="alert">{settingsError}</p>}
      {!!matrix.length && <p>{matrix.length} combinations · {trials} total trials · up to {maxAttempts} attempts approved per task</p>}
      {matrix.filter(c=>!c.profile).map(c=><p className="report-notice" key={`${c.agent}/${c.model}`}>{agentLabel(c.agent)} + {c.model} is not configured for {vendorFor(c.model)} on this worker. Choose another combination.</p>)}
      {(attempts<1 || attempts>maxAttempts) && models.length>0 && <p role="alert">Choose between 1 and {maxAttempts} attempts for this selection.</p>}
      </>}
    </div><aside className="evaluation-run-summary" data-tour="summary" aria-label="Run summary"><h3>Run summary</h3>
      <label>Experiment name<input maxLength={120} placeholder="Name this experiment" value={title} onChange={e=>setTitle(e.target.value)}/></label>
      <p>{machine?.name} · {benchmarkFor(taskSet)?.title ?? review[0]?.benchmark}</p>
      {!matrix.length && <p>Select harnesses and models to preview your run.</p>}
      <div className="evaluation-table-wrap"><table><caption>Combinations to run</caption><thead><tr><th>Harness</th><th>Model</th><th>Vendor</th><th>Trials</th><th>Run deadline</th></tr></thead><tbody>{review.map(p=><tr key={p.id}><td>{agentLabel(p.agent)}</td><td>{p.model}</td><td>{p.vendor}</td><td>{p.tasks} × {attempts}</td><td>{!settingsError && Number.isSafeInteger(attempts) && attempts >= 1 && attempts <= maxAttempts ? `${Math.ceil(executionTimeoutSeconds(p, attempts, settings)/60).toLocaleString()} min` : '—'}</td></tr>)}</tbody></table></div>
      <p><strong>{trials} trials, up to {settings?.concurrency ?? 1} at a time within each run.</strong> Each combination produces a report in this experiment. You can close the tab and return later.</p>
      {settings && <p>Per trial: {settings.cpus ? `${settings.cpus} CPUs` : 'task CPU requirement'}, {settings.memoryMb ? `${settings.memoryMb} MiB RAM` : 'task RAM requirement'}. Up to {settings.retries} retries per trial error. {settings.cpus && settings.memoryMb ? `At full concurrency: ${settings.cpus * settings.concurrency} CPUs and ${settings.memoryMb * settings.concurrency} MiB RAM, plus worker and Docker overhead.` : 'Total resource demand depends on which tasks run together.'}</p>}
      <p className="report-notice">Starting uses the worker’s model credentials and may incur inference charges. Time limits are not dollar caps. Billing is not yet reconciled with the Gateway; missing cost remains unknown.</p>
      {!ready && <p role="alert">{machine && !machine.enabled ? 'This worker is switched off. Switch it on in Runner setup before starting.' : 'The worker went offline. Reconnect it before starting.'}</p>}
    {error && <p role="alert">{error}</p>}
    <button className="primary" disabled={busy || !title.trim() || !valid} onClick={()=>void submit()}>{busy?'Creating experiment…':'Start experiment'}</button>
    </aside></div>
  </section>
}

function Experiment({ id, now }: { id: Id<'experiments'>; now: number }) {
  const experiment = useQuery(api.experiments.get,{id}), cancel = useMutation(api.experiments.cancel)
  const [error,setError]=useState(''), [busy,setBusy]=useState(false)
  if (!experiment) return <p role="status">Loading experiment…</p>
  const finished=experiment.cells.filter(c=>done(c.status)).length
  const complete=finished===experiment.cells.length
  return <>
    <div className="report-intro"><a href="/evaluations">← All experiments</a><h1>{experiment.title}</h1><p>{experiment.machine} · {finished} of {experiment.cells.length} runs finished</p></div>
    {experiment.setup && <section className="report-card" aria-label="Worker check"><h2>Worker check</h2><p role="status">{experiment.setup.message || experiment.setup.phase}</p><p className="report-muted">Your model task starts only after this free check passes.</p>{experiment.setup.report && <a href={`/reports?id=${experiment.setup.report}`}>View check result</a>}</section>}
    <ol className="evaluation-steps" aria-label="Evaluation progress"><li data-complete="true"><span>1</span>Configure</li><li aria-current={!complete?'step':undefined} data-complete={complete?'true':undefined}><span>2</span>Run</li><li aria-current={complete&&!!experiment.report?'step':undefined} data-complete={experiment.report?'true':undefined}><span>3</span>Inspect</li><li><span>4</span>Publish</li></ol>
    {(!experiment.online || now-experiment.lastSeen >= RUNNER_ONLINE_MS) && finished<experiment.cells.length && <p className="report-notice">Worker offline. Queued work waits for reconnection; running work may still be executing there. No duplicate run will be started.</p>}
    <progress aria-label="Experiment progress" value={finished} max={experiment.cells.length}/>
    {error && <p role="alert">{error}</p>}
    <section className="report-card" aria-label="Experiment results"><h2>Results by harness and model</h2><p>Expand a run to inspect its metrics and saved report. All runs use the same task snapshot; partial and failed results stay visible.</p>
      <div className="evaluation-results">{experiment.cells.map(c=><div key={c.id} className="evaluation-run-card"><details className="run-accordion">
        <summary><span className="run-accordion-title"><strong>{agentLabel(c.profile.agent)}</strong><small>{c.profile.model}</small></span><span className="report-badge" data-tone={c.status==='completed'?'success':c.status==='failed'?'danger':undefined}>{c.status}</span><span className="run-accordion-score">{c.result ? `${c.result.passed} / ${c.result.trials} passed`:'Awaiting results'}</span></summary>
        <div className="run-accordion-body"><p>{c.profile.vendor} · {c.profile.tasks} tasks × {c.attempts} attempts</p><p>{c.message || c.phase}</p><p>Up to {c.runSettings?.concurrency ?? 1} parallel trials; {c.runSettings?.retries ?? 0} retries per trial error. CPU: {c.runSettings?.cpus ?? 'task default'}. RAM: {c.runSettings?.memoryMb ? `${c.runSettings.memoryMb} MiB` : 'task default'}. Deadline: {Math.ceil(executionTimeoutSeconds(c.profile, c.attempts, c.runSettings ?? undefined) / 60)} min.</p>
          <dl className="evaluation-metrics"><div><dt>Median successful task</dt><dd>{c.result?.medianSeconds != null ? `${c.result.medianSeconds.toFixed(2)} s`:'—'}</dd></div><div><dt>Reported cost*</dt><dd>{c.result?.reportedCost != null ? `$${c.result.reportedCost.toFixed(4)}`:'Unknown'}</dd></div><div><dt>Input tokens</dt><dd>{c.result?.inputTokens?.toLocaleString() ?? 'Unknown'}</dd></div><div><dt>Output tokens</dt><dd>{c.result?.outputTokens?.toLocaleString() ?? 'Unknown'}</dd></div><div><dt>Harness version</dt><dd>{c.result?.versions?.join(', ') || 'Unknown'}</dd></div></dl>
          {c.report ? <a href={`/reports?id=${c.report}`}>Inspect this run</a>:<p>Waiting for results</p>}
        </div>
      </details><LiveRunMonitor id={c.id} status={c.status} now={now} lastSeen={experiment.lastSeen}/></div>)}</div>
      <p className="report-muted">*Harness-reported cost is unverified against Gateway billing. Unknown is not zero. Median time includes only successful recorded trials and excludes setup. Token counts are reported by the harness; raw trajectories remain on the worker.</p>
      {finished<experiment.cells.length && <button className="secondary" disabled={busy} onClick={async()=>{setBusy(true);try{await cancel({id})}catch(e){setError(message(e))}finally{setBusy(false)}}}>Cancel unfinished runs</button>}
    </section>
    {experiment.report ? <ExperimentReport id={experiment.report} /> : complete && <section className="report-card"><h2>No combined result is available</h2><p>A combined report requires reportable trials that fit within report storage limits. Inspect the individual run reports and messages above.</p></section>}
  </>
}
function Evaluations() {
  const machines=useQuery(api.runners.list), experiments=useQuery(api.experiments.list)
  const [now,setNow]=useState(Date.now)
  useEffect(()=>{const timer=setInterval(()=>setNow(Date.now()),5000);return()=>clearInterval(timer)},[])
  const id=new URLSearchParams(location.search).get('experiment') as Id<'experiments'> | null
  if(id) return <Experiment id={id} now={now}/>
  return <>
    <PageHeader title="Evaluations">Configure a run or view your results.</PageHeader>
    {machines===undefined ? <p role="status">Loading computer options…</p>:machines.some(m=>!m.revoked&&m.profiles.some(p=>!p.setupCheck&&p.taskSet&&p.vendor&&p.maxAttempts!==undefined))?<Wizard machines={machines.filter(m=>!m.revoked)} now={now}/>:<section className="report-card evaluation-empty"><h2>Ready for your first evaluation?</h2><p>Connect a computer and model provider to get started.</p><a className="report-button primary" href="/machines?setup=1">Set up my computer</a></section>}
    {machines && experiments && <IndividualRuns machines={machines} setupRuns={experiments.flatMap(e=>e.setupRun?[e.setupRun]:[])} now={now}/>}
    <section className="report-card" data-tour="experiments"><h2>Your evaluations</h2>{experiments===undefined ? <p>Loading experiments…</p>:!experiments.length ? <p>Your evaluations will appear here.</p>:<ul className="evaluation-history">{experiments.map(e=><li key={e.id}><a href={`/evaluations?experiment=${e.id}`}><strong>{e.title}</strong><span>{e.finished} / {e.runs} runs finished{e.failed ? ` · ${e.failed} need attention`:''}</span></a></li>)}</ul>}</section>
  </>
}
export function EvaluationApp() {
  const auth=useAppAuth(),{isLoading,isAuthenticated}=useConvexAuth()
  return <WorkspaceLayout active="evaluations">{isLoading?<p role="status">Connecting your workspace…</p>:isAuthenticated?<Evaluations/>:<section className="report-card"><h1>Create an evaluation</h1><p>Sign in to choose a worker and keep your experiments in your account.</p>{auth.configured?<button className="primary" onClick={auth.signIn}>Sign in</button>:<p>Sign-in is not configured.</p>}</section>}</WorkspaceLayout>
}
