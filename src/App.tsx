import { useEffect, useRef, useState } from 'react'
import { Terminal } from '@xterm/xterm'
import '@xterm/xterm/css/xterm.css'
import {
  ArrowRight,
  BarChart3,
  ChevronDown,
  Clock3,
  Coins,
  ExternalLink,
  LogIn,
  LogOut,
  Pause,
  Play,
  RotateCcw,
  Trophy,
  Zap,
} from 'lucide-react'
import { featuredExperiment, type RunEvent, type Runner } from './data'
import resultCatalog from '../results/harbor/index.json'
import featuredResults from '../results/harbor/terminal-bench-comparison.json'
import { publicAuth, type AppAuth } from './auth'
import { Signup } from './Signup'
import { RunWorkbench } from './RunWorkbench'
import { STATIC_SITE } from './deployment'
import { LandingHero } from './landing/LandingHero'
import { useSectionMotion } from './landing/useSectionMotion'
import './landing/landing.css'

const runnerEnd = (runner: Runner) => Math.max(...runner.events.map((event) => event.at))
const maxTime = Math.max(...featuredExperiment.runners.map(runnerEnd))
const featuredJob = {
  job: featuredResults.job,
  models: [...new Set(featuredResults.rows.map((row) => row.model))],
  tasks: [...new Set(featuredResults.rows.map((row) => row.task))],
  trials: featuredResults.rows.length,
}
const completionResults = featuredJob.models.map((model) => {
  const rows = featuredResults.rows.filter((row) => row.model === model)
  return { model: rows[0].modelShort, passed: rows.filter((row) => row.passed === 1).length, total: rows.length }
}).sort((a, b) => b.passed / b.total - a.passed / a.total)
const studioUrl = `/studio?job=${featuredJob.job}&recipe=bar&x=modelShort&color=none&measure=passed`

const formatTokens = (tokens: number | null) => tokens === null ? 'pending' : `${(tokens / 1000).toFixed(1)}k`

function Brand() {
  return (
    <a className="brand" href="#top" aria-label="Heval home">
      <span className="brand-name">heval</span>
    </a>
  )
}

function Nav({ auth }: { auth: AppAuth }) {
  return (
    <header className="nav-wrap">
      <nav className="nav shell">
        <Brand />
        <div className="nav-actions">
          <a className="nav-github" href="https://github.com/MatthewFeroz/heval" target="_blank" rel="noreferrer">
            <svg width="17" height="17" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M12 .5C5.65.5.5 5.65.5 12a11.5 11.5 0 007.86 10.93c.58.1.79-.25.79-.56v-2c-3.2.69-3.88-1.37-3.88-1.37-.52-1.33-1.27-1.69-1.27-1.69-1.04-.71.08-.7.08-.7 1.15.08 1.76 1.18 1.76 1.18 1.02 1.76 2.68 1.25 3.33.96.1-.75.4-1.25.72-1.54-2.55-.29-5.24-1.27-5.24-5.67 0-1.25.45-2.28 1.18-3.08-.12-.29-.51-1.45.11-3.02 0 0 .96-.31 3.15 1.18a10.96 10.96 0 015.74 0c2.19-1.49 3.15-1.18 3.15-1.18.62 1.57.23 2.73.11 3.02.74.8 1.18 1.83 1.18 3.08 0 4.41-2.7 5.38-5.27 5.66.41.36.78 1.06.78 2.13v3.16c0 .31.21.67.8.56A11.5 11.5 0 0023.5 12C23.5 5.65 18.35.5 12 .5z" /></svg>
            GitHub
          </a>
          {auth.configured && (auth.user
            ? <button className="nav-cta auth-button" onClick={auth.signOut} title={`Sign out ${auth.user.email}`}>{auth.user.firstName || auth.user.email} <LogOut size={15} /></button>
            : <button className="nav-cta auth-button" onClick={auth.signIn} disabled={auth.isLoading}>Sign in <LogIn size={15} /></button>)}
        </div>
      </nav>
    </header>
  )
}

const ansi = {
  reset: '\x1b[0m',
  dim: '\x1b[2m',
  bold: '\x1b[1m',
  gray: '\x1b[38;2;128;128;128m',
  darkGray: '\x1b[38;2;102;102;102m',
  white: '\x1b[38;2;238;238;238m',
  purple: '\x1b[38;2;190;140;245m',
  blue: '\x1b[38;2;92;156;245m',
  orange: '\x1b[38;2;245;167;66m',
  teal: '\x1b[38;2;138;190;183m',
  yellow: '\x1b[38;2;240;198;116m',
  greenBg: '\x1b[48;2;36;49;38m',
  userBg: '\x1b[48;2;52;52;64m',
  openBg: '\x1b[48;2;30;30;30m',
}

const line = (text = '') => `${text}\r\n`

function terminalFrame(runner: Runner, events: RunEvent[], isDone: boolean) {
  const task = 'Fix the race condition in the async cache and make the full test suite pass.'
  const recent = events.slice(-4)
  const activity = recent.map((event) => {
    const tool = event.kind === 'edit' ? 'Edit' : event.kind === 'test' ? 'Bash' : event.kind === 'inspect' ? 'Read' : event.kind === 'think' ? 'Thinking' : event.kind === 'finish' ? 'Done' : 'System'
    return { ...event, tool }
  })

  if (runner.id === 'claude-code') {
    let out = line(` ${ansi.bold}▐▛███▛█${ansi.reset}   ${ansi.bold}Claude Code v2.1.251${ansi.reset}`)
    out += line(`${ansi.bold}▝▜██████▀${ansi.reset}  Opus 5 · Claude Team`)
    out += line(`  ▝▝ ▝▝    ~/benchmark/concurrent-cache`)
    out += line()
    out += line(`  ${ansi.gray}Tackle your toughest work with Opus 5. Switch anytime with /model.${ansi.reset}`)
    out += line()
    out += line(`${ansi.purple}❯${ansi.reset} ${task}`)
    out += line()
    activity.forEach((event) => { out += line(`  ${ansi.purple}${event.tool === 'Thinking' ? '✻' : '⏺'} ${event.tool}${ansi.reset} ${event.text}`); out += line(`    ${ansi.gray}${event.detail || ''}${ansi.reset}`) })
    out += line(`${ansi.gray}${'─'.repeat(96)}${ansi.reset}`)
    out += line(`${ansi.bold}❯${ansi.reset} ${ansi.gray}${isDone ? 'Try “review my changes”' : ''}${ansi.reset}`)
    out += line(`${ansi.gray}${'─'.repeat(96)}${ansi.reset}`)
    out += line(`  ${ansi.gray}⏵⏵ auto mode on (shift+tab to cycle) · ← for agents${ansi.reset}`)
    return out
  }

  if (runner.id === 'codex') {
    let out = line(`${ansi.dim}╭──────────────────────────────────────────────╮${ansi.reset}`)
    out += line(`${ansi.dim}│ >_ ${ansi.reset}${ansi.bold}OpenAI Codex${ansi.reset}${ansi.dim} (v0.150.1)                   │${ansi.reset}`)
    out += line(`${ansi.dim}│                                              │${ansi.reset}`)
    out += line(`${ansi.dim}│ model:     ${ansi.reset}gpt-5.6-sol${ansi.dim}   /model to change    │${ansi.reset}`)
    out += line(`${ansi.dim}│ directory: ${ansi.reset}~/benchmark/concurrent-cache${ansi.dim}      │${ansi.reset}`)
    out += line(`${ansi.dim}╰──────────────────────────────────────────────╯${ansi.reset}`)
    out += line()
    out += line(`  ${ansi.bold}Tip:${ansi.reset} ${ansi.dim}Use /statusline to configure the status line.${ansi.reset}`)
    out += line()
    out += line(`${ansi.bold}›${ansi.reset} ${task}`)
    out += line()
    activity.forEach((event) => { out += line(`${ansi.dim}•${ansi.reset} ${ansi.bold}${event.tool}${ansi.reset} ${event.text}`); out += line(`  ${ansi.dim}${event.detail || ''}${ansi.reset}`) })
    out += line()
    out += line(`${ansi.bold}›${ansi.reset} ${ansi.dim}Ask Codex to do anything${ansi.reset}${isDone ? '' : ' ▌'}`)
    out += line(`  ${ansi.dim}gpt-5.6-sol default · ~/benchmark/concurrent-cache${ansi.reset}`)
    return out
  }

  if (runner.id === 'opencode') {
    let out = line()
    out += line(`              ${ansi.gray}                   ${ansi.white}${ansi.bold}             ▄${ansi.reset}`)
    out += line(`              ${ansi.gray}█▀▀█ █▀▀█ █▀▀█ █▀▀▄ ${ansi.white}${ansi.bold}█▀▀▀ █▀▀█ █▀▀█ █▀▀▀${ansi.reset}`)
    out += line(`              ${ansi.gray}█  █ █  █ █▀▀▀ █  █ ${ansi.white}${ansi.bold}█   █ █  █ █  █ █▀▀▀${ansi.reset}`)
    out += line(`              ${ansi.gray}▀▀▀▀ █▀▀▀ ▀▀▀▀ ▀  ▀ ${ansi.white}${ansi.bold}▀▀▀▀ ▀▀▀▀ ▀▀▀▀ ▀▀▀▀${ansi.reset}`)
    out += line()
    out += line(`  ${ansi.blue}┃${ansi.openBg}${' '.repeat(92)}${ansi.reset}`)
    out += line(`  ${ansi.blue}┃${ansi.openBg}  ${task.padEnd(90)}${ansi.reset}`)
    out += line(`  ${ansi.blue}┃${ansi.openBg}${' '.repeat(92)}${ansi.reset}`)
    out += line(`  ${ansi.blue}┃${ansi.openBg}  ${ansi.blue}Build${ansi.reset}${ansi.openBg} · ${ansi.white}GPT-5.6${ansi.gray} OpenAI${' '.repeat(67)}${ansi.reset}`)
    out += line(`  ${ansi.blue}╹${ansi.reset}${ansi.darkGray}${'▀'.repeat(92)}${ansi.reset}`)
    activity.forEach((event) => { out += line(`  ${ansi.blue}┃ ${event.tool}${ansi.reset} ${event.text}`); out += line(`    ${ansi.gray}${event.detail || ''}${ansi.reset}`) })
    if (!activity.length) out += line(`     ${ansi.orange}● Tip${ansi.reset} ${ansi.gray}Run ${ansi.white}/connect${ansi.gray} to add an AI provider${ansi.reset}`)
    out += line()
    out += line(`  ${ansi.gray}~/benchmark/concurrent-cache${' '.repeat(34)}1.18.25${ansi.reset}`)
    return out
  }

  let out = line(` ${ansi.bold}${ansi.teal}pi${ansi.reset}${ansi.darkGray} v0.84.4${ansi.reset}`)
  out += line(` ${ansi.darkGray}escape${ansi.gray} interrupt · ${ansi.darkGray}ctrl+c/ctrl+d${ansi.gray} clear/exit · ${ansi.darkGray}/${ansi.gray} commands · ${ansi.darkGray}!${ansi.gray} bash${ansi.reset}`)
  out += line(` ${ansi.darkGray}Press ctrl+o to show full startup help and loaded resources.${ansi.reset}`)
  out += line()
  out += line(`${ansi.userBg} ${task.padEnd(94)}${ansi.reset}`)
  out += line()
  activity.forEach((event) => { const bg = event.kind === 'edit' || event.kind === 'test' ? ansi.greenBg : ''; out += line(`${bg}${ansi.bold}${event.tool.toLowerCase()}${ansi.reset}${bg} ${event.text.padEnd(60)}${ansi.reset}`); out += line(`${bg}${ansi.gray}${event.detail || ''}${ansi.reset}`) })
  out += line(isDone ? 'Task complete.' : `${ansi.dim}Thinking…${ansi.reset}`)
  out += line(`${ansi.darkGray}${'─'.repeat(96)}${ansi.reset}`)
  out += line(isDone ? ' ' : '\x1b[7m \x1b[0m')
  out += line(`${ansi.darkGray}${'─'.repeat(96)}${ansi.reset}`)
  out += line(`${ansi.darkGray}~/benchmark/concurrent-cache${ansi.reset}`)
  out += line(`${ansi.darkGray}0.0%/272k (auto)                         (openai) gpt-5.6 · medium${ansi.reset}`)
  return out
}

function HarnessTui({ runner, visibleEvents, isDone, rawData }: { runner: Runner; visibleEvents: RunEvent[]; isDone: boolean; rawData?: string }) {
  const host = useRef<HTMLDivElement>(null)
  const terminal = useRef<Terminal | null>(null)

  useEffect(() => {
    if (!host.current) return
    const term = new Terminal({
      cols: 96,
      rows: 24,
      convertEol: true,
      cursorBlink: true,
      disableStdin: true,
      fontFamily: '"DM Mono", "SFMono-Regular", Consolas, monospace',
      fontSize: 9,
      lineHeight: 1.08,
      scrollback: 0,
      theme: { background: runner.id === 'opencode' ? '#0a0a0a' : runner.id === 'pi-agent' ? '#282c34' : '#0d0e0e', foreground: '#d8d8d4', cursor: '#f0f0ec' },
    })
    term.open(host.current)
    terminal.current = term
    const observer = new ResizeObserver(([entry]) => {
      const size = Math.max(8, Math.min(14, entry.contentRect.width / 55))
      term.options.fontSize = size
      term.refresh(0, term.rows - 1)
    })
    observer.observe(host.current)
    return () => { observer.disconnect(); term.dispose(); terminal.current = null }
  }, [runner.id])

  useEffect(() => {
    terminal.current?.write(`\x1b[2J\x1b[H${rawData || terminalFrame(runner, visibleEvents, isDone)}`)
  }, [runner, visibleEvents, isDone, rawData])

  return <div className="real-terminal" ref={host} aria-label={`${runner.name} terminal replay`} />
}

function RunnerLane({ runner, time, focused, onFocus, rawData, liveStatus, onLiveRun }: { runner: Runner; time: number; focused: boolean; onFocus: () => void; rawData?: string; liveStatus?: string; onLiveRun: () => void }) {
  const visibleEvents = runner.events.filter((event) => event.at <= time)
  const replayDuration = runnerEnd(runner)
  const progress = Math.min(time / replayDuration, 1)
  const isDone = progress === 1
  const elapsed = Math.round(runner.duration * progress)

  return (
    <article
      className={`runner-lane ${focused ? 'focused' : ''} ${isDone ? runner.outcome : ''}`}
      style={{ '--runner-color': runner.color } as React.CSSProperties}
      onClick={onFocus}
    >
      <div className="lane-head">
        <div className="runner-avatar"><img src={runner.logo} alt="" /></div>
        <div className="runner-title">
          <strong>{runner.name}</strong>
          <span>{runner.version}</span>
        </div>
        <div className={`lane-state ${isDone ? runner.outcome : 'running'}`}>
          <span />{liveStatus || (isDone ? runner.outcome : 'running')}
        </div>
        {!STATIC_SITE && <button className="live-run-button" onClick={(event) => { event.stopPropagation(); onLiveRun() }}>{liveStatus === 'running' ? 'LIVE' : 'RUN REAL'}</button>}
      </div>
      <div className="model-row">
        <span>{runner.model}</span>
        <small>{runner.provider}</small>
      </div>
      <div className="terminal-body">
        <div className="terminal-top"><span /><span /><span /><small>~/benchmark/{featuredExperiment.task}</small></div>
        <HarnessTui runner={runner} visibleEvents={visibleEvents} isDone={isDone} rawData={rawData} />
      </div>
      <div className="lane-progress"><span style={{ width: `${progress * 100}%` }} /></div>
      <div className="lane-stats">
        <span><Coins size={13} /> {runner.cost === null ? 'pending' : `$${(runner.cost * progress).toFixed(2)}`}</span>
        <span><Clock3 size={13} /> {elapsed}s</span>
        <span><Zap size={13} /> {runner.tokens === null ? formatTokens(null) : formatTokens(Math.round(runner.tokens * progress))}</span>
      </div>
    </article>
  )
}

function RaceStage({ auth }: { auth: AppAuth }) {
  const [time, setTime] = useState(0)
  const [playing, setPlaying] = useState(false)
  const [focused, setFocused] = useState<string | null>(null)
  const finished = time >= maxTime

  async function startLiveRun(harness: string) {
    if (!auth.user) {
      if (auth.configured) auth.signIn()
      else window.alert('Real runs require WorkOS AuthKit to be configured.')
      return
    }
    window.dispatchEvent(new CustomEvent('heval-configure', { detail: harness }))
    document.getElementById('evaluations')?.scrollIntoView({ behavior: 'smooth' })
  }

  useEffect(() => {
    if (!playing) return
    const timer = window.setInterval(() => {
      setTime((current) => {
        if (current >= maxTime) {
          setPlaying(false)
          return maxTime
        }
        return current + 1
      })
    }, 180)
    return () => window.clearInterval(timer)
  }, [playing])

  const togglePlayback = () => {
    if (finished) setTime(0)
    setPlaying((value) => !value || finished)
  }

  return (
    <div className="race-shell">
      <div className="race-toolbar">
        <div className="window-dots"><span /><span /><span /></div>
        <div className="race-meta">
          <span className="example-chip">INTERACTIVE EXAMPLE</span>
          <span>SAMPLE DATA</span>
        </div>
        <a className="manifest-button" href="#methodology">View demo protocol <ExternalLink size={13} /></a>
      </div>
      <div className="task-strip">
        <div className="task-number">01</div>
        <div>
          <span className="eyebrow">{featuredExperiment.type} · {featuredExperiment.task}</span>
          <p>{featuredExperiment.prompt}</p>
        </div>
        <div className="task-tags"><span>{featuredExperiment.language}</span><span>{featuredExperiment.difficulty}</span></div>
      </div>
      <div className={`runner-grid ${focused ? 'has-focus' : ''}`}>
        {featuredExperiment.runners.map((runner) => (
          <RunnerLane
            key={runner.id}
            runner={runner}
            time={time}
            focused={focused === runner.id}
            onFocus={() => setFocused((value) => value === runner.id ? null : runner.id)}
            onLiveRun={() => startLiveRun(runner.id)}
          />
        ))}
      </div>
      <div className="playback">
        <button className="play-button" onClick={togglePlayback} aria-label={playing ? 'Pause replay' : 'Play replay'}>
          {playing ? <Pause size={16} fill="currentColor" /> : finished ? <RotateCcw size={16} /> : <Play size={16} fill="currentColor" />}
        </button>
        <span className="play-time">{String(time).padStart(2, '0')}s</span>
        <input aria-label="Replay timeline" type="range" min="0" max={maxTime} value={time} onChange={(event) => { setPlaying(false); setTime(Number(event.target.value)) }} />
        <span className="play-time">{maxTime}s</span>
        <button className="speed-button">5× <ChevronDown size={12} /></button>
      </div>
      {finished && (
        <div className="race-verdict">
          <Trophy size={18} />
          <span><strong>Example replay complete.</strong> These scripted events illustrate the replay controls. Explore published evaluations in Studio for measured results.</span>
          <button onClick={() => { setTime(0); setPlaying(true) }}>Replay <RotateCcw size={13} /></button>
        </div>
      )}
    </div>
  )
}

function StudioShowcase() {
  return (
    <section data-home-reveal className="studio-showcase shell" aria-labelledby="studio-heading">
      <div className="studio-intro">
        <span className="kicker">THE WORKSPACE</span>
        <h2 id="studio-heading">Turn evaluation results<br />into a clear comparison.</h2>
        <p>Open a published evaluation or bring your own export. Compare success rates, cost, and time; filter down to a task; then inspect the trials behind each chart.</p>
        <a className="text-button" href={studioUrl}>Explore this evaluation <ArrowRight size={16} /></a>
      </div>
      <div className="evaluation-card">
        <div className="evaluation-header"><span>FEATURED EVALUATION</span><span className="dataset-badge">Published data</span></div>
        <h3>Six models. The same task set.</h3>
        <p>Terminal Bench Comparison · Codex harness</p>
        <dl className="evaluation-stats">
          <div><dt>Models</dt><dd>{featuredJob.models.length}</dd></div>
          <div><dt>Tasks</dt><dd>{featuredJob.tasks.length}</dd></div>
          <div><dt>Trials</dt><dd>{featuredJob.trials}</dd></div>
        </dl>
        <div className="completion-chart" role="figure" aria-label="Completed tasks by model, measured evaluation results">
          <div className="completion-heading"><strong>Tasks completed</strong><span>Passed / attempted</span></div>
          {completionResults.map((result) => (
            <div className="completion-row" key={result.model}>
              <span>{result.model}</span>
              <div className="completion-track" aria-hidden="true"><i style={{ width: `${result.passed / result.total * 100}%` }} /></div>
              <strong>{result.passed}<span> / {result.total}</span></strong>
            </div>
          ))}
        </div>
        <div className="evaluation-actions">
          <a href={studioUrl}><BarChart3 size={17} /><span><strong>Compare completion rates</strong><small>Open the interactive chart in Studio</small></span><ArrowRight size={16} /></a>
          <a href={`/results/harbor/${featuredJob.job}.html`}><ExternalLink size={17} /><span><strong>Read the full report</strong><small>Results, individual trials, and limitations</small></span><ArrowRight size={16} /></a>
        </div>
        <p className="evaluation-note">One attempt per model per task. Results describe this task set; small differences may not generalize.</p>
      </div>
    </section>
  )
}

function ReportSection() {
  return (
    <section className="reports-section section-pad" id="reports">
      <div className="shell">
        <div data-home-reveal className="section-heading reports-heading">
          <div><span className="kicker">PUBLISHED EVALUATIONS</span><h2>Start with the evidence.</h2></div>
          <a href="/studio">Open all results in Studio <ArrowRight size={15} /></a>
        </div>
        <div className="report-grid">
          {resultCatalog.jobs.map((job) => (
            <article data-home-reveal className="report-card" key={job.job}>
              <div className="report-top"><span>{job.trials > 4 ? 'Model comparison' : 'Smoke test'}</span><small>{job.generatedAt.slice(0, 10)}</small></div>
              <div className="report-count"><strong>{job.trials}</strong><span>recorded {job.trials === 1 ? 'trial' : 'trials'}</span></div>
              <h3>{job.job.split('-').join(' ')}</h3>
              <p>{job.models.length} {job.models.length === 1 ? 'model' : 'models'} · {job.tasks.length} {job.tasks.length === 1 ? 'task' : 'tasks'} · {job.agents.length} {job.agents.length === 1 ? 'harness' : 'harnesses'}. Read the outcomes and limitations, or explore the underlying data.</p>
              <div className="report-foot">
                <a href={`/results/harbor/${job.job}.html`}>Read report <ArrowRight size={14} /></a>
                <a href={`/studio?job=${job.job}`}>Open in Studio</a>
              </div>
            </article>
          ))}
        </div>
      </div>
    </section>
  )
}

function Methodology() {
  const steps = [
    ['01', 'Pin the stack', 'Harness, model, configuration, task image, budget, and evaluator are recorded in one manifest.'],
    ['02', 'Run in isolation', 'Every candidate starts from the same clean task environment under the same time and token limits.'],
    ['03', 'Grade the artifact', 'Tests decide correctness. Blinded review adds code-quality context without replacing executable evidence.'],
    ['04', 'Publish everything', 'Replayable traces, diffs, scores, costs, and known limitations ship together with the conclusion.'],
  ]

  return (
    <section className="method-section shell section-pad" id="methodology">
      <div data-home-reveal className="section-heading centered-heading"><span className="kicker">NO MAGIC SCORE</span><h2>Evidence you can inspect.</h2><p>Enough rigor to make comparisons useful. Enough transparency to disagree with us.</p></div>
      <div className="method-grid">
        {steps.map(([number, title, copy]) => <div data-home-reveal className="method-step" key={number}><span>{number}</span><h3>{title}</h3><p>{copy}</p></div>)}
      </div>
    </section>
  )
}

function Footer() {
  return (
    <footer className="footer shell">
      <Brand />
      <p>A workbench for understanding coding-agent evaluations.</p>
      <div><a href="#methodology">Methodology</a><a href="#reports">Reports</a><a href="/studio">Studio</a><a href="https://github.com/MatthewFeroz/heval" target="_blank" rel="noreferrer">GitHub</a></div>
      <small>© 2026 Heval</small>
    </footer>
  )
}

export default function App({ auth = publicAuth }: { auth?: AppAuth }) {
  const landing = useRef<HTMLDivElement>(null)
  useSectionMotion(landing)
  return (
    <div className="landing-page" ref={landing}>
      <Nav auth={auth} />
      <main id="top">
        <LandingHero />
        <section data-home-reveal className="race-area shell" id="compare" aria-labelledby="replay-heading">
          <div className="section-heading split-heading replay-heading">
            <div><span className="kicker">INSIDE AN AGENT RUN</span><h2 id="replay-heading">See how a replay works.</h2></div>
            <p>Play or scrub through four sample agent timelines. Select a lane to focus on its actions. This is a scripted illustration; measured evaluations are available in Studio.</p>
          </div>
          <RaceStage auth={auth} />
        </section>
        <StudioShowcase />
        {!STATIC_SITE && <RunWorkbench key={auth.user?.email || 'public'} auth={auth} />}
        <ReportSection />
        <Methodology />
        {!STATIC_SITE && <Signup />}
      </main>
      <Footer />
    </div>
  )
}
