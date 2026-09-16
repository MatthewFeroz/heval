import { useState } from 'react'
import { useMutation, useQuery } from 'convex/react'
import { api } from '../../convex/_generated/api'
import type { Id } from '../../convex/_generated/dataModel'
import { message, token } from './helpers'

export function TeamAccess({ id }: { id: Id<'reports'> }) {
  const team = useQuery(api.reportProjects.team, { id })
  const invite = useMutation(api.reportProjects.invite)
  const remove = useMutation(api.reportProjects.removeMember)
  const revoke = useMutation(api.reportProjects.revokeInvite)
  const [role, setRole] = useState<'viewer' | 'editor'>('editor')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [status, setStatus] = useState('')
  async function act(run: () => Promise<unknown>, success: string) {
    setBusy(true); setError(''); setStatus('')
    try { await run(); setStatus(success) } catch (error) { setError(message(error)) } finally { setBusy(false) }
  }
  return <section className="report-card" aria-label="Team access"><h2>Edit with your team</h2>
    <p>Invite a teammate to this report. Editors can save chart drafts; viewers can inspect them. Only you can publish changes, share publicly, or manage access.</p>
    <label>Invitation access<select value={role} onChange={e => setRole(e.target.value as typeof role)}><option value="editor">Editor — can change the draft</option><option value="viewer">Viewer — can read the draft</option></select></label>
    <button disabled={busy} onClick={() => void act(() => invite({ id, role, token: token() }), 'Invitation created. Send the link to your teammate.')}>Create invitation</button>
    <p className="report-muted">Each invitation works for one signed-in account and expires after 7 days. Anyone holding an unused invitation can accept it, so send it directly to your teammate.</p>
    {team === undefined ? <p>Loading team…</p> : <>
      {team.invites.map(i => <div className="report-invite" key={i.id}>
        <label>{i.role === 'editor' ? 'Editor' : 'Viewer'} invitation<input aria-label={`${i.role} invitation link`} readOnly value={`${location.origin}/reports#invite=${i.token}`} onFocus={e => e.target.select()} /></label>
        <div className="report-actions"><button className="secondary" disabled={busy} onClick={() => void act(() => navigator.clipboard.writeText(`${location.origin}/reports#invite=${i.token}`), 'Invitation copied.')}>Copy invitation</button><button className="secondary" disabled={busy} onClick={() => void act(() => revoke({ invite: i.id }), 'Invitation revoked.')}>Revoke invitation</button><span className="report-muted">Expires {new Date(i.expiresAt).toLocaleDateString()}</span></div>
      </div>)}
      <ul className="report-members">{team.members.map(m => <li key={m.id}><span>{m.label} · {m.role}</span><button className="secondary" disabled={busy} onClick={() => void act(() => remove({ member: m.id }), 'Team access removed.')}>Remove access</button></li>)}</ul>
      {!team.members.length && <p className="report-muted">No teammates have joined yet.</p>}
    </>}
    {status && <p role="status">{status}</p>}{error && <p role="alert">{error}</p>}
  </section>
}

export function AcceptInvitation({ token }: { token: string }) {
  const invitation = useQuery(api.reportProjects.invitation, { token })
  const accept = useMutation(api.reportProjects.accept)
  const [busy, setBusy] = useState(false), [error, setError] = useState('')
  async function join() {
    setBusy(true); setError('')
    try { const id = await accept({ token }); location.assign(`/reports?id=${id}`) }
    catch (e) { setError(message(e)); setBusy(false) }
  }
  if (invitation === undefined) return <p role="status">Checking invitation…</p>
  if (!invitation) return <section className="report-card"><h1>Invitation unavailable</h1><p>It may have expired, been revoked, or already been used. Ask the owner for a new invitation.</p><a href="/reports">Your reports</a></section>
  return <section className="report-card"><h1>Join {invitation.title}</h1><p>You’ve been invited as an <strong>{invitation.role}</strong>. {invitation.role === 'editor' ? 'You can edit and save chart drafts. The owner publishes changes to the shared report.' : 'You can view saved drafts. Ask the owner for editor access to make changes.'}</p><button disabled={busy} onClick={() => void join()}>{busy ? 'Joining…' : 'Accept invitation'}</button>{error && <p role="alert">{error}</p>}</section>
}
