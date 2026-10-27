import { existsSync, lstatSync, readFileSync, readdirSync } from 'node:fs'
import { stripVTControlCharacters } from 'node:util'
import { basename, join } from 'node:path'
import { readJson } from './files'
import { parseReport } from '../../../../src/reports/format'
import { validateEvidence, type EvidenceKind } from '../../../../src/reports/runArtifacts'

export type CapturedEvidence = { report: string; trial: string; title: string; kind: 'verifier'; text: string }
export type ReviewedEvidence = { trial: string; title: string; kind: EvidenceKind; text: string }
/** Operator-created allowlist. Never search agent transcripts or arbitrary paths. */
export function readReviewedEvidence(directory: string): ReviewedEvidence[] {
  const path = join(directory, 'reviewed-evidence.json'), stat = lstatSync(path)
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 200_000) throw Error('Reviewed evidence must be a regular JSON file up to 200 KB.')
  const manifest = readJson<{ schemaVersion: number; entries: ReviewedEvidence[] }>(path)
  if (manifest.schemaVersion !== 1 || !Array.isArray(manifest.entries) || !manifest.entries.length || manifest.entries.length > 12) throw Error('Use a schemaVersion 1 reviewed-evidence.json with 1–12 entries.')
  return manifest.entries.map(entry => {
    if (typeof entry?.trial !== 'string' || !entry.trial || typeof entry.title !== 'string' || !entry.title.trim() || entry.title.length > 120 || typeof entry.text !== 'string') throw Error('Each reviewed artifact needs a trial, title, kind and text.')
    validateEvidence(entry.kind, entry.text)
    return { trial: entry.trial, title: entry.title, kind: entry.kind, text: entry.text }
  })
}
/** Only acknowledged, verified trials and one fixed artifact type. No configs or trajectories. */
export function collectManagedEvidence(directory: string, modelKey: string): CapturedEvidence[] {
  const results: CapturedEvidence[] = [], runs = join(directory, 'runs')
  if (!existsSync(runs)) return results
  for (const run of readdirSync(runs, { withFileTypes: true })) {
    if (!run.isDirectory() || run.isSymbolicLink()) continue
    const root = join(runs, run.name)
    try {
      const ack = readJson<{ report?: string }>(join(root, 'acknowledged.json'))
      if (!ack.report) continue
      const outcome = readJson<{ json?: string }>(join(root, 'outcome.json'))
      if (!outcome.json) continue
      const rows = parseReport(outcome.json).rows
      for (const row of rows) {
        if (results.length >= 12) return results
        if (basename(row.trial) !== row.trial || row.trial === '.' || row.trial === '..') continue
        const parts = ['jobs', 'evaluation', row.trial, 'verifier', 'test-stdout.txt']
        let path = root, safe = true
        for (const part of parts) { path = join(path, part); if (!existsSync(path) || lstatSync(path).isSymbolicLink()) { safe = false; break } }
        if (!safe || !lstatSync(path).isFile() || lstatSync(path).size > 1_000_000) continue
        let text = stripVTControlCharacters(readFileSync(path, 'utf8')).replaceAll('\0', '')
        if (modelKey) text = text.replaceAll(modelKey, '[model key redacted]')
        text = text.replace(/\b(?:mg|mgmt)_[A-Za-z0-9_-]+/g, '[model key redacted]')
        const encoder = new TextEncoder()
        if (encoder.encode(text).length > 15_000) text = new TextDecoder().decode(encoder.encode(text).slice(0, 15_000)) + '\n[Output truncated by OpenEval]'
        if (text.trim()) results.push({ report: ack.report, trial: row.trial, title: 'Recorded verifier output', kind: 'verifier', text })
      }
    } catch { /* Unacknowledged or unavailable artifacts do not become evidence. */ }
  }
  return results
}
