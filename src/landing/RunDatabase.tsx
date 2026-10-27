import { useEffect, useMemo, useState } from 'react'
import { ArrowUpRight, Check, Clock3, Link2, X } from 'lucide-react'
import { HARNESS } from '../harnesses'
import { modelMark } from '../charts/model-marks'
import data from '../runs/run-database.json'
import {
  compareSetup, errorLabel, formatCost, formatDuration, formatTokens, orderedStacks, orderedTasks, outcome, passCount,
  readSelection, selectionSearch, stackLabel, trialAt,
  type Pair, type RunDatabase as Database, type RunStack, type RunStudy, type RunTrial,
} from '../runs/database'
import './run-database.css'
import { RunScatter } from './RunScatter'

const database = data as Database
type Highlight = 'all' | 'passed' | 'failed'

const outcomeClass = (trial: RunTrial) => trial.passed ? 'is-pass' : trial.error === 'AgentTimeoutError' ? 'is-timeout' : 'is-fail'

function OutcomeIcon({ trial, size = 13 }: { trial: RunTrial; size?: number }) {
  if (trial.passed) return <Check size={size} strokeWidth={2.5} aria-hidden="true" />
  if (trial.error === 'AgentTimeoutError') return <Clock3 size={size} strokeWidth={2.25} aria-hidden="true" />
  return <X size={size} strokeWidth={2.5} aria-hidden="true" />
}

function StackMark({ study, stack }: { study: RunStudy; stack: RunStack }) {
  if (study.varies === 'model') {
    const mark = modelMark(stack.model)
    return mark ? <span className="runs-mark" aria-hidden="true" dangerouslySetInnerHTML={{ __html: mark }} /> : null
  }
  const logo = HARNESS[stack.harness]?.logo
  return logo ? <span className={`runs-mark runs-mark-${stack.harness}`} aria-hidden="true"><img src={logo} alt="" /></span> : null
}

function Matrix({ study, pair, highlight, onPick }: { study: RunStudy; pair: Pair; highlight: Highlight; onPick: (trial: RunTrial) => void }) {
  const stacks = orderedStacks(study)
  const tasks = orderedTasks(study)
  const slot = (trial: RunTrial) => trial.id === pair[0].id ? 'A' : trial.id === pair[1]?.id ? 'B' : null
  return (
    <div className="runs-matrix-wrap">
      <table className="runs-matrix" style={{ '--runs-columns': stacks.length } as React.CSSProperties}>
        <caption className="sr-only">{study.name} runs: tasks by {study.varies}. Select two runs to compare them.</caption>
        <thead>
          <tr>
            <th scope="col" className="runs-task-head">Task</th>
            {stacks.map(stack => (
              <th scope="col" key={stack.id}>
                <span className="runs-stack">
                  <StackMark study={study} stack={stack} />
                  <span className="runs-stack-name">{stackLabel(study, stack)}</span>
                </span>
                <span className="runs-stack-score">{passCount(study, trial => trial.stack === stack.id)}/{study.tasks.length} passed</span>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {tasks.map(task => (
            <tr key={task.id}>
              <th scope="row">
                <span className="runs-task-name" title={task.repository ?? task.name}>{task.name}</span>
                <span className="runs-task-score">{passCount(study, trial => trial.task === task.id)}/{stacks.length}</span>
              </th>
              {stacks.map(stack => {
                const trial = trialAt(study, task.id, stack.id)
                if (!trial) return <td key={stack.id}><span className="run-cell is-missing">no run</span></td>
                const selected = slot(trial)
                const dimmed = highlight === 'passed' ? !trial.passed : highlight === 'failed' ? trial.passed : false
                return (
                  <td key={stack.id}>
                    <button
                      type="button"
                      className={`run-cell ${outcomeClass(trial)} ${selected ? `is-selected is-${selected.toLowerCase()}` : ''} ${dimmed ? 'is-dimmed' : ''}`}
                      aria-pressed={Boolean(selected)}
                      aria-label={`${stackLabel(study, stack)} on ${task.name}: ${outcome(trial).toLowerCase()} in ${formatDuration(trial.agentSeconds)}${selected ? `, selected as run ${selected}` : ''}`}
                      onClick={() => onPick(trial)}
                    >
                      {selected ? <span className="run-slot">{selected}</span> : <OutcomeIcon trial={trial} />}
                      <span className="run-time">{formatDuration(trial.agentSeconds)}</span>
                    </button>
                  </td>
                )
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function Metric({ label, a, b, hint }: { label: string; a: React.ReactNode; b?: React.ReactNode; hint?: string }) {
  return (
    <div className={`runs-metric ${b === undefined ? 'is-single' : ''}`}>
      <dt>{label}{hint && <small>{hint}</small>}</dt>
      <dd>{a}</dd>
      {b !== undefined && <dd>{b}</dd>}
    </div>
  )
}

function RunHeader({ study, trial, slot }: { study: RunStudy; trial: RunTrial; slot: 'A' | 'B' }) {
  const stack = study.stacks.find(item => item.id === trial.stack)!
  return (
    <div className={`runs-compare-run is-${slot.toLowerCase()}`}>
      <span className="run-slot">{slot}</span>
      <span className="runs-compare-stack"><StackMark study={study} stack={stack} />{stackLabel(study, stack)}</span>
      <span className={`runs-outcome ${outcomeClass(trial)}`}><OutcomeIcon trial={trial} size={12} />{outcome(trial)}</span>
    </div>
  )
}

const cost = (trial: RunTrial) => <>{formatCost(trial.costUsd)}{trial.costSource && trial.costUsd !== null && <small>{trial.costSource === 'derived' ? 'from tokens' : trial.costSource}</small>}</>
const tokens = (trial: RunTrial) => trial.inputTokens === null && trial.outputTokens === null ? 'not recorded'
  : <>{formatTokens(trial.inputTokens)} in · {formatTokens(trial.outputTokens)} out{trial.cacheTokens ? <small>{formatTokens(trial.cacheTokens)} cached</small> : null}<small>{trial.tokenSource} usage</small></>
const TURN_SOURCES: Record<string, string> = {
  'ATIF agent steps': 'agent steps in saved trajectory',
  'claude-code num_turns': 'Claude Code native turns',
  'pi turn_start events': 'Pi turn-start events',
}
const turns = (trial: RunTrial) => <>{count(trial.turns)}{trial.turnSource && <small>{TURN_SOURCES[trial.turnSource] ?? trial.turnSource}</small>}{trial.turns !== null && <small>{trial.turnCap === null ? 'no cap recorded' : `${trial.turnCap}-turn cap`}</small>}</>
const started = (trial: RunTrial) => trial.startedAt ? new Date(trial.startedAt).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZone: 'UTC', timeZoneName: 'short' }) : 'not recorded'
const count = (value: number | null) => value === null ? 'not recorded' : String(value)

function Compare({ study, pair }: { study: RunStudy; pair: Pair }) {
  const [a, b] = pair
  const [copied, setCopied] = useState(false)
  const task = (trial: RunTrial) => study.tasks.find(item => item.id === trial.task)!
  const setup = b ? compareSetup(study, a, b) : null
  const metrics: [string, (trial: RunTrial) => React.ReactNode, string?][] = [
    ['Agent time', trial => formatDuration(trial.agentSeconds)],
    ['Total time', trial => formatDuration(trial.totalSeconds), 'with setup and tests'],
    ['Cost', cost],
    ['Tokens', tokens],
    ['Turns', turns, 'definitions vary by harness'],
    ['Model requests', trial => count(trial.modelRequests), 'measured at the gateway'],
    ['Stopped by', trial => errorLabel(trial.error) ?? 'finished'],
    ['Started', started],
  ]

  async function copyLink() {
    await navigator.clipboard?.writeText(`${location.origin}${location.pathname}${selectionSearch(study, pair, location.search)}#runs`)
    setCopied(true)
    setTimeout(() => setCopied(false), 1600)
  }

  return (
    <aside className="runs-compare" aria-label="Run comparison" aria-live="polite">
      <div className="runs-compare-head">
        <RunHeader study={study} trial={a} slot="A" />
        {b ? <RunHeader study={study} trial={b} slot="B" /> : <p className="runs-compare-empty">Pick another run to compare with A.</p>}
      </div>
      {setup && (
        <div className="runs-setup">
          {setup.constant.length > 0 && <p><span>Same</span>{setup.constant.map(field => <strong key={field.label}>{field.label} <em>{field.a}</em></strong>)}</p>}
          {setup.changed.length > 0 && <p className="is-changed"><span>Changed</span>{setup.changed.map(field => <strong key={field.label}>{field.label}</strong>)}</p>}
          {setup.unknown.length > 0 && <p><span>Unknown</span>{setup.unknown.map(field => <strong key={field.label}>{field.label}</strong>)}</p>}
        </div>
      )}
      <dl className="runs-metrics">
        {setup?.changed.map(field => <Metric key={field.label} label={field.label} a={field.a} b={field.b} />)}
        {setup?.unknown.map(field => <Metric key={field.label} label={field.label} a={field.a} b={field.b} />)}
        {!b && <Metric label="Task" a={task(a).name} />}
        {metrics.map(([label, value, hint]) => <Metric key={label} label={label} hint={hint} a={value(a)} b={b ? value(b) : undefined} />)}
      </dl>
      <div className="runs-compare-foot">
        <a href={`/library?new=1&goal=${study.varies === 'model' ? 'models' : 'harnesses'}&source=${encodeURIComponent(study.id)}`}>Run your own comparison <ArrowUpRight size={12} /></a>
        {[...new Map([a, b].flatMap(trial => trial ? [task(trial)] : []).filter(info => info.url).map(info => [info.id, info])).values()].map(info => (
          <a key={info.id} href={info.url!} target="_blank" rel="noreferrer">{info.repository} #{info.url!.split('/').pop()} <ArrowUpRight size={12} /></a>
        ))}
        <button type="button" onClick={copyLink}><Link2 size={13} />{copied ? 'Link copied' : 'Copy link'}</button>
      </div>
    </aside>
  )
}

export function RunDatabase() {
  const initial = useMemo(() => readSelection(database, typeof location === 'undefined' ? '' : location.search), [])
  const [study, setStudy] = useState(initial.study)
  const [pair, setPair] = useState<Pair>(initial.pair)
  const [highlight, setHighlight] = useState<Highlight>('all')
  const [touched, setTouched] = useState(false)
  const total = database.studies.reduce((sum, item) => sum + item.trials.length, 0)

  useEffect(() => {
    if (touched) history.replaceState(null, '', `${selectionSearch(study, pair, location.search)}#runs`)
  }, [study, pair, touched])

  function chooseStudy(next: RunStudy) {
    setStudy(next)
    setPair(readSelection(database, `?study=${next.id}`).pair)
    setTouched(true)
  }

  function pick(trial: RunTrial) {
    setTouched(true)
    setPair(([a, b]) => {
      if (trial.id === a.id) return b ? [b, null] : [a, null]
      if (trial.id === b?.id) return [a, null]
      return [a, trial]
    })
  }

  return (
    <section className="runs-section" id="runs" aria-labelledby="runs-heading">
      <div data-home-reveal className="runs-intro">
        <span className="kicker">RUN DATABASE</span>
        <h2 id="runs-heading">Every published run. Pick any two.</h2>
        <p>{total} attempts from {database.studies.length} studies, failures included. Select two runs to see what stayed the same and what changed.</p>
      </div>
      <div className="runs-toolbar">
        <div className="runs-studies" role="tablist" aria-label="Study">
          {database.studies.map(item => (
            <button key={item.id} id={`study-${item.id}`} type="button" role="tab" aria-controls="runs-panel" aria-selected={item.id === study.id} tabIndex={item.id === study.id ? 0 : -1} onClick={() => chooseStudy(item)} onKeyDown={event => {
              const index = database.studies.indexOf(item)
              const next = event.key === 'Home' ? 0 : event.key === 'End' ? database.studies.length - 1
                : event.key === 'ArrowRight' ? (index + 1) % database.studies.length
                : event.key === 'ArrowLeft' ? (index + database.studies.length - 1) % database.studies.length : null
              if (next === null) return
              event.preventDefault()
              chooseStudy(database.studies[next])
              document.getElementById(`study-${database.studies[next].id}`)?.focus()
            }}>
              <strong>{item.name}</strong><span>{item.summary} · {item.trials.length} runs</span>
            </button>
          ))}
        </div>
        <div className="runs-highlight" role="group" aria-label="Highlight runs">
          {(['all', 'passed', 'failed'] as const).map(value => (
            <button key={value} type="button" aria-pressed={highlight === value} onClick={() => setHighlight(value)}>{value === 'all' ? 'All' : value === 'passed' ? 'Passed' : 'Failed'}</button>
          ))}
        </div>
      </div>
      <div id="runs-panel" role="tabpanel" aria-labelledby={`study-${study.id}`}>
        <RunScatter key={study.id} study={study} pair={pair} highlight={highlight} onPick={pick} />
        <div className="runs-layout">
          <Matrix study={study} pair={pair} highlight={highlight} onPick={pick} />
          <Compare study={study} pair={pair} />
        </div>
      </div>
      <div className="runs-notes">
        <p>{study.notes.join(' ')} A sample this small shows what happened here, not a general ranking.</p>
        <a href={study.published.url} target="_blank" rel="noreferrer">Published study: {study.published.label} <ArrowUpRight size={12} /></a>
      </div>
    </section>
  )
}
