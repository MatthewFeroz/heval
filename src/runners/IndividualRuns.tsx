import { useState } from 'react'
import { useMutation, useQuery } from 'convex/react'
import type { FunctionReturnType } from 'convex/server'
import type { Id } from '../../convex/_generated/dataModel'
import { api } from '../../convex/_generated/api'
import { message } from '../reports/helpers'
import { RUNNER_ONLINE_MS } from './protocol'

type Machine=FunctionReturnType<typeof api.runners.list>[number]
/** Older individual runs stay accessible here; Runner Setup only manages computers. */
export function IndividualRuns({machines,setupRuns,now}:{machines:Machine[];setupRuns:string[];now:number}){
 const runs=useQuery(api.runners.runs), cancel=useMutation(api.runners.cancel), move=useMutation(api.runners.moveQueued)
 const [error,setError]=useState(''),[busy,setBusy]=useState(false)
 const individual=runs?.filter(r=>!r.experiment&&!setupRuns.includes(r.id))??[]
 async function act(action:()=>Promise<unknown>){setBusy(true);setError('');try{await action()}catch(e){setError(message(e))}finally{setBusy(false)}}
 if(!individual.length)return null
 return <section className="report-card" aria-label="Individual evaluations"><h2>Individual evaluations</h2>{error&&<p role="alert">{error}</p>}<ol className="runner-runs">{individual.map(run=><li key={run.id} data-run-id={run.id}>
  <div className="report-section-heading"><strong>{run.profile.title}</strong><span className="report-badge">{run.status}</span></div>
  <p>{machines.find(m=>m.id===run.runner)?.name??'Disconnected computer'} · {run.message||run.phase}</p>
  <div className="report-actions">{run.report&&<a href={`/reports?id=${run.report}`}>Open saved report</a>}{['queued','running'].includes(run.status)&&<button className="secondary" disabled={busy} onClick={()=>void act(()=>cancel({id:run.id}))}>Cancel evaluation</button>}</div>
  {run.status==='queued'&&<label>Move queued evaluation<select value="" disabled={busy} onChange={e=>{const runner=e.target.value as Id<'runners'>;if(runner)void act(()=>move({id:run.id,runner}))}}><option value="">Choose another computer</option>{machines.filter(m=>m.id!==run.runner&&!m.revoked&&m.enabled&&m.ready&&now-m.lastSeen<RUNNER_ONLINE_MS&&m.profiles.some(p=>p.id===run.profile.id&&p.digest===run.profile.digest)).map(m=><option key={m.id} value={m.id}>{m.name}</option>)}</select></label>}
 </li>)}</ol></section>
}
