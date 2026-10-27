import { expect, test } from 'bun:test'
import { mkdtempSync, mkdirSync, writeFileSync, symlinkSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { collectManagedEvidence, readReviewedEvidence } from './evidence'
import fixture from '../../../../results/harbor/demo-evaluation.json'

test('reviewed uploads use only the explicit bounded manifest and refuse symlinks', () => {
  const directory = mkdtempSync(join(tmpdir(), 'heval-reviewed-evidence-'))
  try {
    const path = join(directory, 'reviewed-evidence.json')
    const entry = { trial: fixture.rows[0].trial, title: 'Demonstration HTML', kind: 'html' as const, text: '<h1>Synthetic demonstration</h1>' }
    writeFileSync(path, JSON.stringify({ schemaVersion: 1, entries: [entry] }))
    expect(readReviewedEvidence(directory)).toEqual([entry])
    writeFileSync(path, JSON.stringify({ schemaVersion: 1, entries: [{ ...entry, kind: 'image', text: 'https://example.invalid/pixel' }] }))
    expect(() => readReviewedEvidence(directory)).toThrow('embedded PNG')
    rmSync(path); writeFileSync(join(directory, 'source.json'), '{}'); symlinkSync(join(directory, 'source.json'), path)
    expect(() => readReviewedEvidence(directory)).toThrow('regular JSON')
  } finally { rmSync(directory, { recursive: true, force: true }) }
})

test('managed evidence requires acknowledged trials, redacts the key and refuses symlinks', () => {
  const directory = mkdtempSync(join(tmpdir(), 'heval-evidence-'))
  try {
    const run = join(directory, 'runs', 'fixture'), artifact = join(run, 'jobs/evaluation', fixture.rows[0].trial, 'verifier')
    mkdirSync(artifact, { recursive: true })
    writeFileSync(join(run, 'outcome.json'), JSON.stringify({ json: JSON.stringify({ ...fixture, rows: [fixture.rows[0]] }) }))
    writeFileSync(join(artifact, 'test-stdout.txt'), 'passed\nmg_private_fixture\nmg_another_fixture\n' + 'x'.repeat(20_000))
    expect(collectManagedEvidence(directory, 'mg_private_fixture')).toEqual([])
    writeFileSync(join(run, 'acknowledged.json'), JSON.stringify({ report: 'fixture-report' }))
    const evidence = collectManagedEvidence(directory, 'mg_private_fixture')
    expect(evidence).toHaveLength(1)
    expect(evidence[0].text).not.toContain('mg_private_fixture'); expect(evidence[0].text).not.toContain('mg_another_fixture')
    expect(evidence[0].text).toContain('[Output truncated by OpenEval]')
    expect(new TextEncoder().encode(evidence[0].text).length).toBeLessThan(16_000)
    rmSync(join(artifact, 'test-stdout.txt'))
    symlinkSync(join(run, 'outcome.json'), join(artifact, 'test-stdout.txt'))
    expect(collectManagedEvidence(directory, 'mg_private_fixture')).toEqual([])
  } finally { rmSync(directory, { recursive: true, force: true }) }
})
