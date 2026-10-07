import { afterEach, expect, spyOn, test } from 'bun:test'
import * as fs from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fingerprintDirectory, hashDirectory } from './files'

const temporary: string[] = []
function state() { const dir = fs.mkdtempSync(join(tmpdir(), 'heval-task-fingerprint-')); temporary.push(dir); return dir }
afterEach(() => { for (const dir of temporary.splice(0)) fs.rmSync(dir, { recursive: true, force: true }) })

test('content and execution fingerprints share one file read and exclude local root paths', () => {
  const a = state(), b = state()
  for (const dir of [a, b]) {
    fs.writeFileSync(join(dir, 'tool'), '#!/bin/sh\nexit 0\n', { mode: 0o755 })
    fs.mkdirSync(join(dir, 'empty'), { mode: 0o755 })
  }
  const expectedContent = hashDirectory(a)
  const reads = spyOn(fs, 'readFileSync')
  try {
    const fingerprint = fingerprintDirectory(a)
    expect(reads).toHaveBeenCalledTimes(1)
    expect(fingerprint.contentHash).toBe(expectedContent)
    expect(fingerprint.executionMetadata).toMatchObject({ version: 1, digest: expect.stringMatching(/^[a-f0-9]{64}$/) })
    expect(fingerprintDirectory(b)).toEqual(fingerprint)
  } finally { reads.mockRestore() }
})

test('root directory execution bits affect metadata while content pins and path independence stay intact', () => {
  const a = state(), b = state()
  for (const dir of [a, b]) {
    fs.chmodSync(dir, 0o700)
    fs.writeFileSync(join(dir, 'tool'), 'script')
  }
  const before = fingerprintDirectory(a)
  expect(fingerprintDirectory(b)).toEqual(before)
  fs.chmodSync(a, 0o755)
  const changed = fingerprintDirectory(a)
  expect(changed.contentHash).toBe(before.contentHash)
  expect(hashDirectory(a)).toBe(before.contentHash)
  expect(changed.executionMetadata.digest).not.toBe(before.executionMetadata.digest)
  fs.chmodSync(b, 0o755)
  expect(fingerprintDirectory(b)).toEqual(changed)
})

test('ignored task directories affect neither fingerprint while other symlinks remain refused', () => {
  const dir = state()
  fs.writeFileSync(join(dir, 'tool'), 'script')
  const before = fingerprintDirectory(dir)
  for (const name of ['.git', '__pycache__']) {
    fs.mkdirSync(join(dir, name))
    fs.symlinkSync(join(dir, 'tool'), join(dir, name, 'ignored-link'))
  }
  expect(fingerprintDirectory(dir)).toEqual(before)
  fs.symlinkSync(join(dir, 'tool'), join(dir, 'link'))
  expect(() => fingerprintDirectory(dir)).toThrow('symlinks')
})

test('task fingerprinting keeps the existing byte and file limits', () => {
  const oversized = state(), many = state()
  fs.writeFileSync(join(oversized, 'large'), Buffer.alloc(20_000_001))
  expect(() => fingerprintDirectory(oversized)).toThrow('20 MB and 2000 files')
  for (let i = 0; i < 2001; i++) fs.writeFileSync(join(many, String(i)), '')
  expect(() => fingerprintDirectory(many)).toThrow('20 MB and 2000 files')
})
