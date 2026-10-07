/**
 * Walks a new account through four-step setup with the real local provider page
 * and simulated auth/Convex. The test plays the worker's part:
 * pairing, provider setup, and run results are applied to the simulated account.
 *
 *   bun scripts/first-smoke-ui-smoke.ts                 # test
 *   bun scripts/first-smoke-ui-smoke.ts --capture DIR   # also save each stage as PNG plus a video
 */
import assert from 'node:assert/strict'
import { mkdir } from 'node:fs/promises'
import { createServer } from 'vite'
import { chromium, expect } from '@playwright/test'
import { startProviderSetup } from '../packages/cli/src/provider-setup'
import { resolve } from 'node:path'
import { parseReport } from '../src/reports/format'
import { initialReportProject } from '../src/reports/project'

const capture = process.argv.includes('--capture') ? process.argv[process.argv.indexOf('--capture') + 1] : ''
if (process.argv.includes('--capture') && !capture) throw Error('Usage: --capture <directory>')
process.env.VITE_CONVEX_URL = 'https://first-smoke-test.convex.cloud'
process.env.VITE_HEVAL_STATIC_SITE = '1'

// Synthetic reference-solution result, not measured benchmark evidence.
const reportData = parseReport(JSON.stringify({schemaVersion:1,job:'Synthetic Oracle worker check',generatedAt:'2026-10-03T00:00:00Z',rows:[{trial:'setup-check',task:'heval-setup',taskFull:'heval-setup',agent:'oracle',model:'oracle',modelShort:'oracle',stack:'Oracle',reward:1,passed:1,timedOut:0,overSlow:0}]}))
const reportProject = await initialReportProject(reportData,'r-check',reportData.job)

const server = await createServer({ cacheDir: '.scratch/first-smoke-vite', server: { host: '127.0.0.1', port: 0 }, plugins: [{
  name: 'first-smoke-test-adapters', enforce: 'pre',
  resolveId(source) { if (source === 'convex/react') return '\0smoke-convex'; if (source === '../AuthBoundary' || source === './AuthBoundary') return '\0smoke-auth' },
  load(id) {
    if (id === '\0smoke-auth') return `import React from 'react';import {AuthContext} from '/src/auth.ts';const auth={configured:true,isLoading:false,user:{id:'new',email:'new@example.invalid'},signIn:async()=>{},signOut:async()=>{},getAccessToken:async()=>'test'};export function AuthBoundary({children}){return React.createElement(AuthContext.Provider,{value:auth},children(auth))}`
    if (id !== '\0smoke-convex') return
    // Account state lives in localStorage so it survives navigation; window.smokeAccount lets the test act as the worker.
    return `import {useState,useEffect} from 'react';import {getFunctionName} from 'convex/server';
export function useConvexConnectionState(){return {isWebSocketConnected:true}};export class ConvexReactClient{};export function ConvexProviderWithAuth({children}){return children};export function useConvexAuth(){return {isLoading:false,isAuthenticated:true}};
const load=()=>JSON.parse(localStorage.getItem('smoke-account')||'null')||{guide:null,machines:[],runs:[],experiment:null,pairings:0};
function commit(next){localStorage.setItem('smoke-account',JSON.stringify(next));window.dispatchEvent(new Event('smoke-account'))}
window.smokeAccount={get:load,set:update=>commit(update(load()))};
function answer(s,n,args){
 if(n==='reportProjects:team')return {members:[],invites:[]};
 if(n==='reports:list')return s.runs.some(r=>r.report==='r-check')?[{id:'r-check',title:'Synthetic Oracle worker check',trials:1,createdAt:0,role:'owner',shared:false}]:[];
 if(n==='reports:get')return args.id==='r-check'?{id:'r-check',title:'Synthetic Oracle worker check',data:${JSON.stringify(JSON.stringify(reportData))},project:${JSON.stringify(JSON.stringify(reportProject))},shareToken:null,role:'owner',version:0,publishedVersion:null,updatedBy:null}:null;
 if(n==='runners:pairingStatus')return args==='skip'?undefined:s.pairedWorker||null;
 if(n==='runners:list')return s.loading?undefined:s.machines;if(n==='runners:runs')return s.runs;if(n==='onboarding:get')return s.guide;if(n==='runners:monitoring')return null;
 if(n==='experiments:list')return s.experiment?[{id:'e1',title:s.experiment.title,createdAt:0,report:null,runs:1,finished:s.runs.filter(r=>r.experiment&&r.status==='completed').length,failed:0}]:[];
 if(n==='experiments:get')return s.experiment&&{id:'e1',title:s.experiment.title,machine:'My computer',online:true,lastSeen:Date.now(),report:null,cells:s.runs.filter(r=>r.experiment).map(r=>({id:r.id,profile:r.profile,attempts:1,runSettings:null,status:r.status,phase:r.phase,message:r.message,report:r.report,result:null}))};
 throw Error('Unexpected query '+n)}
export function useQuery(ref,args){const [s,setS]=useState(load);useEffect(()=>{const fn=()=>setS(load());window.addEventListener('smoke-account',fn);return()=>window.removeEventListener('smoke-account',fn)},[]);return answer(s,getFunctionName(ref),args)}
export function useMutation(ref){return async args=>{const n=getFunctionName(ref),s=load();
 if(n==='runners:createPairing'){s.pairings++;s.pairCode=args.code;commit(s);return {expiresAt:Date.now()+600000}}
 if(n==='runners:enqueue'){const p=s.machines[0].profiles.find(p=>p.id===args.profileId);s.runs.unshift({id:'check',runner:args.runner,profile:p,experiment:null,status:'queued',phase:'Queued for this machine',message:null,report:null});commit(s);return 'check'}
 if(n==='experiments:create'){const p=s.machines[0].profiles.find(p=>p.id===args.profiles[0].id);s.experiment={title:args.title,attempts:args.attempts,checkWorker:args.checkWorker};s.runs.unshift({id:'smoke',runner:args.runner,profile:p,experiment:'e1',status:'queued',phase:'Queued for this machine',message:null,report:null});commit(s);return 'e1'}
 if(n==='onboarding:save'){s.guide=args;commit(s);return args}
 throw Error('Unexpected mutation '+n)}}`
  },
}] })
await server.listen()
const base = server.resolvedUrls!.local[0]
const browser = await chromium.launch()
if (capture) await mkdir(capture, { recursive: true })
const context = await browser.newContext({ viewport: { width: 1280, height: 900 }, ...(capture ? { recordVideo: { dir: capture, size: { width: 1280, height: 900 } } } : {}) })
const page = await context.newPage(), errors: string[] = []
page.on('pageerror', e => errors.push(e.message))
let shot = 0
async function stage(name: string) {
  if (capture) {
    await page.evaluate(() => document.fonts.ready)
    await page.locator('.first-smoke').screenshot({ path: `${capture}/${String(++shot).padStart(2, '0')}-${name}.png` })
  }
}
type Account = { guide: unknown; machines: { profiles: unknown[]; lastSeen: number }[]; runs: { id: string; status: string; phase: string; report: string | null }[] }
const worker = (update: (account: Account) => void) => page.evaluate(`window.smokeAccount.set(a => { (${update.toString()})(a); return a })`)

const oracle = { id: 'setup-check', digest: 'a'.repeat(64), title: 'Setup check', benchmark: 'Setup task', agent: 'oracle', model: 'oracle', tasks: 1, attempts: 1, timeoutSeconds: 600, setupCheck: true }
const codex = { ...oracle, id: 'codex-smoke', digest: 'b'.repeat(64), title: 'Codex smoke', agent: 'codex', model: 'deepseek/deepseek-v4.1-flash', setupCheck: false, taskSet: 't'.repeat(64), vendor: 'particle', maxAttempts: 3, runSettingsVersion: 1 }

let paired=false, connected=false
process.env.HEVAL_APP_URL=new URL(base).origin
const local=await startProviderSetup('',resolve('packages/cli/dist/runner-task'),0,undefined,{
 status:async()=>({connected,models:connected?[codex.model]:[],worker:{paired,id:paired?'m1':null,name:'My computer',ready:true,health:'Ready'}}),
 pair:async(url,code)=>{assert.equal(url,'https://first-smoke-test.convex.cloud');assert.match(code,/^[a-f0-9]{64}$/);paired=true;return{id:'m1',name:'My computer'}},
 connect:async key=>{assert.equal(key,'test-model-key');connected=true;return{connected,models:[codex.model]}},
 profiles:async(model,harnesses)=>{assert.equal(model,codex.model);assert.deepEqual(harnesses,['codex']);return{profiles:[codex.id]}},
})
try {
  await page.goto(`${base}evaluations`)
  await expect(page.getByRole('link',{name:'Set up my computer'})).toBeVisible()
  await expect(page.locator('.evaluation-empty')).toContainText('worker check without model credentials')
  await expect(page.locator('.first-smoke')).toHaveCount(0)
  await page.getByRole('link',{name:'Set up my computer'}).click()
  await expect(page.getByRole('heading',{name:'Set up your machine',exact:true})).toBeVisible()
  await stage('install')
  await page.getByRole('button',{name:'Setup is open',exact:true}).click()
  await expect(page.getByRole('heading',{name:'Connect your computer',exact:true})).toBeVisible()
  await page.reload()
  await expect(page.getByRole('heading',{name:'Connect your computer',exact:true})).toBeVisible()
  // A real local setup server hands its capability to the hosted UI via the URL fragment.
  await page.goto(local.url)
  await expect(page.getByRole('link',{name:'Connect to Heval',exact:true})).toBeVisible()
  await expect(page.getByLabel('Merge Gateway API key')).not.toBeVisible()
  await page.getByRole('link',{name:'Connect to Heval',exact:true}).click()
  await expect(page.getByRole('button',{name:'Connect computer',exact:true})).toBeVisible()
  assert.equal(new URL(page.url()).hash,'','Local capability is cleared before auth redirects')
  await stage('connect')
  await page.getByRole('button',{name:'Connect computer',exact:true}).click()
  await expect(page.getByRole('heading',{name:'Connect your model provider',exact:true})).toBeVisible()
  assert.equal(paired,true)
  assert.equal(new URL(page.url()).hash,'','Pairing capability is cleared from local history')
  await page.getByLabel('Merge Gateway API key').fill('test-model-key')
  await page.getByRole('button',{name:'Verify and save',exact:true}).click()
  await expect(page.getByRole('heading',{name:'Choose your first evaluation'})).toBeVisible()
  await expect(page.getByLabel('Merge Gateway API key')).toHaveValue('')
  await page.getByRole('button',{name:'Save and continue',exact:true}).click()
  await page.getByRole('link',{name:'Continue to first evaluation',exact:true}).click()
  await page.waitForURL(`${base}machines?setup=1&worker=m1`)
  await page.waitForFunction('!!window.smokeAccount')
  await worker(a=>{a.machines=[{id:'m1',name:'My computer',revoked:false,lastSeen:Date.now(),ready:true,health:'Ready',profiles:[],enabled:true,machine:'laptop',icon:null,activeRun:null} as never]})
  await expect(page.getByRole('heading',{name:'Connect your model provider',exact:true})).toBeVisible()
  await page.getByRole('button',{name:'Reopen setup',exact:true}).click()
  await expect(page.locator('.first-smoke-copy code')).toHaveText('npx @mattferoz/heval@latest setup --harnesses codex')
  await expect(page.locator('code').filter({hasText:'heval provider setup merge'})).toBeVisible()
  await expect(page.getByRole('status').filter({hasText:'Waiting for the worker check profile'})).toBeVisible()
  await stage('provider')
  // Pairing can finish before the daemon advertises profiles or health.
  await worker(a=>{Object.assign(a.machines[0],{ready:false,health:'Harbor is unavailable'})})
  await expect(page.getByRole('status').filter({hasText:'Worker not ready:'})).toContainText('docker info')
  await stage('not-ready')
  await worker(a=>{Object.assign(a.machines[0],{ready:true,health:'Ready'})})
  await stage('waiting-for-worker-check')
  // A paired worker can verify Oracle and reopen its report before any model setup.
  await page.evaluate(`window.smokeAccount.set(a=>{a.machines[0].profiles=${JSON.stringify([oracle])};return a})`)
  await expect(page.getByRole('button',{name:'Run worker check',exact:true})).toBeEnabled()
  await worker(a=>{Object.assign(a.machines[0],{ready:false,health:'Harbor is unavailable'})})
  await expect(page.getByRole('button',{name:'Run worker check',exact:true})).toBeDisabled()
  await worker(a=>{Object.assign(a.machines[0],{ready:true,health:'Ready'})})
  await stage('provider-worker-check')
  await worker(a=>{a.machines[0].lastSeen=0})
  await expect(page.getByRole('button',{name:'Run worker check',exact:true})).toBeDisabled()
  await worker(a=>{a.machines[0].lastSeen=Date.now()})
  // Reach the action with the keyboard and submit it without pointer input.
  await page.evaluate(()=>(document.activeElement as HTMLElement)?.blur())
  for(let i=0;i<40;i++) {
    await page.keyboard.press('Tab')
    if(await page.getByRole('button',{name:'Run worker check',exact:true}).evaluate(el=>el===document.activeElement))break
  }
  await expect(page.getByRole('button',{name:'Run worker check',exact:true})).toBeFocused()
  await page.keyboard.press('Enter')
  await expect(page.getByRole('button',{name:'Worker check in progress'})).toBeDisabled()
  assert.equal(await page.evaluate('window.smokeAccount.get().runs[0].profile.agent'),'oracle')
  assert.equal(await page.evaluate('window.smokeAccount.get().experiment'),null)
  await page.reload()
  await expect(page.getByRole('button',{name:'Worker check in progress'})).toBeDisabled()
  assert.equal(await page.evaluate('window.smokeAccount.get().runs.length'),1)
  await worker(a=>{Object.assign(a.runs[0],{status:'completed',phase:'Report saved',report:'r-check'})})
  await expect(page.getByRole('link',{name:'Open worker check report'})).toHaveAttribute('href','/reports?id=r-check')
  await expect(page.getByRole('heading',{name:'Connect your model provider',exact:true})).toBeVisible()
  await page.setViewportSize({width:390,height:844})
  await expect(page.getByRole('link',{name:'Open worker check report'})).toBeVisible()
  await stage('mobile-worker-check-report')
  assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'Setup fits a narrow viewport')
  await page.getByRole('link',{name:'Open worker check report'}).press('Enter')
  await page.waitForURL(/reports\?id=r-check$/)
  await expect(page.getByRole('heading',{name:'Synthetic Oracle worker check',exact:true})).toBeVisible()
  await expect(page.getByRole('link',{name:'Edit chart in Studio'})).toHaveAttribute('href','/studio?report=r-check')
  if(capture)await page.locator('#workspace-main').screenshot({path:`${capture}/oracle-report.png`})
  await page.goto(`${base}evaluations`)
  await expect(page.getByRole('region',{name:'Individual evaluations'})).toContainText('Setup check')
  await page.getByRole('region',{name:'Individual evaluations'}).getByRole('link',{name:'Open saved report'}).click()
  await expect(page.getByRole('heading',{name:'Synthetic Oracle worker check',exact:true})).toBeVisible()
  await page.getByRole('link',{name:'← Your reports',exact:true}).click()
  await page.getByRole('link',{name:/Synthetic Oracle worker check/}).click()
  await expect(page.getByRole('heading',{name:'Synthetic Oracle worker check',exact:true})).toBeVisible()
  await page.goto(`${base}machines?setup=1&worker=m1`)
  await page.setViewportSize({width:1280,height:900})
  await page.evaluate(`window.smokeAccount.set(a=>{a.machines[0].profiles=${JSON.stringify([oracle,codex])};return a})`)
  await expect(page.getByRole('heading',{name:'Run your first evaluation',exact:true})).toBeVisible()
  await page.evaluate(`window.smokeAccount.set(a=>{a.machines[0].profiles=${JSON.stringify([codex])};return a})`)
  await expect(page.getByRole('button',{name:'Run my first evaluation'})).toBeDisabled()
  await page.getByRole('link',{name:'Reopen provider setup'}).click()
  await expect(page.getByRole('heading',{name:'Connect your model provider',exact:true})).toBeVisible()
  await page.getByRole('button',{name:'Reopen setup',exact:true}).click()
  await expect(page.locator('code').filter({hasText:'heval provider setup merge'})).toBeVisible()
  await page.goto(`${base}machines?setup=1&worker=m1`)
  await page.evaluate(`window.smokeAccount.set(a=>{a.machines[0].profiles=${JSON.stringify([oracle,codex])};return a})`)
  await worker(a=>{a.machines[0].lastSeen=0})
  await expect(page.getByRole('button',{name:'Run my first evaluation'})).toBeDisabled()
  await expect(page.getByRole('status').filter({hasText:'offline'})).toBeVisible()
  await worker(a=>{a.machines[0].lastSeen=Date.now()})
  await stage('run')
  await page.reload()
  await expect(page.getByRole('button',{name:'Run my first evaluation'})).toBeEnabled()
  await page.getByRole('button',{name:'Run my first evaluation'}).click()
  await page.waitForURL(/\?experiment=e1$/)
  assert.equal(await page.evaluate('window.smokeAccount.get().experiment.checkWorker'),true,'First run includes its durable worker prerequisite')
  await expect(page.getByRole('heading',{name:'Codex CLI first evaluation',exact:true})).toBeVisible()
  await worker(a=>{Object.assign(a.runs.find(r=>r.id==='smoke')!,{status:'completed',phase:'Report saved',report:'r-smoke'})})
  await page.goto(`${base}machines?setup=1&worker=m1`)
  await expect(page.getByRole('heading',{name:'Your first evaluation is ready'})).toBeVisible()
  await stage('complete')
  await page.getByRole('button',{name:'Manage computers',exact:true}).click()
  await expect(page.getByRole('region',{name:'Connected machines'})).toBeVisible()
  await expect(page.locator('.first-smoke')).toHaveCount(0)
  await page.reload()
  await expect(page.locator('.first-smoke')).toHaveCount(0)
  await page.getByRole('button',{name:/Account menu for/}).click()
  await page.getByRole('menuitem',{name:'Set up a computer'}).click()
  await expect(page.getByRole('heading',{name:'Your first evaluation is ready'})).toBeVisible()
  await page.goto(`${base}machines?setup=new`)
  await expect(page.getByRole('heading',{name:'Connect your computer',exact:true})).toBeVisible()
  await page.getByRole('button',{name:'Use a pairing code instead'}).click()
  await page.getByRole('button',{name:'Create pairing code',exact:true}).click()
  await expect(page.getByLabel('One-time pairing code')).toHaveValue(/^[a-f0-9]{64}$/)
  await page.evaluate(`window.smokeAccount.set(a=>{a.machines.push({...a.machines[0],id:'m2',profiles:[]});a.pairedWorker='m2';return a})`)
  await page.waitForURL(`${base}machines?setup=1&worker=m2`)
  await expect(page.getByRole('heading',{name:'Connect your model provider',exact:true})).toBeVisible()
  await page.reload()
  await expect(page.getByRole('heading',{name:'Connect your model provider',exact:true})).toBeVisible()
  // Loading status explains that the workspace must finish connecting.
  await page.evaluate(`window.smokeAccount.set(a=>({...a,loading:true}))`)
  await expect(page.getByRole('status').filter({hasText:'Loading computers'})).toContainText('Wait for your workspace')
  await page.evaluate(`window.smokeAccount.set(a=>({...a,loading:false}))`)
  // A different account/browser with no connected machine starts on step one.
  await page.evaluate(()=>{localStorage.clear();sessionStorage.clear()})
  await page.goto(`${base}machines`)
  await page.setViewportSize({width:390,height:844})
  await expect(page.getByRole('heading',{name:'Set up your machine',exact:true})).toBeVisible()
  await stage('mobile-install')
  // Reject remote callback targets instead of sending a pairing code there.
  await page.goto(`${base}machines?setup=new#worker=${encodeURIComponent('https://evil.example/#token='+'a'.repeat(64))}`)
  await expect(page.getByRole('button',{name:'Connect computer',exact:true})).toHaveCount(0)
  assert.deepEqual(errors,[])
  console.log(`PASS: four-step setup; real loopback handoff and provider form; first-run dispatch; offline, reload, new computer, completion, menu, and mobile. ${capture||''}`)
} catch (error) {
  console.error('Onboarding smoke failed:', { url: page.url(), errors })
  throw error
} finally {
  local.server.closeAllConnections();local.server.close()
  await context.close();await browser.close();await server.close()
}
