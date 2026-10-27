import { expect, test } from 'bun:test'
import { managedGateway } from './gateway'
test('temporary model keys have explicit model, project, expiration and spending limits', async () => {
  const requests: { url: string; body: Record<string, unknown> }[] = []
  const upstream = (async (url: string, options: RequestInit) => { const body = JSON.parse(options.body as string); requests.push({ url, body }); return Response.json({ ...body, key: 'mg_fixture', hash: 'a'.repeat(64) }) }) as typeof fetch
  const gateway = managedGateway('mgmt_fixture', '11111111-1111-1111-1111-111111111111', upstream)
  const expiry = Date.now() + 60_000
  await gateway.create('fixture-job', ['test/model'], 2, expiry)
  expect(requests[0].url).toBe('https://api-gateway.merge.dev/v1/keys')
  expect(requests[0].body).toMatchObject({ allowed_models: ['test/model'], limit: 2, limit_reset: 'monthly', expires_at: new Date(expiry).toISOString() })
  await expect(gateway.create('fixture', ['test/*'], 2, expiry)).rejects.toThrow('bounds')
})
test('cleanup finds every job key before deleting, and never deletes another job key', async () => {
  const deleted: string[] = [], offsets: number[] = []
  const upstream = (async (raw: string, options: RequestInit) => {
    const url = new URL(raw)
    if (options.method === 'DELETE') { deleted.push(url.pathname); return new Response(null, { status: 204 }) }
    const offset = Number(url.searchParams.get('offset')); offsets.push(offset)
    return Response.json({ data: [{ name: offset ? 'fixture' : 'other', hash: 'a'.repeat(64) }, { name: 'fixture', hash: (offset ? 'b' : 'c').repeat(64) }], has_more: !offset })
  }) as typeof fetch
  await managedGateway('mgmt_fixture', '11111111-1111-1111-1111-111111111111', upstream).removeNamed('fixture')
  expect(offsets).toEqual([0, 100]); expect(deleted).toEqual(['c', 'a', 'b'].map(c => `/v1/keys/${c.repeat(64)}`))
})
test('provider bodies and management credentials never appear in errors', async () => {
  const gateway = managedGateway('mgmt_private-fixture', '11111111-1111-1111-1111-111111111111', async () => new Response('secret provider body', { status: 500 }))
  await expect(gateway.removeNamed('fixture')).rejects.toThrow('Gateway management request failed.')
  const rejected = managedGateway('mgmt_private-fixture', '11111111-1111-1111-1111-111111111111', async () => { throw new Error('mgmt_private-fixture in a transport error') })
  await expect(rejected.removeNamed('fixture')).rejects.toThrow(/^Gateway management request failed\.$/)
})
