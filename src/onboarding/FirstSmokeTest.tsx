import { useEffect, useState } from 'react'
import { useMutation, useQuery } from 'convex/react'
import type { FunctionReturnType } from 'convex/server'
import { Check, Copy, Monitor, Plug, KeyRound, Play } from 'lucide-react'
import { api } from '../../convex/_generated/api'
import { HARNESS } from '../harnesses'
import { message, token } from '../reports/helpers'
import { localSetupUrl } from '../runners/setupLink'
import { firstSmokeProgress, SMOKE_STEPS } from './firstSmoke'
import './onboarding.css'

type Machine = FunctionReturnType<typeof api.runners.list>[number]
const titles = ['Set up your machine', 'Connect your computer', 'Connect your model provider', 'Run your first evaluation']
const icons = [Monitor, Plug, KeyRound, Play]
const command = 'npx @mattferoz/heval@latest setup --harnesses codex'

export function SetupCommand() {
  const [copied, setCopied] = useState(false), [error, setError] = useState('')
  return <><div className="first-smoke-copy"><code>{command}</code><button className="secondary" aria-label="Copy setup command" onClick={() => void navigator.clipboard.writeText(command).then(() => { setCopied(true); setError('') }, () => setError('Copy the command above into your terminal.'))}>{copied ? <Check size={16}/> : <Copy size={16}/>}{copied ? 'Copied' : 'Copy'}</button></div>{error && <p role="status">{error}</p>}</>
}

export function FirstSmokeTest({ machines, now, localLink, onClose }: { machines: Machine[]; now: number; localLink: string | null; onClose: () => void }) {
  const runs = useQuery(api.runners.runs)
  const pair = useMutation(api.runners.createPairing), create = useMutation(api.experiments.create), enable = useMutation(api.runners.setEnabled)
  const [installed, setInstalled] = useState(() => !!localLink || sessionStorage.getItem('heval.setup.installed') === 'yes')
  const [name, setName] = useState('My computer'), [link, setLink] = useState(localLink ?? '')
  const [busy, setBusy] = useState(false), [error, setError] = useState(''), [reopen, setReopen] = useState(false)
  const [back, setBack] = useState(false)
  const [manual, setManual] = useState(false), [pairing, setPairing] = useState<{code:string;expiresAt:number}|null>(null)
  const pairedWorker = useQuery(api.runners.pairingStatus, pairing ? { code: pairing.code } : 'skip')
  useEffect(() => {
    if (pairedWorker) location.replace(`/machines?setup=1&worker=${pairedWorker}`)
  }, [pairedWorker])
  const progress = firstSmokeProgress({ machines, runs: runs ?? [], now, installed })
  const { machine, profile, checkProfile, smokeRun, online, switchedOff } = progress
  const providerOnly = new URLSearchParams(location.search).has('provider') && !!machine
  const step = providerOnly ? 'provider' : back && !machine ? 'install' : progress.current
  const index = step ? SMOKE_STEPS.indexOf(step) : 3
  const harness = HARNESS[progress.harness]?.name ?? progress.harness
  const validLink = localSetupUrl(link)
  const ready = machine && online && machine.ready && !switchedOff
  const ongoing = smokeRun && ['queued','running','cancelling'].includes(smokeRun.status)
  async function act(action: () => Promise<unknown>) {
    setBusy(true); setError('')
    try { await action() } catch (e) { setError(message(e)) } finally { setBusy(false) }
  }
  async function connect() {
    if (!validLink) return
    const code = token()
    await pair({name:name.trim(),code})
    const callback = new URL(validLink), hash = new URLSearchParams(callback.hash.slice(1))
    hash.set('pairing',code); hash.set('deployment',import.meta.env.VITE_CONVEX_URL ?? ''); hash.set('returnTo',`${location.origin}/machines?setup=1`)
    callback.hash=hash.toString()
    sessionStorage.removeItem('heval.setup.local')
    location.assign(callback.href)
  }
  async function start() {
    if (!machine || !profile || !checkProfile) return
    const key = `heval.first-run.${machine.id}.${profile.digest}`
    const requestId = sessionStorage.getItem(key) ?? token()
    sessionStorage.setItem(key,requestId)
    const id = await create({runner:machine.id,title:`${harness} first evaluation`,attempts:1,requestId,profiles:[{id:profile.id,digest:profile.digest}],checkWorker:true})
    sessionStorage.removeItem(key)
    location.assign(`/evaluations?experiment=${id}`)
  }
  return <section className="first-smoke" aria-label="Computer setup" data-tour="setup">
    <ol className="setup-progress" aria-label="Setup progress">{SMOKE_STEPS.map((id,i) => <li key={id} aria-current={i===index && step ? 'step' : undefined} data-done={progress.done[id]}><span>{progress.done[id] ? <Check size={16} aria-hidden="true"/> : i+1}</span><span>{['Machine','Connection','Provider','First evaluation'][i]}</span></li>)}</ol>
    <div className="report-card setup-stage">
      <div className="setup-stage-heading">{(() => { const Icon=icons[index]; return <Icon size={24} aria-hidden="true"/> })()}<span className="report-eyebrow">{step ? `STEP ${index+1} OF 4` : 'READY'}</span></div>
      <h2>{step ? titles[index] : 'Your first evaluation is ready'}</h2>
      {runs===undefined ? <p role="status">Checking your computer…</p> : <>
      {step==='install' && <>
        <p>Run this on the computer that will do the work. Setup prepares Docker and opens the next step.</p>
        <SetupCommand/>
        <p className="report-muted">Requires Node.js 22+. First setup downloads several GB.</p>
        <p className="report-muted">Preview: use a <a href="https://github.com/MatthewFeroz/heval/blob/main/docs/connected-runners.md">setup-enabled CLI build</a> until the next npm release.</p>
        <button className="primary" onClick={() => {sessionStorage.setItem('heval.setup.installed','yes');setInstalled(true);setBack(false)}}>Setup is open</button>
      </>}
      {step==='connect' && <>
        {manual ? <>
          <p>Connect an existing Linux worker with a one-time code.</p>
          <label>Computer name<input value={name} maxLength={80} onChange={e=>setName(e.target.value)}/></label>
          <button className="primary" disabled={busy||!name.trim()} onClick={()=>void act(async()=>{const code=token();setPairing({code,...await pair({name:name.trim(),code})})})}>{pairing?'Create a new code':'Create pairing code'}</button>
          {pairing && now<pairing.expiresAt ? <>
            <label>Deployment URL<input readOnly value={import.meta.env.VITE_CONVEX_URL??''} onFocus={e=>e.target.select()}/></label>
            <label>One-time pairing code<input readOnly value={pairing.code} onFocus={e=>e.target.select()}/></label>
            <p>Use these with <code>heval runner connect</code>, then run <code>heval runner start</code>. The code expires in 10 minutes.</p>
          </>:pairing&&<p role="status">This code expired. Create a new code.</p>}
          <button className="secondary" onClick={()=>setManual(false)}>Use local setup instead</button>
        </> : <>
        <p>{validLink ? 'Allow this computer to run evaluations for your account.' : 'In the local setup page, choose Connect to Heval to bring this computer here.'}</p>
        {validLink ? <><label>Computer name<input value={name} maxLength={80} onChange={e=>setName(e.target.value)}/></label><button className="primary" disabled={busy||!name.trim()} onClick={()=>void act(connect)}>Connect computer</button></> : <>
          <label>Or paste the setup link from your terminal<input type="url" value={link} onChange={e=>setLink(e.target.value)} placeholder="http://127.0.0.1:PORT/#token=…" autoComplete="off" spellCheck={false}/></label>
          {link && !validLink && <p role="alert">Use the complete 127.0.0.1 setup link, including its token.</p>}
        </>}
        <button className="secondary" onClick={()=>setManual(true)}>Use a pairing code instead</button>
        </>}
        <button className="secondary" onClick={()=>setBack(true)}>Back</button>
      </>}
      {step==='provider' && <>
        <p>Connect Merge Gateway in the local setup page. Choose a model and keep {harness} selected.</p>
        <p className="report-muted">Your key stays on this computer.</p>
        {validLink ? <a className="report-button primary" href={validLink}>Open local setup</a> : <button className="secondary" onClick={()=>setReopen(!reopen)}>{reopen?'Hide command':'Reopen setup'}</button>}
        {reopen && <SetupCommand/>}
        <p role="status">Waiting for {machine?.name} to share its model connection…</p>
      </>}
      {step==='run' && profile && <>
        <p>{machine?.name} is configured. We’ll check the worker, then run {profile.tasks===1?'one task':`${profile.tasks} tasks`}.</p>
        <dl className="setup-review"><div><dt>Harness</dt><dd>{harness}</dd></div><div><dt>Model</dt><dd>{profile.model}</dd></div></dl>
        <p className="report-muted">The worker check is free. The evaluation uses your provider credits.</p>
        {ongoing ? <a className="report-button primary" href={`/evaluations?experiment=${smokeRun.experiment}`}>View evaluation</a> : <button className="primary" disabled={busy||!ready||!checkProfile} onClick={()=>void act(start)}>{busy?'Starting…':smokeRun?'Try first evaluation again':'Run my first evaluation'}</button>}
        {!checkProfile && <p role="alert">Reopen setup to add the worker check before starting.</p>}
      </>}
      {!step && <><p>Your computer and model connection are working.</p><a className="report-button primary" href={`/evaluations?experiment=${smokeRun?.experiment}`}>View results</a><button className="secondary" onClick={onClose}>Manage computers</button></>}
      </>}
      {machine && !online && <p role="status">{machine.name} is offline. Start Docker and reopen setup to reconnect.</p>}
      {machine && switchedOff && <div className="report-actions"><p>{machine.name} is switched off.</p><button disabled={busy} onClick={()=>void act(()=>enable({id:machine.id,enabled:true}))}>Switch on</button></div>}
      {machine && online && !machine.ready && <p role="status">{machine.health}</p>}
      {error && <p role="alert">{error}</p>}
    </div>
  </section>
}
