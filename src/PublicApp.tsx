import { ArrowRight } from 'lucide-react'
import { RunWorkbench } from './RunWorkbench'
import { Signup } from './Signup'
import type { AppAuth } from './auth'

export default function PublicApp({ auth }: { auth: AppAuth }) {
  return <><header className="nav-wrap"><nav className="nav shell"><a className="brand" href="/">Heval<span className="beta-pill">OPEN MODEL EVALUATIONS</span></a>
    <div className="public-nav"><a href="/reports">Your reports</a><a href="/studio">Studio</a><a href="https://github.com/MatthewFeroz/heval">Source</a>
      {auth.configured && <button className="nav-cta" onClick={auth.user ? auth.signOut : auth.signIn}>{auth.user ? 'Sign out' : 'Sign in'}</button>}</div></nav></header>
    <main><section className="hero public-hero shell"><span className="hero-badge">A PERSONAL OPEN MODEL PROJECT</span><h1>Show the work.<br />Then compare.</h1>
      <p className="hero-copy">Heval runs coding agents on the same task and checks what they actually fix. Inspect the attempt, compare the tests, and make a chart from the evidence.</p>
      <div className="hero-actions"><a className="primary-button" href="#evaluations">Run an evaluation <ArrowRight size={15} /></a><a className="text-button" href="/studio">Explore public results <ArrowRight size={15} /></a></div>
      <div className="hero-proof"><span>Open-source harnesses</span><span>Executable tests</span><span>Saved attempts</span></div>
    </section><RunWorkbench key={auth.user?.email || 'public'} auth={auth} /><Signup /></main>
    <footer className="public-footer shell">Heval · Open-source coding-agent evaluations</footer></>
}
