import { useState } from 'react'
import { useQuery } from 'convex/react'
import { api } from '../../convex/_generated/api'
import type { Id } from '../../convex/_generated/dataModel'
import { RUNNER_ONLINE_MS, terminalStates } from './protocol'
import type { TrialState } from './monitoring'

const label: Record<TrialState, string> = { running: 'Started', passed: 'Passed', failed: 'Failed verification', error: 'Execution error' }
const elapsed = (start: number, end: number) => `${Math.max(0, Math.floor((end - start) / 1000))}s`

export function LiveRunMonitor({ id, status, now, lastSeen }: { id: Id<'runnerRuns'>; status: string; now: number; lastSeen: number }) {
  const [expanded, setExpanded] = useState(false)
  const live = useQuery(api.runners.monitoring, { id, details: expanded })
  const ended = (terminalStates as readonly string[]).includes(status)
  if (!live) return <p className="report-muted">{status === 'queued' ? 'Waiting for worker capacity.' : ended ? 'Live monitoring was not available for this run.' : 'Waiting for monitoring data. Older workers need a CLI update.'}</p>
  const offline = now - lastSeen >= RUNNER_ONLINE_MS
  const stale = now - live.receivedAt > 20_000
  const { counts } = live
  return <section className="live-run-monitor" aria-label="Live task progress">
    <div className="live-run-heading"><strong>{counts.finished} / {counts.total} trials finished</strong><span>{ended ? 'Last recorded progress' : offline ? 'Worker offline' : stale ? 'Monitoring delayed' : 'Live · updates every 5s'}</span></div>
    <progress aria-label="Trials finished" value={counts.finished} max={counts.total} />
    <p>{counts.passed} passed · {counts.failed} failed · {counts.errors} errors · {counts.running} {ended ? 'unfinished' : 'running'} · {counts.pending} {ended ? 'not observed' : 'pending'}</p>
    {counts.total > 1000 && <p className="report-notice">Live monitoring is limited to 1,000 observed trials. The saved report covers the full run.</p>}
    {!ended && <p className="report-muted">Provisional results. {offline ? 'Execution may continue locally; updates resume on reconnection.' : stale ? 'The worker is connected, but fresh progress has not arrived.' : 'Worker connectivity does not prove the harness is making progress.'}</p>}
    <details onToggle={event => setExpanded(event.currentTarget.open)}><summary>Task activity and live log</summary>
      {expanded && <>
        <p className="report-muted">Task lifecycle events from Harbor. Prompts, reasoning, terminal output, and credentials stay on the worker. Latest 200 events retained.</p>
        <div className="evaluation-table-wrap"><table><caption>Observed trials</caption><thead><tr><th>Trial</th><th>Status</th><th>Elapsed</th></tr></thead><tbody>{live.trials.map(t => <tr key={t.id}><td>{t.id}</td><td>{t.state === 'running' ? ended ? 'Unfinished' : 'Executing task' : label[t.state]}</td><td>{elapsed(t.startedAt, t.finishedAt ?? (ended || offline || stale ? live.sampledAt : now))}</td></tr>)}</tbody></table></div>
        <ol className="live-run-log" aria-label="Task activity log">{live.events.map(e => <li key={e.sequence}><time dateTime={new Date(e.at).toISOString()}>{new Date(e.at).toLocaleTimeString()}</time> <span>{e.trial}</span> — {label[e.state]}</li>)}</ol>
        {!live.events.length && <p>Preparing Harbor; no task events yet.</p>}
      </>}
    </details>
  </section>
}
