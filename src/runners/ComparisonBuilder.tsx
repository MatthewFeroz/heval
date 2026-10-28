import { useRef, useState, type ReactNode } from 'react'
import { useMutation, useQuery } from 'convex/react'
import type { FunctionReturnType } from 'convex/server'
import { api } from '../../convex/_generated/api'
import type { Id } from '../../convex/_generated/dataModel'
import { comparisonGoals, starterPair, validateComparison, type ComparisonGoal } from './comparison'
import type { RunnerProfile } from './protocol'
import { RUNNER_ONLINE_MS, executionTimeoutSeconds } from './protocol'
import { benchmarkFor } from './benchmarks'
import { HARNESS } from '../harnesses'
import catalog from '../harness-catalog.json'
import { message, token } from '../reports/helpers'
import { ComparisonReview } from './ComparisonReview'

type Machine = FunctionReturnType<typeof api.runners.list>[number]
type ManagedCatalog = FunctionReturnType<typeof api.managedComparisons.catalog>
type Baseline = FunctionReturnType<typeof api.baselines.get>
const label = (id: string) => HARNESS[id]?.name ?? id

function Choice({ title, value, values, names, onChange }: { title: string; value: string; values: string[]; names?: Record<string, string>; onChange: (value: string) => void }) {
  return <label>{title}<select aria-label={title} value={value} onChange={event => onChange(event.target.value)}>
    {!values.includes(value) && <option value={value}>{value ? `${label(value)} · not configured` : 'Choose an option'}</option>}
    {values.map(id => <option value={id} key={id}>{names?.[id] ?? label(id)}</option>)}
  </select></label>
}

export function ComparisonBuilder({ machines, managed, now, baseline, customBuilder }: { machines: Machine[]; managed: ManagedCatalog; now: number; baseline?: Baseline | null; customBuilder?: ReactNode }) {
  const create = useMutation(api.experiments.create), createManaged = useMutation(api.managedComparisons.create)
  const query = new URLSearchParams(location.search)
  const [execution, setExecution] = useState<'managed' | 'connected'>(() => baseline?.execution === 'managed' || managed.available && !baseline ? 'managed' : 'connected')
  const [goal, setGoal] = useState<ComparisonGoal>(() => baseline?.goal ?? (query.has('custom') ? 'custom' : query.get('goal') === 'models' ? 'models' : 'harnesses'))
  const [worker, setWorker] = useState(''), [taskSet, setTaskSet] = useState(baseline?.taskSet ?? '')
  const [a, setA] = useState(query.get('harnessA') ?? baseline?.profiles[0]?.agent ?? '')
  const [b, setB] = useState(query.get('harnessB') ?? baseline?.profiles[1]?.agent ?? '')
  const [modelA, setModelA] = useState(baseline?.profiles[0]?.model ?? ''), [modelB, setModelB] = useState(baseline?.profiles[1]?.model ?? '')
  const [vendor, setVendor] = useState(baseline?.profiles[0]?.vendor ?? '')
  const [title, setTitle] = useState(baseline ? `${baseline.title} repeat`.slice(0, 120) : '')
  const [budget, setBudget] = useState(Math.min(2, managed.policy?.maxBudgetUsd ?? 2))
  const [minutes, setMinutes] = useState(baseline?.runSettings?.timeoutSeconds ? baseline.runSettings.timeoutSeconds / 30 : Math.min(30, managed.policy?.maxMinutes ?? 30))
  const [consent, setConsent] = useState<string | false>(false), [reviewChanges, setReviewChanges] = useState(false), [busy, setBusy] = useState(false), [error, setError] = useState('')
  const pending = useRef<{ selection: string; requestId: string } | null>(null)
  const machine = machines.find(m => m.id === worker) ?? machines.find(m => m.ready && m.enabled && now - m.lastSeen < RUNNER_ONLINE_MS) ?? machines[0]
  const profiles = machine?.profiles.filter(p => !p.setupCheck && p.taskSet && p.vendor && p.maxAttempts !== undefined && catalog.find(h => h.id === p.agent)?.merge !== false) ?? []
  const task = taskSet || starterPair(profiles, goal)[0]?.taskSet || profiles[0]?.taskSet || ''
  const choices = profiles.filter(p => p.taskSet === task)
  const defaults = execution === 'connected' ? starterPair(choices, goal) : []
  const harnesses = execution === 'managed' ? managed.policy?.harnesses ?? [] : [...new Set(choices.map(p => p.agent))]
  const models = execution === 'managed' ? managed.policy?.models ?? [] : [...new Set(choices.map(p => p.model))]
  const firstHarness = a || defaults[0]?.agent || harnesses[0] || ''
  const secondHarness = b || defaults[1]?.agent || harnesses.find(h => h !== firstHarness) || ''
  const firstModel = modelA || defaults[0]?.model || models[0] || ''
  const secondModel = modelB || defaults[1]?.model || models.find(m => m !== firstModel) || ''
  const vendors = [...new Set(choices.filter(p => p.model === firstModel && [firstHarness, ...(goal === 'harnesses' ? [secondHarness] : [])].includes(p.agent)).map(p => p.vendor!))]
  const servingVendor = vendor || defaults[0]?.vendor || vendors[0] || ''
  const pair = goal === 'harnesses' ? [[firstHarness, firstModel], [secondHarness, firstModel]] : [[firstHarness, firstModel], [firstHarness, secondModel]]
  const selected = pair.map(([agent, model]) => choices.find(p => p.agent === agent && p.model === model && (model !== firstModel || p.vendor === servingVendor)))
  const ready = !!machine && machine.enabled && machine.ready && now - machine.lastSeen < RUNNER_ONLINE_MS
  const attempts = baseline?.attempts ?? 1
  const settings = baseline?.runSettings
  let selectionError = ''
  if (execution === 'connected') {
    if (!ready) selectionError = 'Connect an online, ready worker to run this comparison.'
    else if (selected.some(p => !p)) selectionError = 'This worker needs both selected combinations on the same task snapshot. Choose configured options or add their profiles in Runner setup.'
    else try {
      validateComparison(goal, selected as RunnerProfile[])
      for (const profile of selected as RunnerProfile[]) executionTimeoutSeconds(profile, attempts, settings)
    } catch (e) { selectionError = message(e) }
  } else if (!managed.available) selectionError = !managed.configured ? 'Managed execution is not configured on this deployment yet.' : !managed.permitted ? 'Managed execution is available to invited beta accounts.' : 'Managed workers are offline. Try later or use your own worker.'
  else if (pair.some(([agent, model]) => !harnesses.includes(agent) || !models.includes(model)) || new Set(pair.map(p => JSON.stringify(p))).size !== 2) selectionError = 'Choose two distinct, approved combinations.'
  const changed = baseline && execution === 'connected' && selected.some(p => p && !baseline.profiles.some(old => old.digest === p.digest))
  const taskInfo = execution === 'managed' ? benchmarkFor(managed.policy?.taskSet) : benchmarkFor(task)
  const count = execution === 'managed' ? (managed.policy?.tasks ?? 0) * 2 : selected.every(Boolean) ? selected.reduce((sum, p) => sum + p!.tasks * attempts, 0) : null

  const consentFingerprint = JSON.stringify([execution, goal, pair, execution === 'managed' ? managed.policy?.taskSet : task, selected.map(p => p?.digest), servingVendor, attempts, settings, execution === 'managed' ? [budget, minutes] : null])
  const authorized = consent === consentFingerprint

  function switchGoal(value: ComparisonGoal) { setGoal(value); setA(''); setB(''); setModelA(''); setModelB(''); setVendor(''); setConsent(false); setReviewChanges(false) }
  async function start() {
    if (selectionError || !title.trim() || !authorized || changed && !reviewChanges || goal === 'custom') return
    const common = { title: title.trim(), ...(baseline ? { baseline: baseline._id } : {}) }
    const input = execution === 'managed' ? { ...common, spec: { goal, harnesses: goal === 'harnesses' ? [firstHarness, secondHarness] : [firstHarness], models: goal === 'models' ? [firstModel, secondModel] : [firstModel], budgetUsd: budget, minutes } } : { ...common, runner: machine!.id, attempts, goal, ...(settings ? { runSettings: settings } : {}), profiles: (selected as RunnerProfile[]).map(p => ({ id: p.id, digest: p.digest })) }
    const selection = JSON.stringify(input)
    pending.current = pending.current?.selection === selection ? pending.current : { selection, requestId: token() }
    setBusy(true); setError('')
    try {
      const requestId = pending.current.requestId
      if ('spec' in input) { const id = await createManaged({ ...input, requestId }); location.assign(`/library?managed=${id}`) }
      else { const id = await create({ ...input, requestId }); location.assign(`/library?experiment=${id}`) }
    } catch (e) { setError(message(e)); setBusy(false) }
  }

  return <section className="report-card evaluation-wizard comparison-builder" aria-label="Create a comparison">
    <h2>{baseline ? `Repeat ${baseline.title}` : 'What do you want to compare?'}</h2>
    {query.has('source') && <p className="report-notice">You’re starting a new comparison inspired by a published study. Choose an available task set and supported stacks below; this does not reproduce the study’s original conditions automatically.</p>}
    {baseline && <p className="report-notice">This run keeps the baseline task snapshot, attempts and execution settings. Your original result stays saved. <a href={`/library?report=${baseline.report}`}>Inspect baseline</a></p>}
    <fieldset data-tour="comparison-question"><legend>Comparison question</legend><div className="comparison-options comparison-goals">{comparisonGoals.filter(g => g.id !== 'custom' || customBuilder).map(g => <label className="evaluation-choice" key={g.id}><input type="radio" name="comparison-goal" checked={goal === g.id} onChange={() => switchGoal(g.id)} /><span><strong>{g.title}</strong><small>{g.description}</small></span></label>)}</div></fieldset>
    {goal === 'custom' ? <><p className="report-notice">Custom matrices run on your connected worker. Configure more combinations and execution options below.</p>{customBuilder}</> : <><fieldset><legend>Run on</legend><div className="comparison-options">
      <label className="evaluation-choice"><input type="radio" name="execution" checked={execution === 'managed'} onChange={() => {setExecution('managed'); setConsent(false)}} /><span><strong>Managed cloud</strong><small>OpenEval prepares a disposable worker. {managed.available ? 'Available for your beta account.' : managed.configured ? 'Invited beta access.' : 'Awaiting deployment configuration.'}</small></span></label>
      <label className="evaluation-choice"><input type="radio" name="execution" checked={execution === 'connected'} onChange={() => {setExecution('connected'); setConsent(false)}} /><span><strong>My worker</strong><small>Use your connected computer and provider credentials.</small></span></label>
    </div></fieldset>
    {execution === 'connected' && !profiles.length ? <section className="evaluation-empty"><h3>Connect your first comparison worker</h3><p>Start with a worker check without model credentials, then connect your provider and approve the combinations you want to compare.</p><a className="report-button primary" href="/machines?setup=1">Set up my computer</a></section> : execution === 'managed' && !managed.policy ? <section><h3>Managed execution is awaiting configuration</h3><p>This deployment needs an approved worker image and a running coordinator before it can accept cloud comparisons. You can run a comparison on your own worker now.</p><button onClick={() => setExecution('connected')}>Use my worker</button></section> : <>
    {execution === 'connected' && <><Choice title="Worker" value={machine?.id ?? ''} values={machines.map(m => m.id)} names={Object.fromEntries(machines.map(m => [m.id, m.name]))} onChange={value => {setWorker(value); setTaskSet(baseline?.taskSet ?? ''); setA(''); setB(''); setModelA(''); setModelB(''); setVendor(''); setConsent(false)}} /><p>{machine?.name ?? 'No connected worker'} · <a href="/machines?setup=1">Runner setup</a></p>
      <label>Task set<select aria-label="Task set" value={task} disabled={!!baseline} onChange={e => {setTaskSet(e.target.value); setA(''); setB(''); setModelA(''); setModelB(''); setVendor(''); setConsent(false)}}>{!choices.length && <option value={task}>{baseline ? 'Baseline task snapshot is not installed' : 'No configured task sets'}</option>}{[...new Map(profiles.map(p => [p.taskSet!, p])).values()].map(p => <option key={p.taskSet} value={p.taskSet}>{p.benchmark} · {p.tasks} tasks</option>)}</select></label></>}
    {execution === 'managed' && managed.policy && <p>{taskInfo?.title} · {managed.policy.tasks} pinned tasks · one attempt per task · one trial at a time</p>}
    {taskInfo && <p className="report-notice">{taskInfo.id === 'openeval-smoke' ? taskInfo.note : `${taskInfo.summary} ${taskInfo.note}`}</p>}
    <div className="comparison-options"><Choice title={goal === 'harnesses' ? 'First harness' : 'Harness'} value={firstHarness} values={harnesses} onChange={value => {setA(value); setConsent(false)}} />
      {goal === 'harnesses' && <Choice title="Second harness" value={secondHarness} values={harnesses.filter(h => h !== firstHarness)} onChange={value => {setB(value); setConsent(false)}} />}
      <Choice title={goal === 'models' ? 'First model' : 'Model'} value={firstModel} values={models} onChange={value => {setModelA(value); setVendor(''); setConsent(false)}} />
      {goal === 'models' && <Choice title="Second model" value={secondModel} values={models.filter(m => m !== firstModel)} onChange={value => {setModelB(value); setConsent(false)}} />}
      {execution === 'connected' && <Choice title="Serving vendor for first model" value={servingVendor} values={vendors} onChange={value => {setVendor(value); setConsent(false)}} />}
    </div>
    {execution === 'managed' && <div className="comparison-options"><label>Gateway model spend limit (USD)<input type="number" min="0.10" step="0.10" max={managed.policy?.maxBudgetUsd ?? 0} value={budget} onChange={e => {setBudget(Number(e.target.value)); setConsent(false)}} /></label><label>Comparison execution time (minutes)<input type="number" min={10} max={managed.policy?.maxMinutes ?? 60} value={minutes} disabled={!!baseline} onChange={e => {setMinutes(Number(e.target.value)); setConsent(false)}} /></label></div>}
    <label>Comparison name<input maxLength={120} value={title} onChange={e => setTitle(e.target.value)} placeholder="Codex vs Pi on the same model" /></label>
    <section className="evaluation-run-summary" aria-label="Comparison review" data-tour="comparison-review"><h3>Review comparison</h3><p>{count === null ? 'Choose two configured combinations to preview the trial count.' : `${count} task attempts.`} {goal === 'harnesses' ? 'The model and task snapshot stay fixed. Review the configured serving routes below.' : 'The harness and task snapshot stay fixed; model routes are recorded separately.'}</p>
      {(execution === 'managed' || selected.some(p => p?.vendor === 'Provider default')) && <p className="report-notice">Gateway default routing may select different serving vendors. This comparison does not establish that the serving vendor stayed fixed.</p>}
      {execution === 'connected' ? <ComparisonReview profiles={selected.filter((p): p is RunnerProfile => !!p)} attempts={attempts} settings={settings} valid={!selectionError} /> : <ul>{pair.map(([agent, model], i) => <li key={i}>{label(agent)} · {model} · Gateway default route</li>)}</ul>}
      {execution === 'managed' ? <p>Gateway enforces the temporary key’s ${Number.isFinite(budget) ? budget.toFixed(2) : '—'} model spend limit. In-flight usage can exceed the threshold. This is not an all-in dollar cap and excludes cloud compute. The worker has a separate lifetime limit that includes setup and cleanup.</p> : <p>This uses your worker’s provider credits. Worker deadlines are not dollar caps. Missing costs stay unknown.</p>}
      {changed && <label className="comparison-consent"><input type="checkbox" checked={reviewChanges} onChange={e => setReviewChanges(e.target.checked)} />I reviewed the changed worker approvals. The result will identify changed combinations and versions.</label>}
      <label className="comparison-consent"><input type="checkbox" checked={authorized} onChange={e => setConsent(e.target.checked ? consentFingerprint : false)} />I reviewed these combinations and authorize this evaluation’s compute and model use.</label>
      {selectionError && <p role="status">{selectionError}</p>}{error && <p role="alert">{error}</p>}
      <button className="primary" disabled={busy || !!selectionError || !title.trim() || !authorized || !!changed && !reviewChanges || execution === 'managed' && (!Number.isFinite(budget) || budget < 0.1 || budget > (managed.policy?.maxBudgetUsd ?? 0) || minutes < 10 || minutes > (managed.policy?.maxMinutes ?? 60))} onClick={() => void start()}>{busy ? 'Starting comparison…' : 'Run comparison'}</button>
    </section>
    </>}
    </>}
  </section>
}

export function ManagedComparisonStatus({ id, compact = false }: { id: Id<'managedComparisons'>; compact?: boolean }) {
  // Query lives in a separate component to keep hook order stable across routes.
  return <ManagedStatus id={id} compact={compact} />
}
function ManagedStatus({ id, compact }: { id: Id<'managedComparisons'>; compact: boolean }) {
  const job = useQuery(api.managedComparisons.get, { id }), cancel = useMutation(api.managedComparisons.cancel)
  const [error, setError] = useState(''), [busy, setBusy] = useState(false)
  if (!job) return <p role="status">Loading managed comparison…</p>
  return <section className="report-card">{!compact && <><a href="/library">← Library</a><h1>{job.title}</h1></>}<p role="status">{job.message}</p><p>{job.status} · ${job.spec.budgetUsd.toFixed(2)} Gateway model limit · {job.spec.minutes} execution minutes</p>
    {!['completed', 'failed', 'cancelled'].includes(job.status) && <button disabled={busy || job.status === 'stopping' || job.status === 'cleanup'} onClick={async () => { setBusy(true); try { await cancel({ id }) } catch (e) { setError(message(e)) } finally { setBusy(false) } }}>Cancel comparison</button>}
    {error && <p role="alert">{error}</p>}
  </section>
}
