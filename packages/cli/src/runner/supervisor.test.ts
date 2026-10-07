import { test, expect } from 'bun:test'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { supervise, type Outcome } from './supervisor'
import { readJson, writeJson } from './files'

for (const cancelled of [true, false]) {
  test(`${cancelled ? 'cancellation' : 'deadline'} saves verified partial results without scoring unfinished tasks or rerunning`, async () => {
    const directory = mkdtempSync(join(tmpdir(), 'heval-supervisor-partial-'))
    try {
      const harbor = join(directory, 'synthetic-harbor.cjs')
      writeFileSync(harbor, `#!/usr/bin/env node
const fs = require('node:fs');
fs.appendFileSync('launches', 'one\\n');
const put = (name, result) => { fs.mkdirSync('jobs/evaluation/'+name, {recursive:true}); fs.writeFileSync('jobs/evaluation/'+name+'/config.json', '{}'); if(result) fs.writeFileSync('jobs/evaluation/'+name+'/result.json', JSON.stringify(result)); };
put('verified', {finished_at:new Date().toISOString(),task_name:'synthetic',config:{agent:{name:'oracle'}},verifier_result:{rewards:{reward:1}}});
put('unfinished', {task_name:'synthetic',config:{agent:{name:'oracle'}}});
put('cancelled', {finished_at:new Date().toISOString(),exception_info:{exception_type:'CancelledError'}});
${cancelled ? "fs.writeFileSync('cancel', '');" : ''}
setInterval(()=>{}, 1000);
`, { mode: 0o700 })
      writeJson(join(directory, 'execution.json'), { claimId: 'test', harbor, timeoutSeconds: cancelled ? 10 : 0.1 })
      writeJson(join(directory, 'harbor.json'), { n_attempts: 1, tasks: [{}, {}, {}] })
      await supervise(directory)
      const outcome = readJson<Outcome>(join(directory, 'outcome.json'))
      expect(outcome.status).toBe(cancelled ? 'cancelled' : 'failed')
      expect(outcome.json).toBeDefined()
      expect(JSON.parse(outcome.json!).rows).toMatchObject([{ trial: 'verified', passed: 1 }])
      expect(JSON.parse(outcome.json!).rows).toHaveLength(1)
      await supervise(directory)
      expect(readFileSync(join(directory, 'launches'), 'utf8')).toBe('one\n')
    } finally { rmSync(directory, { recursive: true, force: true }) }
  })
}
