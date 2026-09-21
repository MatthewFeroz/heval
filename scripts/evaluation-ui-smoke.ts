/** Real wizard/components, simulated auth and Convex transport. No model calls. */
import assert from 'node:assert/strict'
import { createServer } from 'vite'
import { chromium, expect } from '@playwright/test'
import reportFixture from '../results/harbor/terminal-bench-comparison.json'
import { initialReportProject } from '../src/reports/project'
import type { ReportData } from '../src/reports/format'
const profiles=['codex','claude-code','pi'].map((agent,i)=>({id:agent,digest:String(i+1).repeat(64),title:agent,benchmark:'Protocol smoke',agent,model:'deepseek/test',vendor:'particle',taskSet:'a'.repeat(64),maxAttempts:3,tasks:1,attempts:1,timeoutSeconds:1800,setupCheck:false}))
profiles.push({...profiles[0],id:'other-model',model:'other/model'})
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
 const machine={id:'worker',name:'MacBook worker',ready:true,revoked:false,lastSeen:Date.now(),health:'Ready',profiles};
 function commit(){localStorage.setItem('wizard-test',JSON.stringify(cache));window.dispatchEvent(new Event('wizard-change'))}
 export function useQuery(ref,args){const [state,setState]=useState(cache);useEffect(()=>{const fn=()=>setState({...cache});window.addEventListener('wizard-change',fn);return()=>window.removeEventListener('wizard-change',fn)},[]);const n=getFunctionName(ref);
 if(n==='runners:list')return [machine];if(n==='experiments:list')return state.experiment?[{id:'experiment',title:state.experiment.title,runs:3,finished:0,failed:0,report:state.experiment.report}]:[];if(n==='experiments:get')return state.experiment;if(n==='reports:get')return args.id==='combined-report'?{id:'combined-report',title:'My harness comparison',data:${JSON.stringify(JSON.stringify(combinedData))},project:${JSON.stringify(JSON.stringify(combinedProject))},shareToken:null,role:'owner',version:0,publishedVersion:null,updatedBy:null}:null;throw Error('Unexpected query '+n)}
 export function useMutation(ref){return async args=>{const n=getFunctionName(ref);if(n==='experiments:create'){cache.count++;cache.input=args;cache.experiment={id:'experiment',title:args.title,machine:'MacBook worker',online:true,lastSeen:Date.now(),report:null,cells:args.profiles.map(p=>({id:p.id,profile:profiles.find(x=>x.id===p.id),attempts:args.attempts,status:'queued',phase:'Queued',report:null,result:null}))};commit();return 'experiment'}if(n==='experiments:cancel'){cache.experiment.cells.forEach(c=>{if(c.status==='queued')c.status='cancelled'});cache.experiment.report='combined-report';commit();return}throw Error('Unexpected mutation '+n)}}`
 }
}]})
await server.listen()
const browser=await chromium.launch(),page=await browser.newPage({viewport:{width:1440,height:1000}}),errors:string[]=[]
page.on('pageerror',e=>errors.push(e.message))
try {
 await page.goto(`${server.resolvedUrls!.local[0]}evaluations`)
 await expect(page.getByRole('heading',{name:'Configure evaluation'})).toBeVisible()
 await expect(page.getByRole('heading',{name:'See a finished run before you make one.'})).toBeVisible()
 await expect(page.getByRole('definition')).toHaveCount(4)
 await expect(page.getByRole('link',{name:'Walk through the public run ↗'})).toHaveAttribute('href','https://hub.harborframework.com/jobs/3de0aee9-6de7-4d94-83c4-ac5e789fe757')
 await expect(page.getByRole('link',{name:'Open a Heval example report'})).toHaveAttribute('href','/results/harbor/terminal-bench-comparison.html')
 await expect(page.getByRole('button',{name:'Start experiment',exact:true})).toBeDisabled()
 for(const name of ['Codex CLI','Claude Code','Pi Agent'])await page.getByRole('checkbox',{name:new RegExp(name)}).check()
 await page.getByRole('checkbox',{name:/other\/model/}).check()
 await expect(page.getByText(/Claude Code \+ other\/model is not configured/)).toBeVisible()
 await expect(page.getByRole('button',{name:'Start experiment',exact:true})).toBeDisabled()
 await page.getByRole('checkbox',{name:/other\/model/}).uncheck()
 await page.getByRole('checkbox',{name:/deepseek\/test/}).check()
 await expect(page.getByLabel('Attempts per task')).not.toBeVisible()
 await page.getByText('Advanced settings',{exact:true}).click()
 await page.getByLabel('Attempts per task').fill('2')
 await page.getByLabel('Experiment name').fill('My harness comparison')
 await expect(page.getByText('6 trials, one at a time.',{exact:true})).toBeVisible()
 await expect(page.getByRole('button',{name:'Continue',exact:true})).toHaveCount(0)
 await page.evaluate(()=>window.scrollTo(0,0))
 await page.screenshot({path:'/tmp/heval-evaluation-review.png',fullPage:true})
 await page.setViewportSize({width:390,height:844})
 assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth),true)
 await page.screenshot({path:'/tmp/heval-evaluation-mobile.png',fullPage:true})
 await page.setViewportSize({width:1440,height:1000})
 await page.getByRole('button',{name:'Start experiment',exact:true}).click()
 await expect(page.getByRole('heading',{name:'My harness comparison',exact:true})).toBeVisible()
 await page.reload()
 await expect(page.getByRole('heading',{name:'My harness comparison',exact:true})).toBeVisible()
 const saved=await page.evaluate(()=>JSON.parse(localStorage.getItem('wizard-test')!))
 assert.equal(saved.count,1);assert.equal(saved.input.profiles.length,3);assert.equal(saved.input.attempts,2)
 await page.evaluate(()=>{const s=JSON.parse(localStorage.getItem('wizard-test')!);s.experiment.cells[0]={...s.experiment.cells[0],status:'completed',report:'saved-report',result:{passed:2,trials:2,medianSeconds:5,reportedCost:null}};localStorage.setItem('wizard-test',JSON.stringify(s))})
 await page.reload()
 await expect(page.getByRole('link',{name:'Inspect this run'})).not.toBeVisible()
 await page.locator('.run-accordion > summary').first().press('Enter')
 await expect(page.getByRole('link',{name:'Inspect this run'})).toBeVisible()
 await expect(page.getByRole('link',{name:'Inspect this run'})).toHaveAttribute('href','/reports?id=saved-report')
 await page.screenshot({path:'/tmp/heval-experiment-results.png',fullPage:true})
 await page.evaluate(()=>{const s=JSON.parse(localStorage.getItem('wizard-test')!);s.experiment.lastSeen=0;localStorage.setItem('wizard-test',JSON.stringify(s))})
 await page.reload()
 await expect(page.getByText(/Worker offline./)).toBeVisible()
 await page.getByRole('button',{name:'Cancel unfinished runs'}).click()
 await expect(page.getByText('3 of 3 runs finished',{exact:false})).toBeVisible()
 await expect(page.getByRole('heading',{name:'Inspect, shape, and publish this evaluation.'})).toBeVisible()
 await expect(page.getByRole('button',{name:'Publish evaluation'})).toBeVisible()
 await page.screenshot({path:'/tmp/heval-evaluation-combined.png',fullPage:true})
 assert.deepEqual(errors,[])
 console.log('PASS: browser configures an evaluation, restores progress, inspects a run, combines terminal results, and exposes publishing.')
}finally{await browser.close();await server.close()}
