import { useRef, useState } from 'react'
import {
  ArrowRight,
  BarChart3,
  Clock3,
  Coins,
  ExternalLink,
  Zap,
} from 'lucide-react'
import { featuredExperiment, type Runner } from './data'
import featuredResults from '../results/harbor/terminal-bench-comparison.json'
import { publicAuth, type AppAuth } from './auth'
import { Signup } from './Signup'
import { RunWorkbench } from './RunWorkbench'
import { STATIC_SITE } from './deployment'
import { LandingHero } from './landing/LandingHero'
import { HarnessTui } from './landing/HarnessTui'
import { useSectionMotion } from './landing/useSectionMotion'
import { useDemoAutoplay } from './landing/useDemoAutoplay'
import { Brand, SiteHeader } from './components/SiteHeader'
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
          <span>{runner.version} · demo</span>
        </div>
        <div className="lane-tools">
          <div className="lane-stats" aria-label="Sample run metrics">
            <span title="Cost" aria-label={`Cost: ${runner.cost === null ? 'pending' : `$${(runner.cost * progress).toFixed(2)}`}`}><Coins size={12} /> {runner.cost === null ? 'pending' : `$${(runner.cost * progress).toFixed(2)}`}</span>
            <span className="lane-elapsed" title="Elapsed time" aria-label={`Elapsed time: ${elapsed} seconds`}><Clock3 size={12} /> {elapsed}s</span>
            <span title="Tokens" aria-label={`Tokens: ${runner.tokens === null ? 'pending' : Math.round(runner.tokens * progress)}`}><Zap size={12} /> {runner.tokens === null ? formatTokens(null) : formatTokens(Math.round(runner.tokens * progress))}</span>
          </div>
          <div className={`lane-state ${isDone ? runner.outcome : time ? 'running' : 'ready'}`}>
            <span />{liveStatus || (isDone ? runner.outcome : time ? 'running' : 'ready')}
          </div>
          {!STATIC_SITE && <button className="live-run-button" onClick={(event) => { event.stopPropagation(); onLiveRun() }}>{liveStatus === 'running' ? 'LIVE' : 'RUN REAL'}</button>}
        </div>
      </div>
      <div className="terminal-body">
        <HarnessTui runner={runner} visibleEvents={visibleEvents} isDone={isDone} started={time > 0} rawData={rawData} />
      </div>
    </article>
  )
}

function RaceStage({ auth }: { auth: AppAuth }) {
  const demo = useRef<HTMLDivElement>(null)
  const time = useDemoAutoplay(demo, maxTime)
  const [focused, setFocused] = useState<string | null>(null)

  async function startLiveRun(harness: string) {
    if (!auth.user) {
      if (auth.configured) auth.signIn()
      else window.alert('Real runs require WorkOS AuthKit to be configured.')
      return
    }
    window.dispatchEvent(new CustomEvent('heval-configure', { detail: harness }))
    document.getElementById('evaluations')?.scrollIntoView({ behavior: 'smooth' })
  }

  return (
    <div className="replay-demo" ref={demo} role="group" aria-label="Scripted coding-agent demo">
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
      <div><a href="#methodology">Methodology</a><a href="/reports">Reports</a><a href="/studio">Studio</a><a href="https://github.com/MatthewFeroz/heval" target="_blank" rel="noreferrer">GitHub</a></div>
      <small>© 2026 Heval</small>
    </footer>
  )
}

export default function App({ auth = publicAuth }: { auth?: AppAuth }) {
  const landing = useRef<HTMLDivElement>(null)
  useSectionMotion(landing)
  return (
    <div className="landing-page" ref={landing}>
      <SiteHeader auth={auth} />
      <main id="top">
        <LandingHero />
        <section data-home-reveal className="race-area" id="compare" aria-label="Interactive coding-agent replay">
          <RaceStage auth={auth} />
        </section>
        <StudioShowcase />
        {!STATIC_SITE && <RunWorkbench key={auth.user?.email || 'public'} auth={auth} />}
        <Methodology />
        {!STATIC_SITE && <Signup />}
      </main>
      <Footer />
    </div>
  )
}
