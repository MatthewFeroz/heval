import { useEffect, useState } from 'react'
import { useConvexAuth, useMutation, useQuery } from 'convex/react'
import { api } from '../../convex/_generated/api'
import type { Id } from '../../convex/_generated/dataModel'
import { useAppAuth } from '../auth'
import { Studio, type HostedStudioSession } from '../studio/Studio'
import { reportArtifact, type ReportProject } from './project'

export function HostedStudio() {
  const auth = useAppAuth(), { isLoading, isAuthenticated } = useConvexAuth()
  const id = new URLSearchParams(location.search).get('report') as Id<'reports'>
  const report = useQuery(api.reports.get, isAuthenticated ? { id } : 'skip')
  const save = useMutation(api.reportProjects.saveDraft)
  const requestExport = useMutation(api.presentationExports.request)
  const [loaded, setLoaded] = useState<HostedStudioSession | null>(null)
  const [version, setVersion] = useState<number | null>(null)
  const [error, setError] = useState('')
  useEffect(() => {
    if (!report || loaded) return
    let live = true
    const data = JSON.parse(report.data)
    void reportArtifact(data, id).then(artifact => {
      if (live) { setLoaded({ id, initial: JSON.parse(report.project), artifact, data, version: report.version, save: async () => {}, enqueue: async () => {} }); setVersion(report.version) }
    }).catch(e => { if (live) setError(e.message) })
    return () => { live = false }
  }, [report, loaded, id])
  if (isLoading) return <main className="hosted-gate">Connecting your workspace…</main>
  if (!isAuthenticated) return <main className="hosted-gate"><h1>Sign in to edit this report</h1><button onClick={auth.signIn}>Sign in</button><a href="/reports">Your reports</a></main>
  if (report === null) return <main className="hosted-gate"><h1>Report unavailable</h1><p>Your access may have been removed.</p><a href="/reports">Your reports</a></main>
  if (report?.role === 'viewer') return <main className="hosted-gate"><h1>You have view access</h1><p>Ask the owner for editor access to change this chart.</p><a href={`/reports?id=${id}`}>View report</a></main>
  if (error) return <main className="hosted-gate" role="alert">{error}</main>
  if (!loaded || !report || version === null) return <main className="hosted-gate">Loading saved project…</main>
  const persist = async (document: ReportProject) => {
    const result = await save({ id, expectedVersion: version, document: JSON.stringify(document) })
    setVersion(result.version)
  }
  return <Studio hosted={{ ...loaded, version, newerVersion: report.version > version, save: persist, enqueue: async (document, collection, requestId) => {
    const result = await requestExport({ report: id, document: JSON.stringify(document), expectedVersion: version, collection, requestId })
    setVersion(result.version)
  } }} />
}
