/** Real Studio components with in-browser Convex/auth adapters. No cloud calls.
 * Backend authorization/persistence and the download proxy have separate tests. */
import assert from 'node:assert/strict'
import { createServer } from 'vite'
import { chromium, expect } from '@playwright/test'
import { initialReportProject } from '../src/reports/project'
import { parseReport } from '../src/reports/format'
import { newPresentation } from '../src/project/schema'
import { SOCIAL_DEFAULTS } from '../src/charts/social-presets'
import fixture from '../results/harbor/terminal-bench-comparison.json'

const data = parseReport(JSON.stringify(fixture)), id = 'test-report'
const document = await initialReportProject(data, id, 'Hosted export smoke')
const presentation = newPresentation(document.project, document.project.analysisViews[0])
presentation.social = SOCIAL_DEFAULTS
document.project.presentations = [presentation]; document.presentationId = presentation.id; document.mode = 'presentation'
const initial = { report: { id, title: 'Hosted export smoke', data: JSON.stringify(data), project: JSON.stringify(document), version: 0, role: 'owner', publishedVersion: null, shareToken: null }, jobs: [] }
process.env.VITE_CONVEX_URL = 'https://export-test.convex.cloud'
process.env.VITE_HEVAL_STATIC_SITE = '1'
const server = await createServer({ server: { host: '127.0.0.1', port: 0 }, plugins: [{
  name: 'hosted-export-test-adapters', enforce: 'pre',
  resolveId(source) {
    if (source === 'convex/react') return '\0export-test-convex'
    if (source === '../AuthBoundary' || source === './AuthBoundary') return '\0export-test-auth'
  },
  load(id) {
    if (id === '\0export-test-auth') return `import React from 'react'; import {AuthContext} from '/src/auth.ts';
      const auth={configured:true,isLoading:false,user:{id:'test',email:'test@example.invalid'},signIn:async()=>{},signOut:async()=>{},getAccessToken:async()=> 'test-user-token'};
      export function AuthBoundary({children}) { return React.createElement(AuthContext.Provider,{value:auth},children(auth)); }`
    if (id !== '\0export-test-convex') return
    return `import {useEffect,useState} from 'react'; import {getFunctionName} from 'convex/server';
      export class ConvexReactClient {}
      export function ConvexProviderWithAuth({children}){return children}
      export function useConvexAuth(){return {isLoading:false,isAuthenticated:true}}
      const initial=${JSON.stringify(initial)};
      let cache=JSON.parse(localStorage.getItem('export-test')||'null')||initial;
      function commit(){localStorage.setItem('export-test',JSON.stringify(cache));window.dispatchEvent(new Event('export-test-change'))}
      export function useQuery(ref,args){ const [state,setState]=useState(cache);useEffect(()=>{const update=()=>setState({...cache});window.addEventListener('export-test-change',update);return()=>window.removeEventListener('export-test-change',update)},[]);
        if(args==='skip')return undefined; const name=getFunctionName(ref);
        if(name==='reports:get')return state.report;
        if(name==='presentationExports:available')return true;
        if(name==='presentationExports:list')return state.jobs;
        throw new Error('Unexpected query '+name);
      }
      export function useMutation(ref){return async args=>{const name=getFunctionName(ref);
        if(name!=='presentationExports:request'&&name!=='reportProjects:saveDraft')throw new Error('Unexpected mutation '+name);
        if(args.expectedVersion!==cache.report.version)throw new Error('Stale draft');
        cache={...cache,report:{...cache.report,project:args.document,version:cache.report.version+1}};
        if(name==='presentationExports:request'){const p=JSON.parse(args.document).project.presentations[0];cache.jobs=[...cache.jobs,{_id:'export-'+cache.report.version,_creationTime:Date.now(),status:'queued',preset:p.social.preset,theme:p.social.theme,version:cache.report.version,collection:args.collection}];}
        commit(); return {version:cache.report.version,job:'export-'+cache.report.version};
      }}
    `
  },
}] })
await server.listen()
const origin = server.resolvedUrls!.local[0]
const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } }), errors: string[] = []
page.on('pageerror', error => errors.push(error.message))
try {
  await page.route('**/api/presentation-export?*', async route => {
    assert.equal(route.request().headers().authorization, 'Bearer test-user-token')
    await route.fulfill({ contentType: 'image/png', body: Buffer.from('mock-png-download') })
  })
  await page.goto(`${origin}studio?report=${id}`)
  await expect(page.getByLabel('Question', { exact: true })).toBeVisible()
  await expect(page.getByLabel('Style', { exact: true })).toHaveValue('plain-light')
  await page.getByText('Customize models, text and thread', { exact: true }).click()
  const completed = page.getByRole('checkbox', { name: 'Tasks completed', exact: true })
  await expect(completed).toBeChecked()
  await completed.uncheck()
  await expect(page.getByText('3 charts selected', { exact: true })).toBeVisible()
  await expect(page.getByLabel('Question', { exact: true })).toHaveValue('completed')
  await page.getByLabel('Question', { exact: true }).selectOption('cost-per-success')
  await page.getByLabel('Style', { exact: true }).selectOption('plain-dark')
  await page.getByRole('button', { name: 'Export PNG online', exact: true }).click()
  await expect(page.getByText('Export queued and presentation saved.', { exact: false })).toBeVisible()
  await expect(page.getByLabel('Hosted exports').getByText(/cost-per-success.*plain-dark.*queued/)).toBeVisible()
  // Simulate completion while the browser is away; backend queue is tested separately.
  await page.evaluate(() => { const state = JSON.parse(localStorage.getItem('export-test')!); state.jobs[0].status = 'complete'; state.jobs[0].filename = 'cost-per-success.png'; localStorage.setItem('export-test', JSON.stringify(state)) })
  await page.reload()
  await expect(page.getByLabel('Question', { exact: true })).toHaveValue('cost-per-success')
  await expect(page.getByLabel('Style', { exact: true })).toHaveValue('plain-dark')
  await page.getByText('Customize models, text and thread', { exact: true }).click()
  await expect(page.getByRole('checkbox', { name: 'Tasks completed', exact: true })).not.toBeChecked()
  await expect(page.getByText('3 charts selected', { exact: true })).toBeVisible()
  await page.getByRole('tab', { name: 'Poster', exact: true }).click()
  await expect(page.locator('#f-presentation-theme')).toHaveValue('plain-dark')
  await page.getByRole('tab', { name: 'Social images', exact: true }).click()
  const downloaded = page.waitForEvent('download')
  await page.getByRole('button', { name: 'Download cost-per-success.png' }).click()
  assert.equal((await downloaded).suggestedFilename(), 'cost-per-success.png')
  await page.getByLabel('Style', { exact: true }).selectOption('merge-dark')
  await expect(page.frameLocator('iframe[title="Social chart preview 1"]').locator('[data-model-mark]').first()).toBeVisible()
  await page.getByRole('button', { name: 'Export thread ZIP online', exact: true }).click()
  await expect(page.getByLabel('Hosted exports').getByText(/Thread ZIP.*queued/)).toBeVisible()
  await page.screenshot({ path: '/tmp/heval-hosted-export-history.png', fullPage: true })
  assert.deepEqual(errors, [])
  console.log('PASS: Studio queues PNG, saves settings, restores completed history on reload, authenticates download, and queues ZIP (cloud adapters simulated).')
} finally { await browser.close(); await server.close() }
