import { useEffect, useRef, useState } from 'react'
import { useMutation, useQuery, useConvexAuth } from 'convex/react'
import type { FunctionReturnType } from 'convex/server'
import { api } from '../../convex/_generated/api'
import type { Id } from '../../convex/_generated/dataModel'
import { WorkspaceLayout } from '../reports/WorkspaceLayout'
import { useAppAuth } from '../auth'
import { message, token } from '../reports/helpers'
import { RUNNER_ONLINE_MS, terminalStates } from './protocol'
import './evaluations.css'

type Machine = FunctionReturnType<typeof api.runners.list>[number]
const agentLabel = (s: string) => ({ codex: 'Codex CLI', 'claude-code': 'Claude Code', pi: 'Pi Agent', opencode: 'OpenCode', 'terminus-2': 'Terminus 2' }[s] ?? s)
const unique = (items: string[]) => [...new Set(items)].sort()
const toggle = (items: string[], item: string) => items.includes(item) ? items.filter(i => i !== item) : [...items, item]
const done = (s: string) => (terminalStates as readonly string[]).includes(s)

function Wizard({ machines, now }: { machines: Machine[]; now: number }) {
  const create = useMutation(api.experiments.create)
  const [worker, setWorker] = useState(''), [task, setTask] = useState('')
  const [agents, setAgents] = useState<string[]>([]), [models, setModels] = useState<string[]>([])
  const [vendor, setVendor] = useState(''), [attempts, setAttempts] = useState(1), [title, setTitle] = useState('')
  const [busy, setBusy] = useState(false), [error, setError] = useState('')
  const pending = useRef<{ selection: string; id: string } | null>(null)
  const machine = machines.find(m => m.id === worker) ?? machines[0]
  const ready = !!machine && machine.ready && now-machine.lastSeen < RUNNER_ONLINE_MS
  const catalog = machine?.profiles.filter(p => !p.setupCheck && p.taskSet && p.vendor && p.maxAttempts !== undefined) ?? []
  const taskSets = [...new Map(catalog.map(p => [p.taskSet!,p])).values()]
  const taskSet = task || taskSets[0]?.taskSet || ''
  const choices = catalog.filter(p => p.taskSet === taskSet)
  const vendors = unique(choices.map(p => p.vendor!))
  const selectedVendor = vendor || vendors[0] || ''
  const matrix = agents.flatMap(agent => models.map(model => ({ agent, model, profile: choices.find(p => p.agent === agent && p.model === model && p.vendor === selectedVendor) })))
  const maxAttempts = matrix.length ? Math.min(...matrix.map(c => c.profile?.maxAttempts ?? 0)) : 0
  const trials = matrix.reduce((n,c) => n + (c.profile?.tasks ?? 0)*attempts,0)
  const valid = ready && matrix.length > 0 && matrix.length <= 10 && matrix.every(c => c.profile) && Number.isSafeInteger(attempts) && attempts >= 1 && attempts <= maxAttempts && trials <= 60
  const review = matrix.flatMap(c => c.profile ? [c.profile] : [])
  async function submit() {
    if (!machine || !title.trim() || !valid) return
    const input = { runner: machine.id, title: title.trim(), attempts, profiles: review.map(p => ({ id:p.id,digest:p.digest })) }
    const selection = JSON.stringify(input)
    pending.current = pending.current?.selection === selection ? pending.current : { selection, id: token() }
    setBusy(true);setError('')
    try { const id = await create({ ...input, requestId: pending.current.id }); window.location.assign(`/evaluations?experiment=${id}`) }
    catch(e) { setError(message(e));setBusy(false) }
  }
  return <section className="report-card evaluation-wizard" aria-label="New evaluation">
    <h2>Configure evaluation</h2>
    <div className="evaluation-config-layout"><div className="evaluation-config-fields">
      <label>Worker<select value={machine?.id ?? ''} onChange={e=>{setWorker(e.target.value);setTask('');setAgents([]);setModels([]);setVendor('');setAttempts(1)}}><option value="" disabled>Connect a worker first</option>{machines.map(m=><option key={m.id} value={m.id}>{m.name}{now-m.lastSeen>=RUNNER_ONLINE_MS?' · Offline':''}</option>)}</select></label>
      {!machines.length && <p><a href="/machines">Connect your first worker</a> to see its available tasks and model connections.</p>}
      {machine && !ready && <p role="status">This worker is {now-machine.lastSeen>=RUNNER_ONLINE_MS?'offline':`not ready: ${machine.health}`}. Reconnect it before launching.</p>}
      <fieldset><legend>Task set</legend><div className="evaluation-choices">{taskSets.map(p=><label className="evaluation-choice" key={p.taskSet}><input type="radio" name="task-set" checked={taskSet===p.taskSet} onChange={()=>{setTask(p.taskSet!);setAgents([]);setModels([]);setVendor('');setAttempts(1)}}/><span><strong>{p.benchmark}</strong><small>{p.tasks} {p.tasks===1?'task':'tasks'} · Same snapshot for every combination</small></span></label>)}</div></fieldset>
      {machine && !catalog.length && <p className="report-notice">This worker has no evaluation options yet. Run its setup check in <a href="/machines">Machines</a>, then configure task sets and a model connection using the <a href="https://github.com/MatthewFeroz/heval/blob/main/docs/three-agent-worker.md">worker setup guide</a>. Older workers need the updated CLI.</p>}
      <p className="report-muted">Task sets are installed on the worker. Credentials stay there; the browser only sees available options.</p>

      <p>Select one or more harnesses. Each runs independently against the same tasks.</p>
      <fieldset><legend>Harnesses</legend><div className="evaluation-choices">{unique(choices.map(p=>p.agent)).map(agent=><label key={agent} className="evaluation-choice"><input type="checkbox" checked={agents.includes(agent)} onChange={()=>setAgents(toggle(agents,agent))}/><span><strong>{agentLabel(agent)}</strong><small>{unique(choices.filter(p=>p.agent===agent).map(p=>p.model)).length} configured model options</small></span></label>)}</div></fieldset>
      <p role="status">{agents.length} harnesses selected</p>

      <p>Every selected harness will run each selected model. Choose one serving vendor to keep routing consistent.</p>
      <fieldset><legend>Models</legend><div className="evaluation-choices">{unique(choices.map(p=>p.model)).map(model=><label className="evaluation-choice" key={model}><input type="checkbox" checked={models.includes(model)} onChange={()=>setModels(toggle(models,model))}/><span><strong>{model}</strong><small>Uses the connection configured on this worker</small></span></label>)}</div></fieldset>
      <label>Serving vendor<select value={selectedVendor} onChange={e=>setVendor(e.target.value)}>{vendors.map(v=><option key={v}>{v}</option>)}</select></label>
      <details className="evaluation-advanced"><summary>Advanced settings</summary><label>Attempts per task<input type="number" min={1} max={Math.max(1,maxAttempts)} value={attempts} onChange={e=>setAttempts(Number(e.target.value))}/></label><p className="report-muted">Runs execute one at a time within the worker’s approved limits.</p></details>
      {!!matrix.length && <p>{matrix.length} combinations · {trials} total trials · up to {maxAttempts} attempts approved per task</p>}
      {matrix.filter(c=>!c.profile).map(c=><p className="report-notice" key={`${c.agent}/${c.model}`}>{agentLabel(c.agent)} + {c.model} is not configured for {selectedVendor} on this worker. Choose another combination.</p>)}
      {(attempts<1 || attempts>maxAttempts) && models.length>0 && <p role="alert">Choose between 1 and {maxAttempts} attempts for this selection.</p>}
      {matrix.length>10 && <p role="alert">Choose at most 10 harness/model combinations.</p>}
      {trials>60 && <p role="alert">Reduce the selection to 60 trials or fewer.</p>}
    </div><aside className="evaluation-run-summary" aria-label="Run summary"><h3>Run summary</h3>
      <label>Experiment name<input maxLength={120} placeholder="Name this experiment" value={title} onChange={e=>setTitle(e.target.value)}/></label>
      <p>{machine?.name} · {review[0]?.benchmark} · {selectedVendor}</p>
      {!matrix.length && <p>Select harnesses and models to preview your run.</p>}
      <div className="evaluation-table-wrap"><table><caption>Combinations to run</caption><thead><tr><th>Harness</th><th>Model</th><th>Trials</th><th>Run deadline</th></tr></thead><tbody>{review.map(p=><tr key={p.id}><td>{agentLabel(p.agent)}</td><td>{p.model}</td><td>{p.tasks} × {attempts}</td><td>{p.timeoutSeconds/60} min</td></tr>)}</tbody></table></div>
      <p><strong>{trials} trials, one at a time.</strong> Each combination produces a report in this experiment. You can close the tab and return later.</p>
      <p className="report-notice">Starting uses the worker’s model credentials and may incur inference charges. Time limits are not dollar caps. Billing is not yet reconciled with the Gateway; missing cost remains unknown.</p>
      {!ready && <p role="alert">The worker went offline. Reconnect it before starting.</p>}
    {error && <p role="alert">{error}</p>}
    <button disabled={busy || !title.trim() || !valid} onClick={()=>void submit()}>{busy?'Creating experiment…':'Start experiment'}</button>
    </aside></div>
  </section>
}

function Experiment({ id, now }: { id: Id<'experiments'>; now: number }) {
  const experiment = useQuery(api.experiments.get,{id}), cancel = useMutation(api.experiments.cancel)
  const [error,setError]=useState(''), [busy,setBusy]=useState(false)
  if (!experiment) return <p role="status">Loading experiment…</p>
  const finished=experiment.cells.filter(c=>done(c.status)).length
  return <>
    <div className="report-intro"><a href="/evaluations">← All experiments</a><h1>{experiment.title}</h1><p>{experiment.machine} · {finished} of {experiment.cells.length} runs finished</p></div>
    {(!experiment.online || now-experiment.lastSeen >= RUNNER_ONLINE_MS) && finished<experiment.cells.length && <p className="report-notice">Worker offline. Queued work waits for reconnection; running work may still be executing there. No duplicate run will be started.</p>}
    <progress aria-label="Experiment progress" value={finished} max={experiment.cells.length}/>
    {error && <p role="alert">{error}</p>}
    <section className="report-card" aria-label="Experiment results"><h2>Results by harness and model</h2><p>Expand a run to inspect its metrics and saved report. All runs use the same task snapshot; partial and failed results stay visible.</p>
      <div className="evaluation-results">{experiment.cells.map(c=><details className="run-accordion" key={c.id}>
        <summary><span className="run-accordion-title"><strong>{agentLabel(c.profile.agent)}</strong><small>{c.profile.model}</small></span><span className="report-badge" data-tone={c.status==='completed'?'success':c.status==='failed'?'danger':undefined}>{c.status}</span><span className="run-accordion-score">{c.result ? `${c.result.passed} / ${c.result.trials} passed`:'Awaiting results'}</span></summary>
        <div className="run-accordion-body"><p>{c.profile.vendor} · {c.profile.tasks} tasks × {c.attempts} attempts</p><p>{c.message || c.phase}</p>
          <dl className="evaluation-metrics"><div><dt>Median successful task</dt><dd>{c.result?.medianSeconds != null ? `${c.result.medianSeconds.toFixed(2)} s`:'—'}</dd></div><div><dt>Reported cost*</dt><dd>{c.result?.reportedCost != null ? `$${c.result.reportedCost.toFixed(4)}`:'Unknown'}</dd></div><div><dt>Input tokens</dt><dd>{c.result?.inputTokens?.toLocaleString() ?? 'Unknown'}</dd></div><div><dt>Output tokens</dt><dd>{c.result?.outputTokens?.toLocaleString() ?? 'Unknown'}</dd></div><div><dt>Harness version</dt><dd>{c.result?.versions?.join(', ') || 'Unknown'}</dd></div></dl>
          {c.report ? <a href={`/reports?id=${c.report}`}>Open report</a>:<p>Waiting for results</p>}
        </div>
      </details>)}</div>
      <p className="report-muted">*Harness-reported cost is unverified against Gateway billing. Unknown is not zero. Median time includes only successful recorded trials and excludes setup. Token counts are reported by the harness; raw trajectories remain on the worker.</p>
      {finished<experiment.cells.length && <button className="secondary" disabled={busy} onClick={async()=>{setBusy(true);try{await cancel({id})}catch(e){setError(message(e))}finally{setBusy(false)}}}>Cancel unfinished runs</button>}
    </section>
  </>
}
function Evaluations() {
  const machines=useQuery(api.runners.list), experiments=useQuery(api.experiments.list)
  const [now,setNow]=useState(Date.now)
  useEffect(()=>{const timer=setInterval(()=>setNow(Date.now()),5000);return()=>clearInterval(timer)},[])
  const id=new URLSearchParams(location.search).get('experiment') as Id<'experiments'> | null
  if(id) return <Experiment id={id} now={now}/>
  return <>
    <div className="report-intro"><span className="report-eyebrow">EVALUATIONS</span><h1>Design your next experiment.</h1><p>Choose tasks, harnesses and models. Your worker executes the combinations; Heval keeps the results together.</p></div>
    {machines===undefined ? <p role="status">Loading worker options…</p>:<Wizard machines={machines.filter(m=>!m.revoked)} now={now}/>}
    <section className="report-card"><h2>Your experiments</h2>{experiments===undefined ? <p>Loading experiments…</p>:!experiments.length ? <p>Your first experiment will appear here. Earlier individual runs remain in <a href="/machines">Machines</a>.</p>:<ul className="evaluation-history">{experiments.map(e=><li key={e.id}><a href={`/evaluations?experiment=${e.id}`}><strong>{e.title}</strong><span>{e.finished} / {e.runs} runs finished{e.failed ? ` · ${e.failed} need attention`:''}</span></a></li>)}</ul>}</section>
  </>
}
export function EvaluationApp() {
  const auth=useAppAuth(),{isLoading,isAuthenticated}=useConvexAuth()
  return <WorkspaceLayout active="evaluations">{isLoading?<p role="status">Connecting your workspace…</p>:isAuthenticated?<Evaluations/>:<section className="report-card"><h1>Create an evaluation</h1><p>Sign in to choose a worker and keep your experiments in your account.</p>{auth.configured?<button onClick={auth.signIn}>Sign in</button>:<p>Sign-in is not configured.</p>}</section>}</WorkspaceLayout>
}
