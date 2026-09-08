import { HARNESS } from '../harnesses'
import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react'
import { Activity, ArrowUpDown, Check, ChevronDown, ChevronRight, Clock3, Coins, Copy, Cpu, Filter, Layers, ListFilter, X } from 'lucide-react'
import { type TrialRow } from '../charts/trial'
import { formatValue } from '../charts/recipes'
import { mean, median, nums } from '../charts/metrics'
type FilterKey = string
type Filters = Record<FilterKey, string[]>
const FILTER_KEYS: FilterKey[] = ['agent', 'modelShort', 'task']

export type RunSort = { key: 'passed' | 'agent' | 'modelShort' | 'task' | 'agentSeconds' | 'totalTokens' | 'costUsd'; dir: 1 | -1 }

const fmtTokens = (n: number | null | undefined) =>
  n === null || n === undefined ? '-' : n >= 1e6 ? `${(n / 1e6).toFixed(2)}M` : n >= 1e3 ? `${(n / 1e3).toFixed(n >= 1e5 ? 0 : 1)}k` : String(n)
const fmtSeconds = (s: number | null | undefined) =>
  s === null || s === undefined ? '-' : s >= 60 ? `${Math.floor(s / 60)}m ${Math.round(s % 60)}s` : `${s.toFixed(s < 10 ? 1 : 0)}s`
const fmtCost = (c: number | null | undefined) => (c === null || c === undefined ? '-' : `$${c.toFixed(c < 1 ? 3 : 2)}`)
const pct = (n: number) => `${Math.round(n * 100)}%`

/** Cache is a subset of input in the provider accounting, so split it out. */
function tokenSplit(r: TrialRow): { fresh: number; cache: number; out: number; total: number } | null {
  if (r.inputTokens === null && r.outputTokens === null) return null
  const input = r.inputTokens ?? 0
  const cache = Math.min(r.cacheTokens ?? 0, input)
  const out = r.outputTokens ?? 0
  return { fresh: input - cache, cache, out, total: input + out }
}

// -- stat tiles -------------------------------------------------------------

export function StatTiles({ rows }: { rows: TrialRow[] }) {
  const n = rows.length
  const passed = rows.filter((r) => r.passed).length
  const rate = n ? passed / n : 0
  const stacks = new Set(rows.map((r) => r.stack)).size
  const tasks = new Set(rows.map((r) => r.task)).size
  const agentT = nums(rows, 'agentSeconds')
  const costs = nums(rows, 'costUsd')
  const tokens = nums(rows, 'totalTokens')
  const fresh = rows.reduce((a, r) => a + Math.max(0, (r.inputTokens ?? 0) - Math.min(r.cacheTokens ?? 0, r.inputTokens ?? 0)), 0)
  const cache = rows.reduce((a, r) => a + Math.min(r.cacheTokens ?? 0, r.inputTokens ?? 0), 0)
  const out = rows.reduce((a, r) => a + (r.outputTokens ?? 0), 0)
  const tokTotal = fresh + cache + out || 1

  return (
    <div className="stats">
      <div className="stat">
        <div className="stat-head"><span className="eyebrow">Pass rate</span><Activity size={14} /></div>
        <strong>{n ? pct(rate) : '-'}</strong>
        <small>{passed} of {n} trials passed</small>
        <div className="bar"><i style={{ width: `${rate * 100}%` }} /></div>
      </div>
      <div className="stat">
        <div className="stat-head"><span className="eyebrow">Trials</span><Layers size={14} /></div>
        <strong>{n}</strong>
        <small>{stacks} {stacks === 1 ? 'stack' : 'stacks'} · {tasks} {tasks === 1 ? 'task' : 'tasks'}</small>
        <div className="split">
          <i style={{ width: `${(passed / (n || 1)) * 100}%`, background: 'var(--pass)' }} />
          <i style={{ width: `${((n - passed) / (n || 1)) * 100}%`, background: 'var(--fail)' }} />
        </div>
      </div>
      <div className="stat">
        <div className="stat-head"><span className="eyebrow">Agent time</span><Clock3 size={14} /></div>
        <strong>{fmtSeconds(mean(agentT))}<small>mean</small></strong>
        <small>median {fmtSeconds(median(agentT))} · agent step only</small>
      </div>
      <div className="stat">
        <div className="stat-head"><span className="eyebrow">Cost</span><Coins size={14} /></div>
        <strong>{fmtCost(mean(costs))}<small>/ trial</small></strong>
        <small>
          {costs.length ? `${fmtCost(costs.reduce((a, b) => a + b, 0))} total` : 'not exposed by the gateway'}
          {costs.length && costs.length < n ? ` · ${n - costs.length} unpriced` : ''}
        </small>
      </div>
      <div className="stat">
        <div className="stat-head"><span className="eyebrow">Tokens</span><Cpu size={14} /></div>
        <strong>{fmtTokens(tokens.length ? tokens.reduce((a, b) => a + b, 0) : null)}</strong>
        <small>{tokens.length ? `${fmtTokens(mean(tokens))} per trial · ${pct(cache / tokTotal)} cache hits` : 'not reported'}</small>
        <div className="split">
          <i className="tok-in" style={{ width: `${(fresh / tokTotal) * 100}%` }} />
          <i className="tok-cache" style={{ width: `${(cache / tokTotal) * 100}%` }} />
          <i className="tok-out" style={{ width: `${(out / tokTotal) * 100}%` }} />
        </div>
      </div>
    </div>
  )
}

// -- filters -------------------------------------------------------------------

const FILTER_LABEL: Record<FilterKey, string> = { agent: 'Harness', modelShort: 'Model', task: 'Task' }

export function FilterBar({ rows, dimensions, filters, onToggle, onClear }: {
  rows: TrialRow[]
  dimensions: { key: string; label: string }[]
  filters: Filters
  onToggle: (key: FilterKey, value: string) => void
  onClear: () => void
}) {
  const [open, setOpen] = useState<FilterKey | null>(null)
  const [added, setAdded] = useState<string[]>([])
  const keys = [...new Set([...FILTER_KEYS, ...added, ...Object.keys(filters).filter((key) => filters[key].length)])]
  const wrap = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => { if (!wrap.current?.contains(e.target as Node)) setOpen(null) }
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(null) }
    window.addEventListener('mousedown', onDown)
    window.addEventListener('keydown', onKey)
    return () => { window.removeEventListener('mousedown', onDown); window.removeEventListener('keydown', onKey) }
  }, [open])

  const counts = (key: FilterKey) => {
    const m = new Map<string, number>()
    for (const r of rows) m.set(String(r[key]), (m.get(String(r[key])) ?? 0) + 1)
    return [...m.entries()].sort((a, b) => a[0].localeCompare(b[0]))
  }
  const active = Object.values(filters).some((values) => values.length > 0)

  return (
    <div className="filters" ref={wrap}>
      <span className="eyebrow label"><ListFilter size={11} />Filter</span>
      {keys.map((key) => {
        const values = filters[key] ?? []
        const on = values.length > 0
        return (
          <div className="filter-menu" key={key}>
            <button
              type="button"
              className={`chip${on ? ' on' : ''}`}
              aria-expanded={open === key}
              aria-haspopup="menu"
              onClick={() => setOpen((o) => (o === key ? null : key))}
            >
              {FILTER_LABEL[key] ?? dimensions.find((field) => field.key === key)?.label ?? key}
              {on ? <small>{values.length === 1 ? values[0] : `${values.length} selected`}</small> : <small>all</small>}
              <ChevronDown size={12} />
            </button>
            {open === key && (
              <div className="menu" role="menu">
                {counts(key).map(([value, n]) => (
                  <button
                    key={value}
                    type="button"
                    role="menuitemcheckbox"
                    aria-checked={values.includes(value)}
                    onClick={() => onToggle(key, value)}
                  >
                    <span>{value}</span>
                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}><small>{n}</small><Check size={13} /></span>
                  </button>
                ))}
              </div>
            )}
          </div>
        )
      })}
      <select aria-label="Add filter" value="" onChange={(event) => { setAdded((current) => [...current, event.target.value]); setOpen(event.target.value) }}>
        <option value="">Add filter…</option>
        {dimensions.filter((field) => !keys.includes(field.key)).map((field) => <option key={field.key} value={field.key}>{field.label}</option>)}
      </select>
      {active && (
        <button type="button" className="btn ghost sm" onClick={onClear}><X size={12} />Clear</button>
      )}
    </div>
  )
}

// -- trial list (trace viewer) ------------------------------------------------

function Avatar({ agent }: { agent: string }) {
  const h = HARNESS[agent]
  const style = { '--runner-color': h?.color ?? '#8d9290' } as CSSProperties
  return (
    <span className="avatar" style={style} aria-hidden="true">
      {h ? <img src={h.logo} alt="" /> : agent.slice(0, 2).toUpperCase()}
    </span>
  )
}

function TokenBar({ row, max, thick }: { row: TrialRow; max: number; thick?: boolean }) {
  const t = tokenSplit(row)
  if (!t) return <small>-</small>
  const w = (n: number) => `${(n / (max || 1)) * 100}%`
  return (
    <div className="split" style={thick ? { height: 6 } : undefined} title={`${fmtTokens(t.fresh)} fresh · ${fmtTokens(t.cache)} cache · ${fmtTokens(t.out)} out`}>
      <i className="tok-in" style={{ width: w(t.fresh) }} />
      <i className="tok-cache" style={{ width: w(t.cache) }} />
      <i className="tok-out" style={{ width: w(t.out) }} />
    </div>
  )
}

export function RunList({ rows, sort, onSort, selected, onSelect }: {
  rows: TrialRow[]
  sort: RunSort
  onSort: (key: RunSort['key']) => void
  selected: string | null
  onSelect: (id: string) => void
}) {
  const max = Math.max(1, ...rows.map((r) => tokenSplit(r)?.total ?? 0))
  const sorted = useMemo(() => {
    const val = (r: TrialRow) => r[sort.key]
    return [...rows].sort((a, b) => {
      const x = val(a), y = val(b)
      if (x === y) return a.trial.localeCompare(b.trial)
      if (x === null || x === undefined) return 1
      if (y === null || y === undefined) return -1
      return (typeof x === 'number' && typeof y === 'number' ? x - y : String(x).localeCompare(String(y))) * sort.dir
    })
  }, [rows, sort])

  const th = (key: RunSort['key'], label: string, cls = '') => (
    <th className={cls}>
      <button type="button" className={sort.key === key ? 'on' : ''} onClick={() => onSort(key)}>
        {label}<ArrowUpDown size={9} />
      </button>
    </th>
  )

  return (
    <div className="panel">
      <div className="card-head">
        <div className="title"><Activity size={13} /><span>Trials</span><small>{rows.length} runs · click a row for the trace detail</small></div>
        <div className="right"><small>tokens: fresh / cache / output</small></div>
      </div>
      {rows.length ? (
        <table className="runs">
          <thead>
            <tr className="run-head">
              <th colSpan={2}>
                <button type="button" className={sort.key === 'passed' ? 'on' : ''} onClick={() => onSort('passed')}>
                  Result<ArrowUpDown size={9} />
                </button>
              </th>
              {th('agent', 'Harness')}
              {th('modelShort', 'Model', 'hide-mobile')}
              {th('task', 'Task')}
              <th className="hide-narrow">Tokens</th>
              {th('agentSeconds', 'Agent', 'num hide-mobile')}
              {th('costUsd', 'Cost', 'num')}
              <th />
            </tr>
          </thead>
          <tbody>
            {sorted.map((r) => {
              const h = HARNESS[r.agent]
              const t = tokenSplit(r)
              return (
                <tr
                  key={r.trial}
                  className="run-row"
                  aria-selected={selected === r.trial}
                  tabIndex={0}
                  onClick={() => onSelect(r.trial)}
                  onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onSelect(r.trial) } }}
                >
                  <td><span className={`status ${r.passed ? 'pass' : 'fail'}`} title={r.passed ? 'passed' : 'failed'} /></td>
                  <td><Avatar agent={r.agent} /></td>
                  <td className="who">
                    <strong>{h?.name ?? r.agent}</strong>
                    <small>{r.agent}{r.agentVersion ? ` ${r.agentVersion}` : ''}</small>
                  </td>
                  <td className="what hide-mobile">
                    <strong>{r.modelShort}</strong>
                    <small>{r.provider ?? '-'}</small>
                  </td>
                  <td className="what">
                    <strong>{r.task}</strong>
                    <small>{r.taskFull ?? ''}</small>
                  </td>
                  <td className="tokens hide-narrow">
                    <TokenBar row={r} max={max} />
                    <small>{t ? `${fmtTokens(t.total)} · ${pct(t.total ? t.cache / t.total : 0)} cached` : 'not reported'}</small>
                  </td>
                  <td className="num hide-mobile">{fmtSeconds(r.agentSeconds)}</td>
                  <td className={`num${r.costUsd === null ? ' faint' : ''}`}>{fmtCost(r.costUsd)}</td>
                  <td className="chev"><ChevronRight size={14} /></td>
                </tr>
              )
            })}
          </tbody>
        </table>
      ) : (
        <div className="empty-runs">No trials match the active filters.</div>
      )}
    </div>
  )
}

export function RunDrawer({ row, onClose, onFocus, onCopy, copied }: {
  row: TrialRow
  onClose: () => void
  onFocus: () => void
  onCopy: () => void
  copied: boolean
}) {
  const h = HARNESS[row.agent]
  const t = tokenSplit(row)
  const overhead = row.totalSeconds !== null && row.agentSeconds !== null ? row.totalSeconds - row.agentSeconds : null
  return (
    <aside className="drawer" role="dialog" aria-label={`Trial ${row.trial}`}>
      <div className="drawer-head">
        <Avatar agent={row.agent} />
        <div className="who">
          <strong>{h?.name ?? row.agent} · {row.modelShort}</strong>
          <small>{row.trial}</small>
        </div>
        <span className={`pill ${row.passed ? 'pass' : 'fail'}`}><i />{row.passed ? 'passed' : 'failed'}</span>
        <button type="button" className="btn icon ghost" aria-label="Close" onClick={onClose}><X size={14} /></button>
      </div>

      <div className="drawer-body">
        <div className="mini-stats">
          <div className="mini-stat"><span>Reward</span><strong>{formatValue(row.reward, 'reward')}</strong></div>
          <div className="mini-stat"><span>Agent</span><strong>{fmtSeconds(row.agentSeconds)}</strong></div>
          <div className="mini-stat"><span>Cost</span><strong>{fmtCost(row.costUsd)}</strong></div>
        </div>

        <section>
          <span className="eyebrow">Tokens</span>
          {t ? (
            <>
              <TokenBar row={row} max={t.total} thick />
              <div className="tok-legend">
                <span><i className="tok-in" />{fmtTokens(t.fresh)} fresh</span>
                <span><i className="tok-cache" />{fmtTokens(t.cache)} cache</span>
                <span><i className="tok-out" />{fmtTokens(t.out)} out</span>
              </div>
            </>
          ) : <p className="hint">The provider reported no token usage for this trial.</p>}
        </section>

        <section>
          <span className="eyebrow">Stack</span>
          <dl className="kv">
            <dt>Harness</dt><dd>{row.agent}{row.agentVersion ? <span className="dim"> · {row.agentVersion}</span> : null}</dd>
            <dt>Model</dt><dd className="mono">{row.model}</dd>
            <dt>Provider</dt><dd>{row.provider ?? '-'}</dd>
          </dl>
        </section>

        <section>
          <span className="eyebrow">Task</span>
          <dl className="kv">
            <dt>Task</dt><dd>{row.taskFull ?? row.task}</dd>
            <dt>Checksum</dt><dd className="mono">{row.taskChecksum ?? '-'}</dd>
          </dl>
        </section>

        <section>
          <span className="eyebrow">Timing</span>
          <dl className="kv">
            <dt>Agent step</dt><dd className="mono">{fmtSeconds(row.agentSeconds)}</dd>
            <dt>Total</dt><dd className="mono">{fmtSeconds(row.totalSeconds)}</dd>
            <dt>Overhead</dt><dd className="mono">{overhead !== null ? `${fmtSeconds(overhead)} build + verify` : '-'}</dd>
            <dt>Started</dt><dd className="mono">{row.startedAt ? row.startedAt.replace('T', ' ').slice(0, 19) : '-'}</dd>
          </dl>
        </section>

        {row.error && (
          <section>
            <span className="eyebrow">Error</span>
            <pre>{row.error}</pre>
          </section>
        )}
      </div>

      <div className="drawer-foot">
        <button type="button" className="btn sm" onClick={onFocus}><Filter size={12} />Focus this stack</button>
        <button type="button" className="btn sm ghost" onClick={onCopy}>{copied ? <Check size={12} /> : <Copy size={12} />}{copied ? 'Copied' : 'Copy trial id'}</button>
      </div>
    </aside>
  )
}
