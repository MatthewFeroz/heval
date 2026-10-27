/** Management credentials never enter an evaluation VM or the browser. */
export function managedGateway(managementKey: string, project: string, upstream: (input: string, init?: RequestInit) => Promise<Response> = fetch) {
  if (!managementKey.startsWith('mgmt_') || !/^[a-f0-9-]{36}$/.test(project)) throw new Error('Configure a dedicated Gateway project and management credential.')
  async function request(path: string, init?: RequestInit) {
    try {
      const response = await upstream(`https://api-gateway.merge.dev/v1/keys${path}`, { ...init, headers: { Authorization: `Bearer ${managementKey}`, 'Content-Type': 'application/json' }, redirect: 'error', signal: AbortSignal.timeout(20_000) })
      if (response.status === 404 && init?.method === 'DELETE') return null
      if (!response.ok) { await response.body?.cancel(); throw new Error('Gateway management request failed.') }
      return response.status === 204 ? null : await response.json()
    } catch { throw new Error('Gateway management request failed.') }
  }
  return {
    async create(name: string, models: string[], budgetUsd: number, expires: number) {
      // Never let the monthly allowance reset during the job's lifetime.
      const now = new Date(), reset = Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1)
      if (expires >= reset || expires <= Date.now() || budgetUsd <= 0 || !Number.isFinite(budgetUsd) || !models.length || models.some(m => m.includes('*'))) throw new Error('Invalid temporary model key bounds. Retry after the monthly reset if necessary.')
      const result = await request('', { method: 'POST', body: JSON.stringify({ name, project_id: project, allowed_models: models, limit: budgetUsd, limit_reset: 'monthly', expires_at: new Date(expires).toISOString() }) })
      if (!result || typeof result.key !== 'string' || !result.key.startsWith('mg_') || !/^[a-f0-9]{64}$/.test(result.hash) || result.limit !== budgetUsd || result.limit_reset !== 'monthly' || result.project_id !== project || Date.parse(result.expires_at) !== expires || !Array.isArray(result.allowed_models) || JSON.stringify([...result.allowed_models].sort()) !== JSON.stringify([...models].sort())) throw new Error('Gateway returned an invalid temporary model key.')
      return { key: result.key as string, hash: result.hash as string }
    },
    async removeNamed(name: string) {
      // Gather all matches before deleting so pagination offsets cannot skip keys.
      const matches: string[] = []
      for (let offset = 0; ; offset += 100) {
        const page = await request(`?project_id=${encodeURIComponent(project)}&offset=${offset}&limit=100`)
        if (!page || !Array.isArray(page.data)) throw new Error('Gateway key inventory unavailable.')
        for (const key of page.data) if (key.name === name) {
          if (!/^[a-f0-9]{64}$/.test(key.hash)) throw new Error('Gateway key inventory invalid.')
          matches.push(key.hash)
        }
        if (!page.has_more) break
        if (offset >= 10_000) throw new Error('Gateway key inventory exceeds the managed beta limit.')
      }
      for (const hash of matches) await request(`/${hash}`, { method: 'DELETE' })
    },
  }
}
