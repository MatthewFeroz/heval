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
test('queue capacity and readiness are checked for the entire experiment',async()=>{
 const {t,owner,args}=await setup()
 for(let i=0;i<3;i++) await owner.mutation(api.experiments.create,{...args,requestId:key(40+i)})
 await expect(owner.mutation(api.experiments.create,{...args,requestId:key(50)})).rejects.toThrow('queue space')
 expect(await owner.query(api.runners.runs)).toHaveLength(9)
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
