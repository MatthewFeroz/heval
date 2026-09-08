import { test, expect } from 'bun:test'
import { readFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { verifyExperiment } from '../harbor/experiment'
const profile=JSON.parse(readFileSync('experiments/merge-comparison.json','utf8'))
const input=JSON.parse(readFileSync(profile.baseline.file,'utf8'))
test('baseline profile matches all six model selections and 20 tasks',()=>{
 expect(verifyExperiment(input,profile)).toEqual([])
 expect(profile.models).toHaveLength(6)
 expect(profile.tasks).toHaveLength(20)
 expect(createHash('sha256').update(JSON.stringify(input)).digest('hex')).toBe(profile.baseline.sha256Json)
})
test('rerun verification detects configuration drift but permits new outcomes',()=>{
 const changed=structuredClone(input);changed.rows[0].passed=1-changed.rows[0].passed;changed.rows[0].costUsd=123
 expect(verifyExperiment(changed,profile)).toEqual([])
 changed.rows[0].vendor='other'
 expect(verifyExperiment(changed,profile).join(' ')).toContain('vendor mismatch')
 expect(verifyExperiment({...input,rows:input.rows.slice(1)},profile).join(' ')).toContain('Missing or repeated attempt')
})
