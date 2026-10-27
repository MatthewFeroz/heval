import { useRef } from 'react'
import { publicAuth, type AppAuth } from './auth'
import { Signup } from './Signup'
import { STATIC_SITE } from './deployment'
import { LandingHero } from './landing/LandingHero'
import { RunDatabase } from './landing/RunDatabase'
import { StudiesRail } from './landing/StudiesRail'
import { useSectionMotion } from './landing/useSectionMotion'
import { Brand, SiteHeader } from './components/SiteHeader'
import './landing/landing.css'

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
      <div><a href="#methodology">Methodology</a><a href="/library">Library</a><a href="/explore">Explore</a><a href="/settings">Settings</a><a href="https://github.com/MatthewFeroz/heval" target="_blank" rel="noreferrer">GitHub</a></div>
      <small>© 2026 OpenEval</small>
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
        <RunDatabase />
        <StudiesRail />
        <Methodology />
        {!STATIC_SITE && <Signup />}
      </main>
      <Footer />
    </div>
  )
}
