import { useEffect, useRef, useState } from 'react'
import { useConvexAuth, useMutation, useQuery } from 'convex/react'
import { api } from '../../convex/_generated/api'
import type { Id } from '../../convex/_generated/dataModel'
import { useAppAuth } from '../auth'
import { message, token } from '../reports/helpers'
import { RUNNER_ONLINE_MS } from './protocol'
import { WorkspaceLayout } from '../reports/WorkspaceLayout'

function Workspace() {
  const machines = useQuery(api.runners.list), runs = useQuery(api.runners.runs)
  const pair = useMutation(api.runners.createPairing), enqueue = useMutation(api.runners.enqueue), cancel = useMutation(api.runners.cancel), revoke = useMutation(api.runners.revoke), move = useMutation(api.runners.moveQueued)
  const [name, setName] = useState('My Linux machine'), [pairing, setPairing] = useState<{ code: string; expiresAt: number } | null>(null)
  const [machineId, setMachineId] = useState(''), [profileId, setProfileId] = useState('')
  const [busy, setBusy] = useState(false), [error, setError] = useState(''), [status, setStatus] = useState('')
  const [now, setNow] = useState(Date.now), [revokeId, setRevokeId] = useState<string | null>(null)
  const pending = useRef<{ selection: string; requestId: string } | null>(null)
  useEffect(() => { const timer = setInterval(() => setNow(Date.now()), 5000); return () => clearInterval(timer) }, [])
  const active = machines?.filter(m => !m.revoked) ?? []
  const selected = active.find(m => m.id === machineId) ?? active[0]
  const profile = selected?.profiles.find(p => p.id === profileId) ?? selected?.profiles.find(p => p.setupCheck) ?? selected?.profiles[0]
  const online = (m: { lastSeen: number }) => now - m.lastSeen < RUNNER_ONLINE_MS
  async function act(run: () => Promise<unknown>, success: string) {
    setBusy(true); setError(''); setStatus('')
    try { await run(); setStatus(success) } catch (e) { setError(message(e)) } finally { setBusy(false) }
  }
  async function start() {
    if (!selected || !profile) return
    const selection = `${selected.id}/${profile.id}/${profile.digest}`
    pending.current = pending.current?.selection === selection ? pending.current : { selection, requestId: token() }
    await enqueue({ runner: selected.id, profileId: profile.id, digest: profile.digest, requestId: pending.current.requestId })
    pending.current = null
  }
  return <>
    <div className="report-intro"><span className="report-eyebrow">RUNNER SETUP</span><h1>Connect the machine.<br />Run from Evaluations.</h1><p>Pair a Linux computer or cloud VM and verify it here. Then create and follow full comparisons from Evaluations; results also remain in Report library.</p><ol className="report-steps"><li>Connect a runner</li><li>Run a setup check</li><li>Create an evaluation</li></ol></div>
    {error && <p role="alert">{error}</p>}{status && <p role="status">{status}</p>}
    <div className="runner-grid"><section className="report-card" aria-label="Connect a machine"><h2>Connect a machine</h2><p>The machine needs Linux, Docker Engine with Compose, and Harbor 0.23.0. Its runner makes an outbound connection; you don’t need to open a port.</p>
      <p><a href="https://github.com/MatthewFeroz/heval/blob/main/docs/connected-runners.md" target="_blank" rel="noreferrer">Install the runner preview and set up Linux ↗</a></p>
      <label>Machine name<input value={name} maxLength={80} onChange={e => setName(e.target.value)} /></label>
      <button disabled={busy || !name.trim()} onClick={() => void act(async () => { const code = token(); const result = await pair({ name, code }); setPairing({ code, ...result }) }, 'Pairing code ready. Complete the connection on your machine.')}>Create pairing code</button>
      {pairing && <div className="report-import-preview"><h3>On the machine that will run Harbor</h3><p>With the runner preview installed, run:</p><pre><code>{`heval runner connect --url ${import.meta.env.VITE_CONVEX_URL}`}</code></pre>
        <label>One-time pairing code<input readOnly value={pairing.code} onFocus={e => e.target.select()} /></label><button className="secondary" disabled={now >= pairing.expiresAt} onClick={() => void act(() => navigator.clipboard.writeText(pairing.code), 'Pairing code copied.')}>Copy pairing code</button>
        <p className="report-muted">{now >= pairing.expiresAt ? 'Expired. Create a new pairing code.' : 'Paste it into the terminal when asked. It expires in 10 minutes and connects one machine.'}</p>
        <p>Then keep the runner connected:</p><pre><code>heval runner start</code></pre><p>You can install it as a Linux service so it reconnects after reboot. Keep each machine’s runner state on that machine.</p>
      </div>}
    </section>
    <section className="report-card" aria-label="Connected machines"><h2>Your machines</h2>{machines === undefined ? <p>Loading machines…</p> : !active.length ? <p>No connected machines yet. Create a pairing code above.</p> : <ul className="runner-machines">{active.map(m => <li key={m.id}><div><strong>{m.name}</strong><span className="report-badge" data-tone={online(m) ? m.ready ? 'success' : 'warning' : undefined}>{online(m) ? m.ready ? 'Online' : 'Needs setup' : 'Offline'}</span><p>{online(m) ? m.health : 'Waiting for this machine to reconnect. Existing work will not be restarted elsewhere.'}</p><small>{m.profiles.length} approved profiles{m.activeRun ? ' · One active evaluation' : ''}</small></div><button className="secondary" onClick={() => setRevokeId(m.id)}>Disconnect</button>
      {revokeId === m.id && <div className="report-confirm"><p>Revoke this machine’s connection? Queued runs will be cancelled. Check the physical machine for running containers; revocation cannot guarantee they stop while offline.</p><button disabled={busy} onClick={() => void act(async () => { await revoke({ id: m.id }); setRevokeId(null) }, 'Machine connection revoked.')}>Revoke machine access</button><button className="secondary" onClick={() => setRevokeId(null)}>Keep connected</button></div>}
    </li>)}</ul>}</section>
    <section className="report-card" aria-label="Start evaluation"><h2>Check your worker</h2><p>Ready to compare harnesses? <a href="/evaluations">Create a new evaluation →</a></p><p>The default setup check runs one task, one reference solution, and one attempt. It checks that your setup works. It isn’t a full benchmark score.</p>
      <label>Run on<select aria-label="Run on" value={selected?.id ?? ''} onChange={e => { setMachineId(e.target.value); setProfileId('') }}><option value="" disabled>Connect a machine first</option>{active.map(m => <option key={m.id} value={m.id}>{m.name}{online(m) ? '' : ' · Offline'}</option>)}</select></label>
      <label>Approved evaluation<select aria-label="Approved evaluation" value={profile?.id ?? ''} onChange={e => setProfileId(e.target.value)}><option value="" disabled>No approved profiles</option>{selected?.profiles.map(p => <option key={p.id} value={p.id}>{p.title}</option>)}</select></label>
      {profile && <div className="runner-review"><dl><div><dt>Benchmark</dt><dd>{profile.benchmark}</dd></div><div><dt>Agent</dt><dd>{profile.agent}</dd></div><div><dt>Model</dt><dd>{profile.model}</dd></div><div><dt>Scope</dt><dd>{profile.tasks} tasks × {profile.attempts} attempts = {profile.tasks * profile.attempts} trials</dd></div><div><dt>Limit</dt><dd>One trial at a time · {profile.timeoutSeconds / 60} minutes maximum</dd></div></dl><p>{profile.setupCheck ? 'Uses the task’s reference solution. No model API calls or model charges. Compute runs on your selected machine.' : 'Uses the credentials configured on your selected machine. You fund its compute and model calls; the time limit is not a dollar spending cap.'}</p></div>}
      <button disabled={busy || !selected || !online(selected) || !selected.ready || !profile} onClick={() => void act(start, 'Evaluation queued. You can close this tab and return from another browser.')}>{profile?.setupCheck ? 'Run setup check' : 'Start evaluation'}</button><p className="report-muted">Additional agent/model combinations are approved in the machine’s local profiles file. Browser requests can’t execute arbitrary commands on your machine.</p>
    </section>
    <section className="report-card" aria-label="Evaluation history"><h2>Your evaluations</h2><p>Work is saved to your account. Browser sessions can reconnect independently of the runner.</p>
      {runs === undefined ? <p>Loading evaluations…</p> : !runs.length ? <p>Your first setup check will appear here.</p> : <ol className="runner-runs">{runs.map(run => <li key={run.id} data-run-id={run.id}><details className="run-accordion"><summary><strong className="run-accordion-title">{run.profile.title}</strong><span className="report-badge" data-tone={run.status === 'completed' ? 'success' : run.status === 'failed' ? 'danger' : undefined}>{run.status}</span></summary><div className="run-accordion-body"><p>{machines?.find(m => m.id === run.runner)?.name ?? 'Machine'} · {run.phase}</p>{run.message && <p>{run.message}</p>}
        {(run.status === 'running' || run.status === 'cancelling') && !online(machines?.find(m => m.id === run.runner) ?? { lastSeen: 0 }) && <p className="report-notice">Machine offline. Execution may still be running there. Waiting for reconnection; no duplicate will be started.</p>}
        <div className="report-actions">{run.report && <a className="report-button" href={`/reports?id=${run.report}`}>Open saved report</a>}{(run.status === 'running' || run.status === 'queued') && <button className="secondary" disabled={busy} onClick={() => void act(() => cancel({ id: run.id }), run.status === 'queued' ? 'Queued evaluation cancelled.' : 'Stop requested. Waiting for the machine to confirm cleanup.')}>Cancel evaluation</button>}</div>
        {run.status === 'queued' && <label>Move queued evaluation<select aria-label="Move queued evaluation" value="" onChange={e => { const id = e.target.value as Id<'runners'>; if (id) void act(() => move({ id: run.id, runner: id }), 'Queued evaluation moved. It will run once on the selected machine.') }}><option value="">Choose another compatible machine</option>{active.filter(m => m.id !== run.runner && m.ready && online(m) && m.profiles.some(p => p.id === run.profile.id && p.digest === run.profile.digest)).map(m => <option key={m.id} value={m.id}>{m.name}</option>)}</select></label>}
      </div></details></li>)}</ol>}
    </section></div>
  </>
}

export function RunnerApp() {
  const auth = useAppAuth(), { isLoading, isAuthenticated } = useConvexAuth()
  return <WorkspaceLayout active="machines">{isLoading ? <p role="status">Connecting your workspace…</p> : isAuthenticated ? <Workspace /> : <section className="report-card report-welcome"><span className="report-eyebrow">YOUR CONNECTED WORKSPACE</span><h1>Your evaluations, on your machines.</h1><p>Sign in to connect a Linux computer or cloud VM. You can monitor the same evaluation from different browser sessions.</p>{auth.configured ? <button onClick={auth.signIn}>Sign in to connect a machine</button> : <p>Sign-in is not configured on this deployment.</p>}</section>}</WorkspaceLayout>
}
