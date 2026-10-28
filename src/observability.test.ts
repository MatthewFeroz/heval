import { expect, test } from 'bun:test'
import { publicPage, sanitizeError } from './observability'
test('analytics excludes private routes, query strings and share capabilities', () => {
  const origin = 'https://openeval.howaiworks.io'
  for (const path of ['/library', '/reports?id=private', '/share#secret', '/login?token=secret', '/explore?left=private']) expect(publicPage(origin + path)).toBeNull()
  expect(publicPage(origin + '/')).toBe(origin + '/')
  expect(publicPage(origin + '/explore')).toBe(origin + '/explore')
})

test('error events retain code locations without report content or share capabilities', () => {
  const origin = 'https://openeval.howaiworks.io'
  const event = sanitizeError({ type: undefined, message: 'private report title', user: { email: 'private@example.invalid' }, request: { url: origin + '/share#secret' }, extra: { evidence: 'private patch' }, exception: { values: [{ type: 'private name', value: 'private message', stacktrace: { frames: [{ filename: origin + '/assets/app.js?token=secret', function: 'privateFunction', lineno: 12 }, { filename: 'https://third-party.invalid/secret' }] } }] } }, origin)
  const encoded = JSON.stringify(event)
  expect(encoded).not.toMatch(/private|secret|share|third-party/)
  expect(event.exception!.values![0].stacktrace!.frames).toEqual([{ filename: origin + '/assets/app.js', lineno: 12, colno: undefined }])
})
