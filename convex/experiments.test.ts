/// <reference types="vite/client" />
import { convexTest } from 'convex-test'
import { expect, test } from 'vitest'
import schema from './schema'
import { api } from './_generated/api'
import type { RunnerProfile } from '../src/runners/protocol'
import fixture from '../results/harbor/demo-evaluation.json'
const modules=import.meta.glob(['./**/*.ts','./**/*.js','!./**/*.test.ts'])
const key=(n:number)=>n.toString(16).padStart(64,'0')
const profiles:RunnerProfile[]=['codex','claude-code','pi'].map((agent,i)=>({id:agent,digest:key(i+1),title:agent,benchmark:'Smoke',agent,model:'deepseek/test',vendor:'particle',taskSet:key(99),maxAttempts:3,tasks:1,attempts:1,timeoutSeconds:600,setupCheck:false}))
async function setup(){
 const t=convexTest(schema,modules),owner=t.withIdentity({subject:'owner'}),other=t.withIdentity({subject:'other'})
 await owner.mutation(api.runners.createPairing,{name:'Worker',code:key(10)})
 const credential=key(11),session=key(12),claimId=key(13)
 const {id:runner}=await t.mutation(api.runners.connect,{code:key(10),credential})
 const poll=(p=profiles)=>t.mutation(api.runners.poll,{credential,session,claimId,profiles:p,ready:true,health:'Ready'})
 await poll()
 const args={runner,title:'Harness study',requestId:key(20),attempts:2,profiles:profiles.map(p=>({id:p.id,digest:p.digest}))}
 return {t,owner,other,args,poll,credential,session,claimId}
}
test('experiment atomically creates a matrix, retries idempotently, and isolates ownership',async()=>{
 const {t,owner,other,args}=await setup()
 const id=await owner.mutation(api.experiments.create,args)
 expect(await owner.mutation(api.experiments.create,args)).toBe(id)
 expect(await owner.query(api.runners.runs)).toHaveLength(3)
 expect(await other.query(api.experiments.list)).toEqual([])
 await expect(other.query(api.experiments.get,{id})).rejects.toThrow('not found')
 await expect(other.mutation(api.experiments.create,{...args,requestId:key(21)})).rejects.toThrow('not found')
 await expect(t.mutation(api.experiments.create,args)).rejects.toThrow('Sign in')
 await expect(owner.mutation(api.experiments.create,{...args,title:'changed'})).rejects.toThrow('another experiment')
})
test('stale, excessive, duplicate and incompatible selections create no partial work',async()=>{
 const {owner,args,poll}=await setup()
 await expect(owner.mutation(api.experiments.create,{...args,attempts:4})).rejects.toThrow('approved limit')
 await expect(owner.mutation(api.experiments.create,{...args,attempts:1.5})).rejects.toThrow('approved limit')
 await expect(owner.mutation(api.experiments.create,{...args,profiles:[...args.profiles,args.profiles[0]]})).rejects.toThrow('distinct')
 await expect(owner.mutation(api.experiments.create,{...args,profiles:[args.profiles[0],{id:'missing',digest:key(90)}]})).rejects.toThrow('options changed')
 await poll(profiles.map((p,i)=>i===1?{...p,taskSet:key(98)}:p))
 await expect(owner.mutation(api.experiments.create,args)).rejects.toThrow('same task set')
 expect(await owner.query(api.experiments.list)).toHaveLength(0)
 expect(await owner.query(api.runners.runs)).toHaveLength(0)
})
test('run storage capacity and readiness are checked for the entire experiment',async()=>{
 const {t,owner,args}=await setup()
 await t.run(async ctx => { for(let i=0;i<198;i++) await ctx.db.insert('runnerRuns',{owner:'owner',runner:args.runner,requestId:key(1000+i),profile:profiles[0],status:'cancelled',phase:'Cancelled'}) })
 await expect(owner.mutation(api.experiments.create,{...args,requestId:key(50)})).rejects.toThrow('run storage')
 expect(await owner.query(api.runners.runs)).toHaveLength(198)
 await t.run(ctx=>ctx.db.patch(args.runner,{lastSeen:0}))
 await expect(owner.mutation(api.experiments.create,{...args,requestId:key(51)})).rejects.toThrow('online')
})
test('requested attempts survive claims and result validation; progress survives reload',async()=>{
 const {t,owner,args,poll,credential,session,claimId}=await setup()
 const id=await owner.mutation(api.experiments.create,args)
 const run=(await poll())!
 expect(run.requestedAttempts).toBe(2)
 const one=JSON.stringify({...fixture,rows:[fixture.rows[0]]})
 await expect(t.mutation(api.runners.finish,{credential,session,claimId,id:run.id,status:'completed',json:one})).rejects.toThrow('every approved trial')
 const json=JSON.stringify({...fixture,rows:[fixture.rows[0],{...fixture.rows[0],trial:'second',attempt:2,costUsd:null}]})
 await t.mutation(api.runners.finish,{credential,session,claimId,id:run.id,status:'completed',json})
 const detail=await owner.query(api.experiments.get,{id})
 expect(detail.cells[0].result?.trials).toBe(2)
 expect(detail.cells[0].result?.reportedCost).toBeNull()
 expect(detail.cells[0].report).toBeTruthy()
 expect((await owner.query(api.experiments.list))[0].finished).toBe(1)
})
test('the final cell creates one combined experiment report',async()=>{
 const {t,owner,args,poll,credential,session,claimId}=await setup()
 const id=await owner.mutation(api.experiments.create,args)
 for(let i=0;i<3;i++){
  const run=(await poll())!
  const json=JSON.stringify({...fixture,generatedAt:`2026-09-0${i+1}T00:00:00.000Z`,rows:[fixture.rows[0],{...fixture.rows[0],trial:'second',attempt:2}]})
  await t.mutation(api.runners.finish,{credential,session,claimId,id:run.id,status:'completed',json})
  const report=(await owner.query(api.experiments.get,{id})).report
  if(i===2) expect(report).toBeTruthy(); else expect(report).toBeNull()
 }
 const detail=await owner.query(api.experiments.get,{id})
 const combined=await owner.query(api.reports.get,{id:detail.report!})
 const data=JSON.parse(combined!.data) as {job:string;rows:{trial:string}[]}
 expect(data.job).toBe('Harness study')
 expect(data.rows).toHaveLength(6)
 expect(new Set(data.rows.map(row=>row.trial)).size).toBe(6)
 expect(await owner.query(api.reports.list)).toHaveLength(4)
})
test('cancelled cells do not discard completed experiment results',async()=>{
 const {t,owner,args,poll,credential,session,claimId}=await setup()
 const id=await owner.mutation(api.experiments.create,args)
 const run=(await poll())!
 const json=JSON.stringify({...fixture,rows:[fixture.rows[0],{...fixture.rows[0],trial:'second',attempt:2}]})
 await t.mutation(api.runners.finish,{credential,session,claimId,id:run.id,status:'completed',json})
 await owner.mutation(api.experiments.cancel,{id})
 const detail=await owner.query(api.experiments.get,{id})
 expect(detail.cells.map(c=>c.status).sort()).toEqual(['cancelled','cancelled','completed'])
 expect(detail.report).toBeTruthy()
 const combined=await owner.query(api.reports.get,{id:detail.report!})
 expect((JSON.parse(combined!.data) as {rows:unknown[]}).rows).toHaveLength(2)
})
test('cancelling an experiment stops queued runs and requests acknowledgment for active work',async()=>{
 const {owner,other,args,poll}=await setup()
 const id=await owner.mutation(api.experiments.create,args)
 await poll()
 await expect(other.mutation(api.experiments.cancel,{id})).rejects.toThrow('not found')
 await owner.mutation(api.experiments.cancel,{id})
 const detail=await owner.query(api.experiments.get,{id})
 expect(detail.cells.map(c=>c.status).sort()).toEqual(['cancelled','cancelled','cancelling'])
})

test('large task sets and matrices queue, report progress, and cancel every cell', async () => {
 const {owner,args,poll}=await setup()
 const large=Array.from({length:21},(_,i)=>({...profiles[0],id:`model-${i}`,model:`model-${i}`,tasks:100,timeoutSeconds:600000}))
 await poll(large)
 const id=await owner.mutation(api.experiments.create,{...args,profiles:large.map(p=>({id:p.id,digest:p.digest}))})
 expect((await owner.query(api.experiments.get,{id})).cells).toHaveLength(21)
 expect((await owner.query(api.experiments.list))[0].runs).toBe(21)
 const run=await poll(large)
 expect(run?.requestedAttempts).toBe(2)
 await owner.mutation(api.experiments.cancel,{id})
 const cells=(await owner.query(api.experiments.get,{id})).cells
 expect(cells.filter(c=>c.status==='cancelled')).toHaveLength(20)
 expect(cells.filter(c=>c.status==='cancelling')).toHaveLength(1)
})
test('combined reports wait for and include combinations beyond the tenth', async () => {
 const {t,owner,args,poll,credential,session,claimId}=await setup()
 const many=Array.from({length:11},(_,i)=>({...profiles[0],id:`model-${i}`,model:`model-${i}`}))
 await poll(many)
 const id=await owner.mutation(api.experiments.create,{...args,attempts:1,profiles:many.map(p=>({id:p.id,digest:p.digest}))})
 for(let i=0;i<11;i++) {
  const run=(await poll(many))!
  await t.mutation(api.runners.finish,{credential,session,claimId,id:run.id,status:'completed',json:JSON.stringify({...fixture,rows:[fixture.rows[0]]})})
  if(i<10) expect((await owner.query(api.experiments.get,{id})).report).toBeNull()
 }
 const detail=await owner.query(api.experiments.get,{id})
 const report=await owner.query(api.reports.get,{id:detail.report!})
 expect(JSON.parse(report!.data).rows).toHaveLength(11)
})

test('oversized combined reports preserve all completed individual results', async () => {
 const {t,owner,args,poll,credential,session,claimId}=await setup()
 const large=profiles.map(p=>({...p,tasks:600}))
 await poll(large)
 const id=await owner.mutation(api.experiments.create,{...args,attempts:1})
 const rows=Array.from({length:600},(_,i)=>({...fixture.rows[0],trial:`trial-${i}`}))
 for(let i=0;i<3;i++) {
  const run=(await poll(large))!
  await t.mutation(api.runners.finish,{credential,session,claimId,id:run.id,status:'completed',json:JSON.stringify({...fixture,rows})})
 }
 const detail=await owner.query(api.experiments.get,{id})
 expect(detail.report).toBeNull()
 expect(detail.cells.every(c=>c.status==='completed' && c.report && c.result?.trials===600)).toBe(true)
})
test('revoking a worker cancels every queued combination beyond the tenth', async () => {
 const {owner,args,poll}=await setup()
 const many=Array.from({length:21},(_,i)=>({...profiles[0],id:`model-${i}`,model:`model-${i}`}))
 await poll(many)
 const id=await owner.mutation(api.experiments.create,{...args,profiles:many.map(p=>({id:p.id,digest:p.digest}))})
 await owner.mutation(api.runners.revoke,{id:args.runner})
 expect((await owner.query(api.experiments.get,{id})).cells.every(c=>c.status==='cancelled')).toBe(true)
})


test('execution settings survive submission retries, claiming and reload; old workers reject overrides', async () => {
 const {owner,args,poll}=await setup()
 const runSettings={concurrency:4,retries:2,cpus:2,memoryMb:4096,timeoutSeconds:7200}
 await expect(owner.mutation(api.experiments.create,{...args,runSettings})).rejects.toThrow('Update this worker')
 await poll(profiles.map(p=>({...p,runSettingsVersion:1 as const})))
 const id=await owner.mutation(api.experiments.create,{...args,runSettings})
 expect(await owner.mutation(api.experiments.create,{...args,runSettings})).toBe(id)
 await expect(owner.mutation(api.experiments.create,{...args,runSettings:{...runSettings,concurrency:2}})).rejects.toThrow('another experiment')
 expect((await poll(profiles.map(p=>({...p,runSettingsVersion:1 as const}))))?.runSettings).toEqual(runSettings)
 const detail=await owner.query(api.experiments.get,{id})
 for (const cell of detail.cells) expect(cell.runSettings).toEqual(runSettings)
})

test('invalid execution settings never enqueue partial work', async () => {
 const {owner,args,poll}=await setup()
 await poll(profiles.map(p=>({...p,runSettingsVersion:1 as const})))
 for(const change of [{concurrency:0},{concurrency:1.5},{retries:-1},{cpus:0},{memoryMb:-1},{timeoutSeconds:29},{timeoutSeconds:Number.MAX_SAFE_INTEGER}]) {
  await expect(owner.mutation(api.experiments.create,{...args,runSettings:{concurrency:2,retries:0,...change}})).rejects.toThrow()
 }
 expect(await owner.query(api.runners.runs)).toHaveLength(0)
})

test('first evaluation checks the worker before model work, survives reload and deduplicates retries', async () => {
 const {t,owner,args,poll,credential,session,claimId}=await setup()
 const oracle={...profiles[0],id:'check',agent:'oracle',model:'oracle',setupCheck:true}
 const available=[oracle,...profiles]
 await poll(available)
 const input={...args,attempts:1,profiles:[args.profiles[0]],checkWorker:true}
 const id=await owner.mutation(api.experiments.create,input)
 expect(await owner.mutation(api.experiments.create,input)).toBe(id)
 expect(await owner.query(api.runners.runs)).toHaveLength(2)
 const check=(await poll(available))!
 expect(check.profile.setupCheck).toBe(true)
 expect((await owner.query(api.experiments.get,{id})).setup?.status).toBe('running')
 await t.mutation(api.runners.finish,{credential,session,claimId,id:check.id,status:'completed',json:JSON.stringify({...fixture,rows:[{...fixture.rows[0],passed:1,reward:1}]})})
 const model=(await poll(available))!
 expect(model.profile.agent).toBe('codex')
 await t.mutation(api.runners.finish,{credential,session,claimId,id:model.id,status:'completed',json:JSON.stringify({...fixture,rows:[{...fixture.rows[0],passed:1,reward:1}]})})
 const detail=await owner.query(api.experiments.get,{id})
 const report=await owner.query(api.reports.get,{id:detail.report!})
 expect(JSON.parse(report!.data).rows).toHaveLength(1)
})

test.each(['failed','cancelled','interrupted','completed'] as const)('a %s worker check with no passing result prevents model calls',async status=>{
 const {t,owner,args,poll,credential,session,claimId}=await setup()
 const available=[{...profiles[0],id:'check',agent:'oracle',model:'oracle',setupCheck:true},...profiles]
 await poll(available)
 const id=await owner.mutation(api.experiments.create,{...args,attempts:1,profiles:[args.profiles[0]],checkWorker:true})
 const check=(await poll(available))!
 await t.mutation(api.runners.finish,{credential,session,claimId,id:check.id,status,...(status==='completed'?{json:JSON.stringify({...fixture,rows:[{...fixture.rows[0],passed:0,reward:0}]})}:{})})
 expect(await poll(available)).toBeNull()
 expect((await owner.query(api.experiments.get,{id})).cells[0].status).toBe('failed')
})

test('cancelling first evaluation also cancels its prerequisite and never claims model work',async()=>{
 const {owner,args,poll}=await setup()
 const available=[{...profiles[0],id:'check',agent:'oracle',model:'oracle',setupCheck:true},...profiles]
 await poll(available)
 const id=await owner.mutation(api.experiments.create,{...args,attempts:1,profiles:[args.profiles[0]],checkWorker:true})
 await owner.mutation(api.experiments.cancel,{id})
 expect((await owner.query(api.runners.runs)).every(r=>r.status==='cancelled')).toBe(true)
 expect(await poll(available)).toBeNull()
})


test('each model can use its own approved vendor while harness comparisons hold that vendor fixed', async () => {
 const {owner,args,poll}=await setup()
 const mixed=profiles.map((p,i)=>i===2?{...p,model:'zai/glm-test',vendor:'zai'}:p)
 await poll(mixed)
 const id=await owner.mutation(api.experiments.create,args)
 const experiment=await owner.query(api.experiments.get,{id})
 expect(experiment.cells.map(c=>c.profile.vendor)).toEqual(['particle','particle','zai'])
 const inconsistent=mixed.map((p,i)=>i===1?{...p,vendor:'other-vendor'}:p)
 await poll(inconsistent)
 await expect(owner.mutation(api.experiments.create,{...args,requestId:key(77)})).rejects.toThrow('same vendor across harnesses')
})
