import { useState } from 'react'
import { useMutation, useQuery } from 'convex/react'
import type { FunctionReturnType } from 'convex/server'
import { api } from '../../convex/_generated/api'
import type { Id } from '../../convex/_generated/dataModel'
import { profileIdentity } from './comparison'
import { message } from '../reports/helpers'

type Experiment = FunctionReturnType<typeof api.experiments.get>
export function SaveBaseline({ experiment }: { experiment: Experiment }) {
  const save = useMutation(api.baselines.save)
  const [saved, setSaved] = useState<Id<'comparisonBaselines'> | null>(null), [busy, setBusy] = useState(false), [error, setError] = useState('')
  return <section className="report-card"><h2>Keep this comparison as a baseline</h2><p>Save the task snapshot, execution settings and recorded outcomes. A repeat creates a new evaluation; this evidence stays unchanged.</p>
    {saved ? <a href={`/library?new=1&baseline=${saved}`}>Run another comparison against this baseline</a> : <button disabled={busy} onClick={async () => { setBusy(true); try { setSaved(await save({ experiment: experiment.id, title: experiment.title })) } catch (e) { setError(message(e)) } finally { setBusy(false) } }}>{busy ? 'Saving…' : 'Set as baseline'}</button>}
    {error && <p role="alert">{error}</p>}
  </section>
}

export function BaselineDifference({ id, experiment }: { id: Id<'comparisonBaselines'>; experiment: Experiment }) {
  const baseline = useQuery(api.baselines.get, { id })
  if (!baseline) return <p role="status">Loading baseline…</p>
  const current = experiment.cells
  const identities = [...new Set([...baseline.results.map(r => profileIdentity(r.profile)), ...current.map(r => profileIdentity(r.profile))])]
  const metric = (n: number | null | undefined, prefix = '') => n == null ? 'Unknown' : `${prefix}${n.toLocaleString(undefined, { maximumFractionDigits: 4 })}`
  return <section className="report-card"><h2>Compared with {baseline.title}</h2><p>The task snapshot, attempts and configured resources are fixed. Changed approvals and recorded versions are shown below. Each score describes recorded attempts.</p><a href={`/library?report=${baseline.report}`}>Open original baseline</a>
    <div className="evaluation-table-wrap"><table><caption>Baseline and current evidence</caption><thead><tr><th>Combination</th><th>Baseline passes</th><th>Current passes</th><th>Baseline cost</th><th>Current cost</th><th>Recorded versions and changes</th></tr></thead><tbody>{identities.map(identity => {
      const a = baseline.results.find(r => profileIdentity(r.profile) === identity), b = current.find(r => profileIdentity(r.profile) === identity), profile = (a ?? b)!.profile
      return <tr key={identity}><th>{profile.agent} · {profile.model} · {profile.vendor}</th><td>{a?.result ? `${a.result.passed}/${a.result.trials}` : 'Not recorded'}</td><td>{b?.result ? `${b.result.passed}/${b.result.trials}` : b ? b.status : 'Not selected'}</td><td>{metric(a?.result?.reportedCost, '$')}</td><td>{metric(b?.result?.reportedCost, '$')}</td><td>{!a ? 'New combination. ' : !b ? 'Omitted from repeat. ' : a.profile.digest !== b.profile.digest ? 'Worker approval changed. ' : 'Same worker approval. '}{a?.result?.versions.join(', ') || 'Unknown'} → {b?.result?.versions.join(', ') || 'Unknown'}</td></tr>
    })}</tbody></table></div><p>Costs are reported or derived from recorded usage, and are not reconciled invoices. Unknown costs are not zero.</p>
  </section>
}
