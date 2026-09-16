import { useEffect, useState, type ReactNode } from 'react'
import { CliWalkthrough } from './CliWalkthrough'
import type { GuideProgress, GuideStore } from './model'
import './onboarding.css'

export function GuideGate({ store, children }: { store: GuideStore; children: ReactNode }) {
  const [manual] = useState(() => new URLSearchParams(location.search).get('guide') === 'cli')
  const [state, setState] = useState<{ loading: boolean; progress: GuideProgress | null; error: boolean }>({ loading: true, progress: null, error: false })
  const [retry, setRetry] = useState(0)
  const [dismissed, setDismissed] = useState(false)
  useEffect(() => {
    let current = true
    void store.load().then(progress => { if (current) setState({ loading: false, progress, error: false }) })
      .catch(() => { if (current) setState({ loading: false, progress: null, error: true }) })
    return () => { current = false }
  }, [store, retry])

  function close(destination?: string) {
    if (destination) { location.assign(destination); return }
    if (manual) {
      const url = new URL(location.href)
      url.searchParams.delete('guide')
      history.replaceState(null, '', url)
    }
    setDismissed(true)
  }
  if (dismissed) return children
  if (state.loading) return <main className="cli-guide-loading" role="status">Opening your workspace…</main>
  if (state.error) return <main className="cli-guide-loading"><section className="cli-guide-recovery">
    <h1>Your workspace is ready.</h1><p role="alert">We couldn’t load your getting-started progress.</p>
    <button className="cli-guide-primary" onClick={() => { setState({ loading: true, progress: null, error: false }); setRetry(value => value + 1) }}>Try again</button>
    <button className="cli-guide-text-button" onClick={() => close()}>Continue without the guide</button>
  </section></main>
  if (!manual && state.progress && state.progress.status !== 'started') return children
  return <CliWalkthrough initialStep={manual ? 0 : state.progress?.step ?? 0} store={store} onClose={close} />
}
