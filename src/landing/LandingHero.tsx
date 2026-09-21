import { useEffect, useRef } from 'react'
import { ArrowRight, ArrowUpRight, Play } from 'lucide-react'
import { startHomeMotion } from './motion'

const harnesses = [
  { id: 'claude', name: 'Claude Code', logo: 'claude.svg' },
  { id: 'opencode', name: 'OpenCode', logo: 'opencode.svg' },
  { id: 'antigravity', name: 'Antigravity', logo: 'antigravity.png' },
  { id: 'codex', name: 'Codex CLI', logo: 'codex.svg' },
  { id: 'grok', name: 'Grok', logo: 'grok.svg' },
  { id: 'pi', name: 'Pi Agent', logo: 'pi.svg' },
  { id: 'cursor', name: 'Cursor', logo: 'cursor.svg' },
  { id: 'deep-agents', name: 'Deep Agents', logo: 'deepagents.svg' },
  { id: 'deepseek', name: 'DeepSeek Harness', logo: 'deepseek.svg' },
]

export function LandingHero() {
  const hero = useRef<HTMLElement>(null)
  const field = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (hero.current && field.current) return startHomeMotion({ hero: hero.current, field: field.current })
  }, [])

  return (
    <section className="hero" ref={hero} aria-labelledby="hero-title">
      <div className="hero-grid" aria-hidden="true" />
      <div className="hero-harnesses" ref={field} role="group" aria-label="Coding agent harness ecosystem">
        {harnesses.map(harness => (
          <span className={`hero-float-mark hf-${harness.id}`} key={harness.id}>
            <span className="hero-harness"><img src={`/harnesses/${harness.logo}`} alt={harness.name} width="64" height="64" /></span>
          </span>
        ))}
      </div>
      <div className="hero-inner shell">
        <h1 id="hero-title"><span>The open-source</span>{' '}<span>evaluation platform</span>{' '}<span>for coding agents.</span></h1>
        <p className="hero-copy">Compare Claude Code, Codex, OpenCode, Pi, Deep Agents, Antigravity, Cursor, Grok, and DeepSeek Harness.<br className="hero-copy-break" /> Run evaluations locally with Harbor. Inspect every trial. Share the evidence.</p>
        <div className="hero-actions">
          <a className="primary-button" href="/evaluations"><Play size={21} />Create an evaluation<ArrowRight size={19} /></a>
          <a className="hero-github" href="https://github.com/MatthewFeroz/heval" target="_blank" rel="noreferrer" aria-label="Explore the code on GitHub">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M12 .5C5.65.5.5 5.65.5 12a11.5 11.5 0 007.86 10.93c.58.1.79-.25.79-.56v-2c-3.2.69-3.88-1.37-3.88-1.37-.52-1.33-1.27-1.69-1.27-1.69-1.04-.71.08-.7.08-.7 1.15.08 1.76 1.18 1.76 1.18 1.02 1.76 2.68 1.25 3.33.96.1-.75.4-1.25.72-1.54-2.55-.29-5.24-1.27-5.24-5.67 0-1.25.45-2.28 1.18-3.08-.12-.29-.51-1.45.11-3.02 0 0 .96-.31 3.15 1.18a10.96 10.96 0 015.74 0c2.19-1.49 3.15-1.18 3.15-1.18.62 1.57.23 2.73.11 3.02.74.8 1.18 1.83 1.18 3.08 0 4.41-2.7 5.38-5.27 5.66.41.36.78 1.06.78 2.13v3.16c0 .31.21.67.8.56A11.5 11.5 0 0023.5 12C23.5 5.65 18.35.5 12 .5z" /></svg>
            Explore the code <ArrowUpRight size={15} />
          </a>
          <p className="hero-links">Already have results? <a href="/reports">Open your report library <ArrowUpRight size={13} /></a></p>
        </div>
      </div>
    </section>
  )
}
