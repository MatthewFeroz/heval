import { useState } from 'react'
import { useMutation } from 'convex/react'
import type { FunctionReturnType } from 'convex/server'
import { api } from '../../convex/_generated/api'
import type { Id } from '../../convex/_generated/dataModel'
import type { ReportData } from './format'
import { message } from './helpers'
import { RunArtifact } from './RunArtifact'
import { evidenceLimit, validateEvidence, type EvidenceKind } from './runArtifacts'

type Evidence = NonNullable<FunctionReturnType<typeof api.reports.get>>['evidence'][number]
export function TrialEvidence({ evidence = [], report, data, owner = false }: { evidence?: Evidence[]; report?: Id<'reports'>; data?: string; owner?: boolean }) {
  return <section className="report-card"><h2>Manage trial evidence</h2><p>Attach and review evidence for the task comparison above. Evidence is published separately from chart drafts. Only evidence explicitly reviewed and published by the owner appears on shared links.</p>
    {!evidence.length && <p>No output evidence has been attached.</p>}
    {evidence.map(item => <EvidenceItem key={item.id} item={item} owner={owner} />)}
    {owner && report && data && <AddEvidence report={report} rows={(JSON.parse(data) as ReportData).rows} />}
  </section>
}
function EvidenceItem({ item, owner }: { item: Evidence; owner: boolean }) {
  const publish = useMutation(api.reportEvidence.setPublished)
  const [reviewed, setReviewed] = useState(false), [busy, setBusy] = useState(false), [error, setError] = useState('')
  return <details className="trial-evidence"><summary>{item.title} · {item.trial} · {item.published ? 'Published with report link' : 'Private evidence'}</summary>
    <p>{item.kind} · SHA-256 {item.hash}</p><RunArtifact artifact={item} />
    {(item.kind === 'html' || item.kind === 'timeline') && <details><summary>Inspect evidence source</summary><pre>{item.text}</pre></details>}
    {owner && <><label className="comparison-consent"><input type="checkbox" checked={reviewed} onChange={e => setReviewed(e.target.checked)} />I reviewed this evidence for credentials, private code and personal information.</label><button disabled={busy || !item.published && !reviewed} onClick={async () => { setBusy(true); try { await publish({ id: item.id, published: !item.published, reviewed }); setReviewed(false) } catch (e) { setError(message(e)) } finally { setBusy(false) } }}>{item.published ? 'Make evidence private' : 'Publish evidence with report link'}</button></>}
    {error && <p role="alert">{error}</p>}
  </details>
}
function AddEvidence({ report, rows }: { report: Id<'reports'>; rows: ReportData['rows'] }) {
  const add = useMutation(api.reportEvidence.add)
  const [trial, setTrial] = useState(rows[0]?.trial ?? ''), [title, setTitle] = useState(''), [kind, setKind] = useState<EvidenceKind>('patch'), [text, setText] = useState('')
  const [busy, setBusy] = useState(false), [error, setError] = useState(''), [status, setStatus] = useState('')
  async function loadFile(file: File) {
    setError(''); setStatus('')
    try {
      if (file.size > 100_000) throw Error('Choose an evidence file up to 100 KB. PNG screenshots must fit within 100 KB after encoding.')
      const nextKind: EvidenceKind = file.name.toLowerCase().endsWith('.png') ? 'image' : /\.html?$/i.test(file.name) ? 'html' : file.name.toLowerCase().endsWith('.json') ? 'timeline' : /\.(patch|diff)$/i.test(file.name) ? 'patch' : /\.log$/i.test(file.name) ? 'verifier' : kind
      let value: string
      if (nextKind === 'image') {
        const bytes = new Uint8Array(await file.arrayBuffer())
        value = 'data:image/png;base64,' + btoa(Array.from(bytes, byte => String.fromCharCode(byte)).join(''))
      } else value = await file.text()
      validateEvidence(nextKind, value)
      setKind(nextKind); setText(value); setTitle(file.name.slice(0, 120))
    } catch (e) { setError(message(e)) }
  }
  return <details><summary>Attach private trial evidence</summary><p>Attach a patch, verifier output, recorded timeline, HTML output or PNG screenshot. Saving never publishes it. Text and timelines allow 16 KB; HTML and encoded screenshots allow 100 KB.</p>
    <label>Trial<select value={trial} onChange={e => setTrial(e.target.value)}>{rows.map(row => <option key={row.trial} value={row.trial}>{row.agent} · {row.model} · {row.task} · {row.trial}</option>)}</select></label>
    <label>Evidence title<input maxLength={120} value={title} onChange={e => setTitle(e.target.value)} /></label><label>Evidence type<select value={kind} onChange={e => { setKind(e.target.value as EvidenceKind); setText('') }}><option value="patch">Code patch</option><option value="verifier">Verifier output</option><option value="timeline">Recorded timeline</option><option value="html">Static HTML output</option><option value="image">PNG screenshot</option></select></label>
    <label>Evidence file<input type="file" accept=".patch,.diff,.txt,.log,.json,.html,.htm,.png" onChange={event => { const file = event.target.files?.[0]; if (file) void loadFile(file); event.target.value = '' }} /></label>
    {kind === 'timeline' && <p>Timeline JSON uses schemaVersion 1 and an events array. Each event needs at, kind and title, with optional text. Supported kinds: started, passed, failed, error, command, edit, test and message.</p>}
    <label>Evidence text<textarea rows={10} value={text} onChange={e => setText(e.target.value)} /></label>
    <button disabled={busy || !trial || !title.trim() || !text || new TextEncoder().encode(text).length > evidenceLimit(kind)} onClick={async () => { setBusy(true); setError(''); setStatus(''); try { validateEvidence(kind, text); await add({ report, trial, title, kind, text }); setText(''); setTitle(''); setStatus('Evidence saved privately.') } catch (e) { setError(message(e)) } finally { setBusy(false) } }}>Save private evidence</button>
    {status && <p role="status">{status}</p>}{error && <p role="alert">{error}</p>}
  </details>
}
