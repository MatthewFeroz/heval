import type { RunnerProfile, RunSettings } from './protocol'
import { executionTimeoutSeconds } from './protocol'
import { HARNESS } from '../harnesses'

/** Shared review of the exact approved profiles for guided and custom runs. */
export function ComparisonReview({ profiles, attempts, settings, valid }: { profiles: RunnerProfile[]; attempts: number; settings?: RunSettings; valid: boolean }) {
  return <div className="evaluation-table-wrap"><table><caption>Combinations to run</caption><thead><tr><th>Harness</th><th>Model</th><th>Vendor</th><th>Trials</th><th>Run deadline</th></tr></thead><tbody>{profiles.map((profile, index) => <tr key={`${profile.id}:${index}`}>
    <td>{HARNESS[profile.agent]?.name ?? profile.agent}</td><td>{profile.model}</td><td>{profile.vendor ?? 'Provider default'}</td><td>{profile.tasks} × {attempts}</td><td>{valid ? `${Math.ceil(executionTimeoutSeconds(profile, attempts, settings) / 60).toLocaleString()} min` : '—'}</td>
  </tr>)}</tbody></table></div>
}
