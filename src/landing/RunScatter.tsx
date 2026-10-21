import { useEffect, useRef, useState } from 'react'
import { formatDuration, outcome, stackLabel, type Pair, type RunStudy, type RunTrial } from '../runs/database'
import { scatterAxis, scatterMedian, scatterTrials, type ScatterMode } from '../runs/scatter'

const COLORS = ['#69aaff', '#ee9474', '#6acba7', '#e0bd65', '#e58fb5', '#b4a1ef']
const costTick = (value: number) => `$${Number(value.toPrecision(2))}`
const measuredCost = (value: number | null) => value === null ? 'not recorded' : `$${value.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 6 })}`

export function RunScatter({ study, pair, highlight, onPick }: {
  study: RunStudy; pair: Pair; highlight: 'all' | 'passed' | 'failed'; onPick: (trial: RunTrial) => void
}) {
  const container = useRef<HTMLDivElement>(null)
  const [width, setWidth] = useState(760)
  const [mode, setMode] = useState<ScatterMode>('log')
  const [hidden, setHidden] = useState<string[]>([])
  const [inspected, setInspected] = useState<RunTrial | null>(null)
  const [activeId, setActiveId] = useState(pair[0].id)
  const measured = scatterTrials(study.trials, mode)
  const visible = measured.filter(trial => !hidden.includes(trial.stack))
  // Domains stay fixed when stacks are hidden, so filtering never moves other runs.
  const x = scatterAxis(measured.map(trial => trial.agentSeconds), mode)
  const y = scatterAxis(measured.map(trial => trial.costUsd), mode)
  const compact = width < 500
  const height = compact ? 290 : 330
  const margin = { left: 54, right: 30, top: 30, bottom: 45 }
  const X = (value: number) => margin.left + x.position(value) * (width - margin.left - margin.right)
  const Y = (value: number) => height - margin.bottom - y.position(value) * (height - margin.top - margin.bottom)
  const color = (stack: string) => COLORS[study.stacks.findIndex(item => item.id === stack) % COLORS.length]
  const slot = (trial: RunTrial) => pair[0].id === trial.id ? 'A' : pair[1]?.id === trial.id ? 'B' : null
  const stackName = (trial: RunTrial) => stackLabel(study, study.stacks.find(stack => stack.id === trial.stack)!)
  const taskName = (trial: RunTrial) => study.tasks.find(task => task.id === trial.task)?.name ?? trial.task
  const description = (trial: RunTrial) => `${stackName(trial)} on ${taskName(trial)}: ${outcome(trial).toLowerCase()}, ${measuredCost(trial.costUsd)}, ${formatDuration(trial.agentSeconds)}`
  const active = visible.find(trial => trial.id === activeId) ?? visible[0]
  const detail = inspected && visible.some(trial => trial.id === inspected.id) ? inspected : null
  const timeTicks = mode === 'log'
    ? (compact ? [30, 300, 1800, 10800, 36000] : [30, 60, 120, 300, 600, 1800, 3600, 10800, 36000])
    : [0, .25, .5, .75, 1].map(fraction => fraction * x.max)
  const costTicks = mode === 'log'
    ? Array.from({ length: 10 }, (_, i) => 10 ** (i - 5)).flatMap(value => compact ? [value] : [value, value * 3])
    : [0, .25, .5, .75, 1].map(fraction => fraction * y.max)
  const within = (value: number, axis: typeof x) => value >= axis.min && value <= axis.max

  useEffect(() => {
    const observer = new ResizeObserver(entries => setWidth(Math.max(280, entries[0].contentRect.width)))
    if (container.current) observer.observe(container.current)
    return () => observer.disconnect()
  }, [])

  function movePoint(event: React.KeyboardEvent<SVGGElement>, trial: RunTrial) {
    const index = visible.findIndex(item => item.id === trial.id)
    const next = event.key === 'Home' ? 0 : event.key === 'End' ? visible.length - 1
      : event.key === 'ArrowRight' || event.key === 'ArrowDown' ? (index + 1) % visible.length
      : event.key === 'ArrowLeft' || event.key === 'ArrowUp' ? (index + visible.length - 1) % visible.length : null
    if (next !== null) {
      event.preventDefault()
      const target = visible[next]
      setActiveId(target.id)
      container.current?.querySelector<SVGGElement>(`[data-trial-index="${study.trials.indexOf(target)}"]`)?.focus()
    } else if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault()
      onPick(trial)
    } else if (event.key === 'Escape') setInspected(null)
  }

  return (
    <div className="runs-scatter" role="region" aria-label="Cost vs. time chart">
      <div className="runs-scatter-main">
        <div className="runs-scatter-heading">
          <div><h3>Cost vs. time</h3><p>One dot per run. Lower left is cheaper and faster.</p></div>
          <div className="runs-highlight" role="group" aria-label="Chart scales">
            {(['log', 'linear'] as const).map(value => <button key={value} type="button" aria-pressed={mode === value} onClick={() => setMode(value)}>{value === 'log' ? 'Log' : 'Linear'}</button>)}
          </div>
        </div>
        <div className="runs-scatter-plot" ref={container}>
          <svg width="100%" height={height} viewBox={`0 0 ${width} ${height}`} role="group" aria-label="Run costs against agent time" aria-describedby="runs-scatter-help">
            <g className="runs-scatter-axes" aria-hidden="true">
              <text x={margin.left} y={15}>Cost · USD</text>
              {timeTicks.filter(value => within(value, x)).map(value => <g key={value}>
                <line x1={X(value)} x2={X(value)} y1={margin.top} y2={height - margin.bottom} />
                <text x={X(value)} y={height - margin.bottom + 19} textAnchor="middle">{formatDuration(value)}</text>
              </g>)}
              {costTicks.filter(value => within(value, y)).map(value => <g key={value}>
                <line x1={margin.left} x2={width - margin.right} y1={Y(value)} y2={Y(value)} />
                <text x={margin.left - 8} y={Y(value) + 4} textAnchor="end">{costTick(value)}</text>
              </g>)}
              <text x={width - margin.right} y={height - 4} textAnchor="end">Agent time →</text>
            </g>
            {study.stacks.filter(stack => !hidden.includes(stack.id)).map(stack => {
              const median = scatterMedian(measured.filter(trial => trial.stack === stack.id))
              return median && <path key={stack.id} className="runs-scatter-median" d="M0,-7 L7,0 L0,7 L-7,0 Z" transform={`translate(${X(median.seconds)},${Y(median.cost)})`} stroke={color(stack.id)} aria-hidden="true" />
            })}
            {/* Selected points render last, keeping their outlines above nearby runs. */}
            {[...visible].sort((a, b) => Number(Boolean(slot(a))) - Number(Boolean(slot(b)))).map(trial => {
              const selected = slot(trial)
              const dim = highlight === 'passed' ? !trial.passed : highlight === 'failed' ? trial.passed : false
              return <g key={trial.id} role="button" tabIndex={active?.id === trial.id ? 0 : -1} aria-pressed={Boolean(selected)} aria-label={`Chart run ${description(trial)}${selected ? `, selected as ${selected}` : ''}`}
                data-trial-index={study.trials.indexOf(trial)} className={`runs-scatter-point ${dim && !selected ? 'is-dimmed' : ''}`}
                transform={`translate(${X(trial.agentSeconds)},${Y(trial.costUsd)})`}
                onClick={() => { setActiveId(trial.id); setInspected(trial); onPick(trial) }}
                onPointerEnter={() => setInspected(trial)} onPointerLeave={() => setInspected(null)}
                onFocus={() => { setActiveId(trial.id); setInspected(trial) }} onBlur={() => setInspected(null)} onKeyDown={event => movePoint(event, trial)}>
                <circle r={10} className="runs-scatter-focus" />
                <circle r={6} fill={trial.passed ? color(trial.stack) : 'var(--panel)'} stroke={color(trial.stack)} strokeWidth={trial.passed ? 1 : 2} />
                {selected && <g aria-hidden="true" className="runs-scatter-selection">
                  <circle r={11} />
                  <rect x={12} y={-22} width={16} height={16} rx={4} />
                  <text x={20} y={-10} textAnchor="middle">{selected}</text>
                </g>}
              </g>
            })}
          </svg>
        </div>
        <div className="runs-scatter-detail" aria-live="polite" aria-atomic="true">
          {detail ? <><strong>{stackName(detail)} · {taskName(detail)}</strong><span>{outcome(detail)} · {formatDuration(detail.agentSeconds)} · {measuredCost(detail.costUsd)}{detail.costSource ? ` · ${detail.costSource}` : ' · cost source not recorded'}</span></>
            : <><strong>{visible.length} of {study.trials.length} runs shown</strong><span>Point to a run for details. Select it for the A/B comparison below.</span></>}
        </div>
        <p className="runs-scatter-help" id="runs-scatter-help">{mode === 'log' ? 'Both axes use log scales: equal spacing means equal ratios.' : 'Both axes use linear scales, starting at zero.'} Use arrow keys to move between dots and Enter to select.</p>
        {measured.length < study.trials.length && <p className="runs-scatter-help">{study.trials.length - measured.length} runs cannot be plotted on these axes. Missing or invalid measurements stay in the grid.{mode === 'log' && ' Choose Linear to include recorded zeros.'}</p>}
      </div>
      <div className="runs-scatter-legend">
        <h4>{study.varies === 'model' ? 'Models' : 'Harnesses'}</h4>
        <p>Toggle visibility in this chart.</p>
        <div role="group" aria-label="Chart stacks">
          {study.stacks.map(stack => <button key={stack.id} type="button" aria-pressed={!hidden.includes(stack.id)} onClick={() => setHidden(current => current.includes(stack.id) ? current.filter(id => id !== stack.id) : [...current, stack.id])}>
            <i style={{ background: color(stack.id) }} aria-hidden="true" /><span>{stackLabel(study, stack)}</span><small>{study.trials.filter(trial => trial.stack === stack.id).length} runs</small>
          </button>)}
        </div>
        <div className="runs-scatter-keys">
          <span><i className="is-filled" />Passed</span><span><i />Failed or timed out</span><span><i className="is-diamond" />Median cost and time</span>
          <p>Medians include passes and failures. A diamond combines two medians; it is not an actual run.</p>
        </div>
      </div>
    </div>
  )
}
