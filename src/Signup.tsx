import { useState, type FormEvent } from 'react'

export function Signup() {
  const [email, setEmail] = useState('')
  const [consent, setConsent] = useState(false)
  const [state, setState] = useState<'idle' | 'saving' | 'saved'>('idle')
  const [error, setError] = useState('')
  async function submit(event: FormEvent) {
    event.preventDefault()
    setState('saving'); setError('')
    try {
      const response = await fetch('/api/signups', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, consent }) })
      if (!response.ok) throw new Error((await response.json()).error || 'Could not save your signup.')
      setState('saved'); setEmail('')
    } catch (cause) { setState('idle'); setError(cause instanceof Error ? cause.message : 'Could not save your signup. Please retry.') }
  }
  return <section className="signup-section signup-panel shell" id="early-access">
    <div className="signup-copy"><div className="signup-intro"><span className="kicker">FOLLOW THE PROJECT</span><h2>See the next evaluation.</h2>
      <p>Occasional Heval project updates and new public comparisons.</p></div><div className="signup-controls">
      {state === 'saved' ? <p role="status">You’re on the list.</p> : <form onSubmit={submit} className="signup-form">
        <label>Email<input type="email" required autoComplete="email" placeholder="you@company.com" value={email} onChange={event => setEmail(event.target.value)} /></label>
        <label className="signup-consent"><input type="checkbox" required checked={consent} onChange={event => setConsent(event.target.checked)} />I agree to receive Heval project updates by email.</label>
        <button disabled={state === 'saving'}>{state === 'saving' ? 'Saving…' : 'Get early access'}</button>
      </form>}
      {error && <p role="alert">{error}</p>}
      <small>We use your email only for Heval project updates.</small>
    </div></div>
  </section>
}
