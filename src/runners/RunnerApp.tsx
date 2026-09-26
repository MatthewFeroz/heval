import { useEffect, useState } from 'react'
import { useConvexAuth, useMutation, useQuery } from 'convex/react'
import { api } from '../../convex/_generated/api'
import { useAppAuth } from '../auth'
import { message } from '../reports/helpers'
import { PageHeader } from '../reports/PageHeader'
import { WorkspaceLayout } from '../reports/WorkspaceLayout'
import { MAX_WORKERS, RUNNER_ONLINE_MS } from './protocol'
import { MachineRow } from './MachineRow'
import { localSetupUrl } from './setupLink'
import { FirstSmokeTest } from '../onboarding/FirstSmokeTest'
import { useFirstSmokeGuide } from '../onboarding/useFirstSmokeGuide'

function Workspace({ localLink }: { localLink: string | null }) {
  const machines=useQuery(api.runners.list), guide=useFirstSmokeGuide(), revoke=useMutation(api.runners.revoke)
  const [now,setNow]=useState(Date.now), [revokeId,setRevokeId]=useState<string|null>(null)
  const [busy,setBusy]=useState(false), [error,setError]=useState(''), [closed,setClosed]=useState(false)
  useEffect(()=>{const timer=setInterval(()=>setNow(Date.now()),5000);return()=>clearInterval(timer)},[])
  const params=new URLSearchParams(location.search), worker=params.get('worker')
  const active=machines?.filter(m=>!m.revoked)??[]
  const showSetup=!closed && (!!localLink || params.has('setup') || guide.visible || !active.length)
  const forSetup=worker?active.filter(m=>m.id===worker):localLink||params.get('setup')==='new'?[]:active
  const close=()=>{guide.close('completed',3);setClosed(true);history.replaceState(null,'','/machines')}
  async function disconnect(id: NonNullable<typeof machines>[number]['id']) {
    setBusy(true);setError('')
    try {await revoke({id});setRevokeId(null)} catch(e) {setError(message(e))} finally {setBusy(false)}
  }
  return <>
    <PageHeader title={showSetup?'Set up your computer':'Your computers'}>{showSetup?'Four steps to your first result.':'Manage the computers that run your evaluations.'}</PageHeader>
    {error && <p role="alert">{error}</p>}
    {machines===undefined?<p role="status">Loading computers…</p>:showSetup?<>
      <FirstSmokeTest machines={forSetup} now={now} localLink={localLink} onClose={close}/>
      {active.length>0 && <p className="setup-management-link"><button className="secondary" onClick={()=>{setClosed(true);history.replaceState(null,'','/machines')}}>Manage connected computers</button></p>}
    </>:<section className="report-card runner-connected" data-tour="machines" aria-label="Connected machines">
      <div className="report-section-heading"><h2>Your computers</h2><a className="report-button primary" href="/evaluations">Create evaluation</a></div>
      <ul className="runner-machines">{active.map(m=><MachineRow key={m.id} worker={m} online={now-m.lastSeen<RUNNER_ONLINE_MS} options={m.profiles.filter(p=>!p.setupCheck).length} onDisconnect={()=>setRevokeId(m.id)} onError={e=>setError(message(e))}>
        {revokeId===m.id && <div className="report-confirm"><p>Disconnect {m.name}? Queued runs are cancelled. Running containers on an offline computer may need to be stopped there.</p><button disabled={busy} onClick={()=>void disconnect(m.id)}>Disconnect computer</button><button className="secondary" onClick={()=>setRevokeId(null)}>Keep connected</button></div>}
        <a className="runner-setup-link" href={`/machines?setup=1&provider=1&worker=${m.id}`}>Model provider</a>
      </MachineRow>)}</ul>
      <div className="report-actions">{active.length<MAX_WORKERS?<a className="report-button secondary" href="/machines?setup=new">Add computer</a>:<p>All {MAX_WORKERS} computer slots are in use.</p>}</div>
    </section>}
  </>
}

export function RunnerApp() {
  const auth=useAppAuth(), {isLoading,isAuthenticated}=useConvexAuth()
  // Capture and remove the local capability before sign-in builds its return URL.
  const [localLink]=useState(()=>{
    const value=new URLSearchParams(location.hash.slice(1)).get('worker')
    if(value!==null){const link=localSetupUrl(value);history.replaceState(null,'',location.pathname+location.search);if(link)sessionStorage.setItem('heval.setup.local',link);else sessionStorage.removeItem('heval.setup.local');return link}
    return localSetupUrl(sessionStorage.getItem('heval.setup.local')??'')
  })
  return <WorkspaceLayout active="machines">{isLoading?<p role="status">Connecting your workspace…</p>:isAuthenticated?<Workspace localLink={localLink}/>:<section className="report-card"><h1>Connect your computer</h1><p>Sign in to save evaluations to your account.</p>{auth.configured?<button className="primary" onClick={auth.signIn}>Sign in</button>:<p>Sign-in is not configured.</p>}</section>}</WorkspaceLayout>
}
