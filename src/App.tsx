import { useEffect, useMemo, useRef, useState } from 'react'
import { Terminal } from '@xterm/xterm'
import '@xterm/xterm/css/xterm.css'
import {
  Activity,
  ArrowRight,
  BarChart3,
  ChevronDown,
  Clock3,
  Code2,
  Coins,
  ExternalLink,
  Gauge,
  GitFork,
  Layers3,
  LogIn,
  LogOut,
  Pause,
  Play,
  RotateCcw,
  TerminalSquare,
  TimerReset,
  Trophy,
  X,
  Zap,
} from 'lucide-react'
import { featuredExperiment, reports, type RunEvent, type Runner } from './data'
import { publicAuth, type AppAuth } from './auth'
import { Signup } from './Signup'
import { RunWorkbench } from './RunWorkbench'

const runnerEnd = (runner: Runner) => Math.max(...runner.events.map((event) => event.at))
const maxTime = Math.max(...featuredExperiment.runners.map(runnerEnd))

const formatTokens = (tokens: number | null) => tokens === null ? 'pending' : `${(tokens / 1000).toFixed(1)}k`

function Brand() {
  return (
    <a className="brand" href="#top" aria-label="Heval home">
      <span className="brand-mark"><span>H</span></span>
      <span className="brand-name">Heval</span>
      <span className="beta-pill">HARNESS EVALS</span>
    </a>
  )
}

function Nav({ auth }: { auth: AppAuth }) {
  const [open, setOpen] = useState(false)

  return (
    <header className="nav-wrap">
      <nav className="nav shell">
        <Brand />
        <div className={`nav-links ${open ? 'open' : ''}`}>
          <a href="#compare">Compare</a>
          <a href="#reports">Reports</a>
          <a href="#methodology">Methodology</a>
          <a href="/studio">Studio</a>
          <a className="github-link" href="https://github.com" target="_blank" rel="noreferrer"><GitFork size={16} /> GitHub</a>
        </div>
        {auth.configured && (auth.user
          ? <button className="nav-cta auth-button" onClick={auth.signOut} title={`Sign out ${auth.user.email}`}>{auth.user.firstName || auth.user.email} <LogOut size={15} /></button>
          : <button className="nav-cta auth-button" onClick={auth.signIn} disabled={auth.isLoading}>Sign in <LogIn size={15} /></button>)}
        {!auth.configured && <a className="nav-cta" href="#early-access">Get early access <ArrowRight size={15} /></a>}
        <button className="menu-button" onClick={() => setOpen((value) => !value)} aria-label="Toggle navigation">
          {open ? <X size={19} /> : <span className="menu-lines" />}
        </button>
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
        <button className="live-run-button" onClick={(event) => { event.stopPropagation(); onLiveRun() }}>{liveStatus === 'running' ? 'LIVE' : 'RUN REAL'}</button>
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
    <div className="race-shell" id="compare">
      <div className="race-toolbar">
        <div className="window-dots"><span /><span /><span /></div>
        <div className="race-meta">
          <span className="live-chip"><i /> SEEDED UI REPLAY</span>
          <span>RUN #HI-0042</span>
          <span>{featuredExperiment.completedAt}</span>
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
          <span><strong>All four harnesses passed.</strong> Codex had the fastest observed trajectory, but one attempt is not a ranking.</span>
          <button onClick={() => { setTime(0); setPlaying(true) }}>Replay <RotateCcw size={13} /></button>
        </div>
      )}
    </div>
  )
}

function Stat({ icon, value, label }: { icon: React.ReactNode; value: string; label: string }) {
  return <div className="stat"><span className="stat-icon">{icon}</span><strong>{value}</strong><small>{label}</small></div>
}

function Scoreboard() {
  const sorted = useMemo(() => [...featuredExperiment.runners].sort((a, b) => a.duration - b.duration), [])

  return (
    <section className="score-section shell section-pad">
      <div className="section-heading split-heading">
        <div><span className="kicker">ILLUSTRATIVE RESULT</span><h2>One task. Four very<br />different paths.</h2></div>
        <p>This synthetic example shows how a completed comparison will read. It demonstrates the product, not measured harness performance.</p>
      </div>
      <div className="score-layout">
        <div className="leaderboard-card">
          <div className="card-head"><span>Demo result</span><small>Illustrative data · not a benchmark</small></div>
          {sorted.map((runner, index) => (
            <div className="score-row" key={runner.id}>
              <span className="rank">0{index + 1}</span>
              <span className="score-avatar" style={{ '--runner-color': runner.color } as React.CSSProperties}><img src={runner.logo} alt="" /></span>
              <span className="score-name"><strong>{runner.name}</strong><small>{runner.model}</small></span>
              <span className="score-bar"><i style={{ width: `${runner.score}%`, background: runner.color }} /></span>
              <strong className="score-value">PASS</strong>
            </div>
          ))}
        </div>
        <div className="metrics-grid">
          <Stat icon={<Trophy size={18} />} value="1/1" label="Tests passed" />
          <Stat icon={<Gauge size={18} />} value="32s" label="Example fastest" />
          <Stat icon={<Coins size={18} />} value="Pending" label="Cost integration" />
          <Stat icon={<TimerReset size={18} />} value="4/4" label="Demo outcomes" />
        </div>
      </div>
    </section>
  )
}

function ReportSection() {
  return (
    <section className="reports-section section-pad" id="reports">
      <div className="shell">
        <div className="section-heading reports-heading">
          <div><span className="kicker">UPCOMING FIELD NOTES</span><h2>Read the signal,<br />not the launch post.</h2></div>
          <a href="#early-access">Get the first report <ArrowRight size={15} /></a>
        </div>
        <div className="report-grid">
          {reports.map((report, index) => (
            <article className={`report-card report-${index + 1}`} key={report.title}>
              <div className="report-top"><span>{report.tag}</span><small>{report.date}</small></div>
              <div className="report-visual" aria-hidden="true">
                {index === 0 && <><div className="mini-bars"><i /><i /><i /><i /><i /><i /></div><span className="delta">+31%</span></>}
                {index === 1 && <><div className="version-a">.120</div><ArrowRight /><div className="version-b">.121</div></>}
                {index === 2 && <><Activity /><div className="retry-lines"><i /><i /><i /></div></>}
              </div>
              <h3>{report.title}</h3>
              <p>{report.summary}</p>
              <div className="report-foot"><span>{report.readTime}</span><span>Planned</span></div>
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
      <div className="section-heading centered-heading"><span className="kicker">NO MAGIC SCORE</span><h2>Evidence you can inspect.</h2><p>Enough rigor to make comparisons useful. Enough transparency to disagree with us.</p></div>
      <div className="method-grid">
        {steps.map(([number, title, copy]) => <div className="method-step" key={number}><span>{number}</span><h3>{title}</h3><p>{copy}</p></div>)}
      </div>
    </section>
  )
}

function Footer() {
  return (
    <footer className="footer shell">
      <Brand />
      <p>An independent performance index for coding-agent stacks.</p>
      <div><a href="#methodology">Methodology</a><a href="#reports">Reports</a><a href="/studio">Studio</a><a href="https://github.com" target="_blank" rel="noreferrer">GitHub</a></div>
      <small>© 2026 Heval</small>
    </footer>
  )
}

export default function App({ auth = publicAuth }: { auth?: AppAuth }) {
  return (
    <>
      <Nav auth={auth} />
      <main id="top">
        <section className="hero shell">
          <div className="hero-badge"><Layers3 size={14} /> Harness evals for coding agents</div>
          <h1>Heval.</h1>
          <p className="hero-copy">See how coding-agent stacks will be compared side by side—with pinned versions, replayable trajectories, cost, speed, and outcomes.</p>
          <div className="hero-actions"><a className="primary-button" href="#compare"><Play size={15} fill="currentColor" /> Watch the product demo</a><a className="text-button" href="#methodology">See the methodology <ArrowRight size={15} /></a></div>
          <div className="hero-proof"><span>Pinned versions</span><span>Reproducible tasks</span><span>Full trajectories</span></div>
        </section>
        <section className="race-area shell"><RaceStage auth={auth} /></section>
        <div className="index-strip"><div className="shell"><span><Code2 size={14} /> 4 harnesses modeled</span><span><BarChart3 size={14} /> Interactive replay</span><span><TerminalSquare size={14} /> 1 demo task</span><span><Activity size={14} /> Configure real evaluations below</span></div></div>
        <RunWorkbench key={auth.user?.email || 'public'} auth={auth} />
        <Scoreboard />
        <ReportSection />
        <Methodology />
        <Signup />
      </main>
      <Footer />
    </>
  )
}
