import { useEffect, useState, type FormEvent } from 'react'
import { Check, KeyRound, ShieldCheck, X } from 'lucide-react'
import { authorizedFetch, type AppAuth } from './auth'
import type { ConnectionStatus } from '../server/connections'

const endpoint = '/api/connections/merge-gateway'
export function ProviderSettings({ auth, onChanged, onClose }: { auth: AppAuth; onChanged: () => void; onClose: () => void }) {
  const [connection, setConnection] = useState<ConnectionStatus | null>(null)
  const [key, setKey] = useState('')
  const [editing, setEditing] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')
  useEffect(() => {
    const controller = new AbortController()
    void authorizedFetch(auth, endpoint, { signal: controller.signal }).then(async response => {
      const body = await response.json()
      if (!response.ok) throw new Error(body.error || 'Could not load provider settings.')
      if (!controller.signal.aborted) setConnection(body)
    }).catch(cause => { if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : 'Could not load provider settings.') })
    return () => controller.abort()
  }, [auth])

  async function update(action: 'connect' | 'validate' | 'delete') {
    const apiKey = key
    setKey(''); setBusy(true); setError(''); setMessage('')
    try {
      const response = await authorizedFetch(auth, endpoint, { method: action === 'delete' ? 'DELETE' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        ...(action === 'delete' ? {} : { body: JSON.stringify({ action, ...(action === 'connect' ? { apiKey } : {}) }) }),
      })
      const body = await response.json()
      if (!response.ok) throw new Error(body.error || 'Could not update the connection.')
      setConnection(body); setEditing(false); setDeleting(false)
      setMessage(action === 'delete' ? 'Connection deleted. You can connect a new key whenever you need it.' : action === 'validate' ? 'Connection validated. The model list is up to date.' : 'Connection saved. Choose a model below to run an evaluation.')
      onChanged()
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not update the connection.') }
    finally { setBusy(false) }
  }
  function submit(event: FormEvent) { event.preventDefault(); void update('connect') }
  return <section className="provider-settings" id="provider-settings" aria-labelledby="provider-settings-title">
    <div className="provider-intro"><span className="kicker">SETTINGS / PROVIDERS</span><h3 id="provider-settings-title">Your key. <br />Your evaluations.</h3>
      <p>Connect your account to run open models with your own credits.</p>
      <ol><li className={connection?.connected ? 'done' : 'current'}>Connect provider</li><li className={connection?.connected ? 'done' : ''}>Validate connection</li><li>Configure and run</li></ol>
      <p className="provider-security"><ShieldCheck size={17} />Keys are encrypted on the server. Evaluation workers receive temporary run tokens.</p>
    </div>
    <div className="provider-controls"><div className="provider-title"><h4><KeyRound size={18} />Provider settings</h4><button type="button" className="provider-icon" aria-label="Close provider settings" onClick={onClose} disabled={busy}><X size={18} /></button></div>
      {!connection && !error && <p role="status">Loading connection…</p>}
      {connection && <>
        <div className="provider-connection"><strong>Merge Gateway</strong><span className={connection.connected ? 'connected' : ''}>{connection.connected ? <><Check size={13} /> Connected</> : 'Not connected'}</span></div>
        {connection.connected && <p className="provider-timestamp">Last validated {new Date(connection.validatedAt!).toLocaleString()}</p>}
        {(!connection.connected || editing) && <form onSubmit={submit} className="provider-form">
          <label>Provider<select value="merge-gateway" disabled><option value="merge-gateway">Merge Gateway</option></select></label>
          <label>Gateway API key<input type="password" autoComplete="new-password" autoCapitalize="none" spellCheck={false} value={key} onChange={event => setKey(event.target.value)} maxLength={4096} placeholder="Paste your Gateway key" required disabled={busy} /></label>
          <p className="provider-hint">Validation checks the model catalog without running an evaluation. Your key is never shown again after saving.</p>
          {editing && <p className="provider-hint">Replacing the key stops your active evaluations. An invalid replacement keeps your existing connection.</p>}
          <div className="provider-actions"><button className="primary-button" disabled={busy || !key.trim()}>{busy ? 'Validating…' : editing ? 'Validate and replace key' : 'Validate and connect'}</button>{editing && <button type="button" disabled={busy} onClick={() => { setEditing(false); setKey('') }}>Cancel</button>}</div>
        </form>}
        {connection.connected && !editing && <>
          <div className="provider-actions"><button disabled={busy} onClick={() => void update('validate')}>{busy ? 'Working…' : 'Validate connection'}</button><button disabled={busy} onClick={() => { setEditing(true); setDeleting(false); setMessage(''); setError('') }}>Replace key</button><button className="provider-delete" disabled={busy} onClick={() => setDeleting(true)}>Delete connection</button></div>
          {deleting && <div className="provider-delete-confirm"><p>Delete this saved key and stop your active evaluations? This does not revoke the key at Merge Gateway or delete your results.</p><div className="provider-actions"><button disabled={busy} onClick={() => void update('delete')}>Delete and stop runs</button><button disabled={busy} onClick={() => setDeleting(false)}>Keep connection</button></div></div>}
          <details className="provider-models"><summary>{connection.models.length} available models with tool calling</summary><ul>{connection.models.map(model => <li key={model}>{model}</li>)}</ul><p>Your evaluation picker shows the models approved for this Heval instance.</p></details>
        </>}
      </>}
      {error && <p role="alert">{error}</p>}{message && <p className="provider-success" role="status">{message}</p>}
    </div>
  </section>
}
