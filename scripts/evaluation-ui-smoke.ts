/** Real wizard/components, simulated auth and Convex transport. No model calls. */
import assert from 'node:assert/strict'
import catalog from '../src/runners/merge-public-catalog.json'
import { createServer } from 'vite'
import { chromium, expect } from '@playwright/test'
import reportFixture from '../results/harbor/demo-evaluation.json'
import { initialReportProject } from '../src/reports/project'
import type { ReportData } from '../src/reports/format'
const profiles=['codex','claude-code','pi'].map((agent,i)=>({id:agent,digest:String(i+1).repeat(64),title:agent,benchmark:'Heval connection smoke',agent,model:'deepseek/deepseek-v4.1-flash',vendor:'particle',taskSet:'027851e8453b8dbda1df2aa930e41fd297bbc5f8b01e41387ba7bdc16603d38d',runSettingsVersion:1,maxAttempts:3,tasks:1,attempts:1,timeoutSeconds:600000,setupCheck:false}))
profiles.push({...profiles[0],id:'other-model',model:'zai/glm-5.3',vendor:'zai'})
profiles.push({...profiles[0],id:'codex-baseten',vendor:'baseten'})
const combinedData={...reportFixture,job:'My harness comparison',rows:reportFixture.rows.slice(0,1)} as ReportData
const combinedProject=await initialReportProject(combinedData,'combined-report','My harness comparison')
process.env.VITE_CONVEX_URL='https://wizard-test.convex.cloud'
process.env.VITE_HEVAL_STATIC_SITE='1'
const server=await createServer({server:{host:'127.0.0.1',port:0},plugins:[{
 name:'evaluation-test-adapters',enforce:'pre',
 resolveId(source){if(source==='convex/react')return '\0wizard-convex';if(source==='../AuthBoundary'||source==='./AuthBoundary')return '\0wizard-auth'},
 load(id){
 if(id==='\0wizard-auth')return `import React from 'react';import {AuthContext} from '/src/auth.ts';const auth={configured:true,isLoading:false,user:{id:'test',email:'test@example.invalid'},signIn:async()=>{},signOut:async()=>{},getAccessToken:async()=> 'test'};export function AuthBoundary({children}){return React.createElement(AuthContext.Provider,{value:auth},children(auth))}`
 if(id!=='\0wizard-convex')return
 return `import {useState,useEffect} from 'react';import {getFunctionName} from 'convex/server';export function useConvexConnectionState(){return {isWebSocketConnected:true}};export class ConvexReactClient{};export function ConvexProviderWithAuth({children}){return children};export function useConvexAuth(){return {isLoading:false,isAuthenticated:true}};
 const profiles=${JSON.stringify(profiles)};let cache=JSON.parse(localStorage.getItem('wizard-test')||'null')||{count:0,experiment:null};
 const machine={modelCatalog:${JSON.stringify(catalog)},id:'worker',name:'Linux worker',ready:true,revoked:false,lastSeen:Date.now(),health:'Ready',profiles,enabled:true,machine:'laptop',icon:null,activeRun:null};
 function commit(){localStorage.setItem('wizard-test',JSON.stringify(cache));window.dispatchEvent(new Event('wizard-change'))}
 window.addEventListener('monitor-test',()=>{cache=JSON.parse(localStorage.getItem('wizard-test'));commit()});
 export function useQuery(ref,args){const [state,setState]=useState(cache);useEffect(()=>{const fn=()=>setState({...cache});window.addEventListener('wizard-change',fn);return()=>window.removeEventListener('wizard-change',fn)},[]);const n=getFunctionName(ref);
 if(n==='runners:pairingStatus')return null;
 if(n==='runners:monitoring')return state.monitoring?.[args.id]??null;
 if(n==='runners:runs'||n==='reports:list')return [];
 // An established account; the first-smoke checklist has its own smoke test.
 if(n==='onboarding:get')return {step:3,status:'completed'};
 if(n==='runners:list')return [machine];if(n==='experiments:list')return state.experiment?[{id:'experiment',title:state.experiment.title,runs:3,finished:0,failed:0,report:state.experiment.report}]:[];if(n==='experiments:get')return state.experiment;if(n==='reports:get')return args.id==='combined-report'?{id:'combined-report',title:'My harness comparison',data:${JSON.stringify(JSON.stringify(combinedData))},project:${JSON.stringify(JSON.stringify(combinedProject))},shareToken:null,role:'owner',version:0,publishedVersion:null,updatedBy:null}:null;throw Error('Unexpected query '+n)}
 export function useMutation(ref){return async args=>{const n=getFunctionName(ref);if(n==='experiments:create'){cache.count++;cache.input=args;cache.experiment={id:'experiment',title:args.title,machine:'Linux worker',online:true,lastSeen:Date.now(),report:null,cells:args.profiles.map(p=>({id:p.id,profile:profiles.find(x=>x.id===p.id),attempts:args.attempts,runSettings:args.runSettings,status:'queued',phase:'Queued',report:null,result:null}))};commit();return 'experiment'}if(n==='experiments:cancel'){cache.experiment.cells.forEach(c=>{if(c.status==='queued')c.status='cancelled'});cache.experiment.report='combined-report';commit();return}if(n==='runners:setEnabled'){machine.enabled=args.enabled;commit();return}if(n==='runners:setIcon'){machine.icon=args.icon;commit();return}throw Error('Unexpected mutation '+n)}}`
 }
}]})
await server.listen()
const browser=await chromium.launch(),page=await browser.newPage({viewport:{width:1440,height:1000}}),errors:string[]=[]
page.on('pageerror',e=>errors.push(e.message))
try {
 await page.goto(`${server.resolvedUrls!.local[0]}evaluations`)
 await expect(page.getByRole('heading',{name:'Configure evaluation'})).toBeVisible()
 await expect(page.getByRole('button',{name:'Start experiment',exact:true})).toBeDisabled()
 for(const name of ['Codex CLI','Claude Code','Pi Agent'])await page.getByRole('checkbox',{name:new RegExp(name)}).check()
 await expect(page.getByRole('checkbox',{name:'Opus 5.5',exact:true})).toBeDisabled()
 await page.getByRole('checkbox',{name:'GLM-5.3',exact:true}).check()
 await expect(page.getByText(/Claude Code \+ zai\/glm-5.3 is not configured/)).toBeVisible()
 await expect(page.getByRole('button',{name:'Start experiment',exact:true})).toBeDisabled()
 await page.getByRole('checkbox',{name:'GLM-5.3',exact:true}).uncheck()
 await page.getByRole('checkbox',{name:'DeepSeek V4.1 Flash',exact:true}).check()
 await page.getByLabel('Serving vendor for DeepSeek V4.1 Flash').selectOption('baseten')
 await expect(page.getByText(/Claude Code \+ deepseek.*is not configured for baseten/)).toBeVisible()
 await expect(page.getByRole('button',{name:'Start experiment',exact:true})).toBeDisabled()
 await page.getByLabel('Serving vendor for DeepSeek V4.1 Flash').selectOption('particle')
 await expect(page.getByLabel('Attempts per task')).not.toBeVisible()
 await page.getByText('Advanced settings',{exact:true}).click()
 await page.getByLabel('Attempts per task').fill('2')
 await page.getByLabel('Parallel trials per run').fill('0')
 await expect(page.getByRole('alert')).toContainText('whole numbers')
 await page.getByLabel('Parallel trials per run').fill('2')
 await page.getByLabel('Retries per trial error').fill('1')
 await page.getByLabel('CPUs per trial').fill('2')
 await page.getByLabel('RAM per trial (MiB)').fill('4096')
 await page.getByLabel('Run deadline (minutes)').fill('120')
 await page.getByLabel('Experiment name').fill('My harness comparison')
 await expect(page.getByText('6 trials, up to 2 at a time within each run.',{exact:true})).toBeVisible()
 await expect(page.getByRole('cell',{name:'120 min',exact:true})).toHaveCount(3)
 await page.getByRole('button',{name:'Start experiment',exact:true}).click()
 await expect(page.getByRole('heading',{name:'My harness comparison',exact:true})).toBeVisible()
 await page.reload()
 await expect(page.getByRole('heading',{name:'My harness comparison',exact:true})).toBeVisible()
 const saved=await page.evaluate(()=>JSON.parse(localStorage.getItem('wizard-test')!))
 assert.deepEqual(saved.input.runSettings,{concurrency:2,retries:1,cpus:2,memoryMb:4096,timeoutSeconds:7200})
 assert.equal(saved.count,1);assert.equal(saved.input.profiles.length,3);assert.equal(saved.input.attempts,2)
 await page.evaluate(()=>{
   const s=JSON.parse(localStorage.getItem('wizard-test')!), now=Date.now()
   s.experiment.cells[0].status='running'
   s.monitoring={codex:{sequence:1,sampledAt:now,receivedAt:now,counts:{total:200,finished:2,passed:1,failed:0,errors:1,running:1,pending:197},trials:[{id:'file-edit__one',state:'passed',startedAt:now-25000,updatedAt:now-20000,finishedAt:now-20000},{id:'network-build__two',state:'error',startedAt:now-19000,updatedAt:now-15000,finishedAt:now-15000},{id:'test-fix__three',state:'running',startedAt:now-10000,updatedAt:now-10000}],events:[{sequence:1,at:now-20000,trial:'file-edit__one',state:'passed'},{sequence:2,at:now-15000,trial:'network-build__two',state:'error'},{sequence:3,at:now-10000,trial:'test-fix__three',state:'running'}]}}
   localStorage.setItem('wizard-test',JSON.stringify(s));window.dispatchEvent(new Event('monitor-test'))
 })
 await expect(page.getByText('2 / 200 trials finished',{exact:true})).toBeVisible()
 await page.getByText('Task activity and live log',{exact:true}).click()
 await expect(page.getByRole('log')).toHaveCount(0) // No incessant screen-reader announcements.
 await expect(page.getByRole('list',{name:'Task activity log'})).toContainText('Execution error')
 await page.evaluate(()=>{const s=JSON.parse(localStorage.getItem('wizard-test')!);s.monitoring.codex.receivedAt=0;localStorage.setItem('wizard-test',JSON.stringify(s));window.dispatchEvent(new Event('monitor-test'))})
 await expect(page.getByText('Monitoring delayed',{exact:true})).toBeVisible()
 await page.reload()
 await expect(page.getByText('2 / 200 trials finished',{exact:true})).toBeVisible()
 await page.evaluate(()=>{const s=JSON.parse(localStorage.getItem('wizard-test')!);s.experiment.cells[0]={...s.experiment.cells[0],status:'completed',report:'saved-report',result:{passed:2,trials:2,medianSeconds:5,reportedCost:null}};localStorage.setItem('wizard-test',JSON.stringify(s))})
 await page.reload()
 await expect(page.getByRole('link',{name:'Inspect this run'})).not.toBeVisible()
 await page.locator('.run-accordion > summary').first().press('Enter')
 await expect(page.getByRole('link',{name:'Inspect this run'})).toBeVisible()
 await expect(page.getByRole('link',{name:'Inspect this run'})).toHaveAttribute('href','/reports?id=saved-report')
 await page.evaluate(()=>{const s=JSON.parse(localStorage.getItem('wizard-test')!);s.experiment.lastSeen=0;localStorage.setItem('wizard-test',JSON.stringify(s))})
 await page.reload()
 await expect(page.getByText(/Worker offline./)).toBeVisible()
 await page.getByRole('button',{name:'Cancel unfinished runs'}).click()
 await expect(page.getByText('3 of 3 runs finished',{exact:false})).toBeVisible()
 await expect(page.getByRole('heading',{name:'Inspect, shape, and publish this evaluation.'})).toBeVisible()
 await expect(page.getByRole('button',{name:'Publish evaluation'})).toBeVisible()
 // The combined result remains available to the report editor.
 await page.goto(`${server.resolvedUrls!.local[0]}studio?report=combined-report`)
 await expect(page.getByRole('heading', { name: 'My harness comparison', exact: true })).toBeVisible()
 await expect(page.getByRole('button',{name:'Save draft',exact:true})).toBeVisible()
 assert.deepEqual(errors,[])
 console.log('PASS: browser configures an evaluation, restores progress, inspects a run, combines terminal results, and exposes publishing.')
}finally{await browser.close();await server.close()}
