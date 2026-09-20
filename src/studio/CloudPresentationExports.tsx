import { useState } from 'react'
import { useConvexAuth, useMutation, useQuery } from 'convex/react'
import { api } from '../../convex/_generated/api'
import type { Id } from '../../convex/_generated/dataModel'
import { authorizedFetch, useAppAuth } from '../auth'
import type { ReportProject } from '../reports/project'
import type { JobExport } from '../charts/trial'

export function SavePresentationOnline({ document, data }: { document: ReportProject; data: JobExport }) {
  const save = useMutation(api.reports.saveProject)
  const { isAuthenticated } = useConvexAuth()
  const [busy, setBusy] = useState(false), [error, setError] = useState('')
  async function persist() {
    setBusy(true); setError('')
    try {
      const id = await save({ json: JSON.stringify(data), document: JSON.stringify(document) })
      location.assign(`/studio?report=${id}`)
    } catch (e) { setError(e instanceof Error ? e.message : 'Could not save presentation.'); setBusy(false) }
  }
  return <div className="hosted-exports"><p>Save this presentation to your workspace to reopen it later and export PNGs or thread ZIPs online.</p>
    <button className="btn primary" disabled={busy || !isAuthenticated || document.project.sources.length !== 1} onClick={() => void persist()}>{busy ? 'Saving…' : 'Save presentation online'}</button>
    {document.project.sources.length !== 1 && <p>Select one evaluation source to save online.</p>}
    {error && <p role="alert">{error}</p>}
  </div>
}

export function CloudPresentationExports({ report, enqueue, disabled, collectionDisabled }: {
  report: string; enqueue: (collection: boolean, requestId: string) => Promise<void>; disabled: boolean; collectionDisabled: boolean
}) {
  const auth = useAppAuth(), { isAuthenticated } = useConvexAuth()
  const jobs = useQuery(api.presentationExports.list, isAuthenticated ? { report: report as Id<'reports'> } : 'skip')
  const available = useQuery(api.presentationExports.available, isAuthenticated ? {} : 'skip')
  const [busy, setBusy] = useState(false), [error, setError] = useState(''), [notice, setNotice] = useState('')
  async function request(collection: boolean) {
    setBusy(true); setError(''); setNotice('')
    try { await enqueue(collection, crypto.randomUUID()); setNotice('Export queued and presentation saved. You can close this page and return later.') }
    catch (e) { setError(e instanceof Error ? e.message : 'Could not queue export.') }
    finally { setBusy(false) }
  }
  async function download(job: string, filename: string) {
    setError('')
    try {
      const response = await authorizedFetch(auth, `/api/presentation-export?job=${encodeURIComponent(job)}`)
      if (!response.ok) throw new Error(await response.text())
      const url = URL.createObjectURL(await response.blob()), a = document.createElement('a')
      a.href = url; a.download = filename; a.click()
      setTimeout(() => URL.revokeObjectURL(url), 1000)
    } catch (e) { setError(e instanceof Error ? e.message : 'Download failed.') }
  }
  return <section className="hosted-exports" aria-label="Hosted exports">
    <div className="row">
      <button className="btn primary" disabled={busy || disabled || !available} onClick={() => void request(false)}>{busy ? 'Saving export…' : 'Export PNG online'}</button>
      <button className="btn" disabled={busy || disabled || collectionDisabled || !available} onClick={() => void request(true)}>Export thread ZIP online</button>
    </div>
    {available === false && <p>Hosted rendering is awaiting deployment configuration. Your presentation can still be saved and edited online.</p>}
    {notice && <p role="status">{notice}</p>}
    {error && <p role="alert">{error}</p>}
    <h3>Export history</h3>
    {jobs === undefined ? <p>Loading exports…</p> : !jobs.length ? <p>Your completed exports will appear here.</p> : <ul>{jobs.map(job => <li key={job._id}>
      <span>{job.collection ? 'Thread ZIP' : job.preset} · {job.theme} · draft {job.version} · {new Date(job._creationTime).toLocaleString()} · {job.status}</span>{' '}
      {job.status === 'complete' && <button className="btn sm" onClick={() => void download(job._id, job.filename!)}>Download {job.filename}</button>}
      {job.error && <p>{job.error}</p>}
    </li>)}</ul>}
  </section>
}
