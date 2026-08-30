import { expect, test } from 'bun:test'
import { AsyncCache } from './src/cache'

test('coalesces concurrent cache misses', async () => {
  const cache = new AsyncCache<number>()
  let calls = 0
  const load = async () => { calls++; await Bun.sleep(5); return 42 }
  expect(await Promise.all([cache.get('x', load), cache.get('x', load)])).toEqual([42, 42])
  expect(calls).toBe(1)
})
