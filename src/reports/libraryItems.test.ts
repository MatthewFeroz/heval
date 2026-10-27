import { describe, expect, test } from 'bun:test'
import { libraryItems } from './libraryItems'

type Data = Parameters<typeof libraryItems>[0]
const fixture = () => ({
  reports: [
    { id: 'combined', title: 'Renamed comparison', trials: 2, createdAt: 10, shared: true, role: 'owner' },
    { id: 'child', title: 'Child report', trials: 1, createdAt: 9, shared: false, role: 'owner' },
    { id: 'import', title: 'Imported results', trials: 3, createdAt: 20, shared: false, role: 'editor' },
  ],
  experiments: [{ id: 'experiment', title: 'Original title', createdAt: 5, report: 'combined', setupRun: null, runs: 2, finished: 2, failed: 0 }],
  jobs: [{ id: 'managed', title: 'Original title', experiment: 'experiment', createdAt: 4, status: 'cleanup', message: 'Deleting worker' }],
  baselines: [{ id: 'baseline', title: 'Baseline', report: 'combined', experiment: 'experiment', createdAt: 12 }],
  runs: [{ id: 'run', experiment: 'experiment', report: 'child', createdAt: 9, status: 'completed', profile: { title: 'Child run' }, phase: 'Done', message: null }],
} as unknown as Data)

describe('Library relationships', () => {
  test('shows a managed comparison once, keeping its baseline, publication and cleanup status', () => {
    const items = libraryItems(fixture())
    expect(items.map(item => item.key)).toEqual(['report:import', 'managed:managed'])
    expect(items[1]).toMatchObject({ title: 'Renamed comparison', active: true, shared: true, baseline: { id: 'baseline' }, href: '/library?managed=managed' })
  })
  test('keeps connected comparisons and imports with matching titles separate', () => {
    const data = fixture(); data.jobs = []; data.reports[2].title = 'Renamed comparison'
    expect(libraryItems(data).map(item => item.key)).toEqual(['report:import', 'experiment:experiment'])
  })
  test('keeps a standalone run once and makes its report accessible through it', () => {
    const data = fixture(); data.experiments = []; data.jobs = []; data.baselines = []; data.runs[0].experiment = null
    const items = libraryItems(data)
    expect(items.some(item => item.key === 'report:child')).toBe(false)
    expect(items.find(item => item.key === 'run:run')).toMatchObject({ href: '/library?run=run', active: false })
    expect(items.some(item => item.key === 'report:combined')).toBe(true)
  })
  test('retains baseline access when the original comparison falls outside history', () => {
    const data = fixture(); data.experiments = []; data.jobs = []; data.reports = []; data.runs = []
    expect(libraryItems(data)).toMatchObject([{ key: 'baseline:baseline', href: '/library?report=combined', baseline: { id: 'baseline' } }])
  })
})
