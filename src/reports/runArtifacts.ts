/** Portable evidence formats shared by the UI, worker and backend. */
export const evidenceKinds = ['patch', 'verifier', 'timeline', 'html', 'image'] as const
export type EvidenceKind = typeof evidenceKinds[number]
export type RunEvent = { at: number; kind: 'started' | 'passed' | 'failed' | 'error' | 'command' | 'edit' | 'test' | 'message'; title: string; text?: string }
export type RunTimeline = { schemaVersion: 1; events: RunEvent[] }
import type { RunMonitoring } from '../runners/monitoring'
export const evidenceLimit = (kind: EvidenceKind) => kind === 'html' || kind === 'image' ? 100_000 : 16_000

export function parseTimeline(text: string): RunTimeline {
  const value = JSON.parse(text) as RunTimeline
  if (value?.schemaVersion !== 1 || !Array.isArray(value.events) || !value.events.length || value.events.length > 100) throw Error('Use a schemaVersion 1 timeline with 1–100 events.')
  let previous = -1
  for (const event of value.events) {
    if (!event || !Number.isSafeInteger(event.at) || event.at < 0 || event.at < previous || !['started', 'passed', 'failed', 'error', 'command', 'edit', 'test', 'message'].includes(event.kind) || typeof event.title !== 'string' || !event.title.trim() || event.title.length > 160 || (event.text !== undefined && (typeof event.text !== 'string' || event.text.length > 4000))) throw Error('Timeline events need ordered timestamps, a supported kind, and a short title.')
    previous = event.at
  }
  return value
}

export function validateEvidence(kind: EvidenceKind, text: string) {
  if (!evidenceKinds.includes(kind) || !text.trim() || text.includes('\0') || new TextEncoder().encode(text).length > evidenceLimit(kind)) throw Error(`Use evidence up to ${evidenceLimit(kind) / 1000} KB.`)
  if (kind === 'timeline') parseTimeline(text)
  // Raster only. SVG and remote URLs are deliberately not image evidence.
  if (kind === 'image' && !/^data:image\/png;base64,iVBORw0KGgo[A-Za-z0-9+/]*={0,2}$/.test(text)) throw Error('Use an embedded PNG screenshot up to 100 KB.')
}

export function lifecycleTimeline(id: string, snapshot: RunMonitoring): RunTimeline | null {
  const trial = snapshot.trials.find(item => item.id === id)
  if (!trial) return null
  const titles = { running: 'Trial observed running', passed: 'Trial passed verification', failed: 'Trial failed verification', error: 'Trial reported an execution error' }
  const events: RunEvent[] = snapshot.events.filter(item => item.trial === id).map(item => ({ at: item.at, kind: item.state === 'running' ? 'started' : item.state, title: titles[item.state] }))
  if (!events.some(item => item.kind === 'started')) events.push({ at: trial.startedAt, kind: 'started', title: titles.running })
  if (trial.state !== 'running' && trial.finishedAt !== undefined && !events.some(item => item.kind === trial.state)) events.push({ at: trial.finishedAt, kind: trial.state, title: titles[trial.state] })
  events.sort((a, b) => a.at - b.at)
  return { schemaVersion: 1, events: events.slice(-100) }
}
