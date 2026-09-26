import { afterEach, expect, test } from 'bun:test'
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync, symlinkSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { buildContext, displayCommand, execute, workerName } from './setup'

const directories: string[] = []
afterEach(() => { for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true }) })

test('Docker context contains only installed artifacts, round-trips long paths and is deterministic', async () => {
  const root = mkdtempSync(join(tmpdir(), 'heval-context-')); directories.push(root)
  mkdirSync(join(root, 'dist/worker'), { recursive: true })
  writeFileSync(join(root, 'dist/worker/Dockerfile'), 'FROM scratch\n')
  writeFileSync(join(root, 'package.json'), '{"name":"test"}')
  writeFileSync(join(root, '.env'), 'SECRET-NOT-IN-ARCHIVE')
  const path = 'dist/' + 'a'.repeat(70) + '/' + 'b'.repeat(70)
  mkdirSync(join(root, 'dist', 'a'.repeat(70)))
  writeFileSync(join(root, path), 'test bytes\n')
  const archive = buildContext(root)
  expect(archive.equals(buildContext(root))).toBe(true)
  expect(archive.includes(Buffer.from('SECRET-NOT-IN-ARCHIVE'))).toBe(false)
  const destination = join(root, 'extracted'); mkdirSync(destination)
  await execute('tar', ['-xf', '-', '-C', destination], archive)
  expect(readFileSync(join(destination, path), 'utf8')).toBe('test bytes\n')
  expect(readFileSync(join(destination, 'Dockerfile'), 'utf8')).toBe('FROM scratch\n')
})

test('setup rejects unsafe names and package symlinks', () => {
  for (const name of ['worker', 'heval-../escape', 'heval-$(id)', 'heval-UPPER', 'heval-' + 'a'.repeat(42)]) expect(() => workerName(name)).toThrow()
  expect(workerName()).toBe('heval-worker')
  const root = mkdtempSync(join(tmpdir(), 'heval-link-')); directories.push(root)
  mkdirSync(join(root, 'dist/worker'), { recursive: true })
  writeFileSync(join(root, 'dist/worker/Dockerfile'), 'FROM scratch\n')
  writeFileSync(join(root, 'package.json'), '{}')
  symlinkSync(join(root, 'package.json'), join(root, 'dist/leak'))
  expect(() => buildContext(root)).toThrow('non-regular')
})

test('subprocess failures do not echo stdin secrets and time out', async () => {
  await expect(execute(process.execPath, ['-e', 'process.stdin.on("data", b => { console.error(String(b)); process.exit(1) })'], 'secret-never-log')).rejects.toThrow('status 1')
  await expect(execute(process.execPath, ['-e', 'setInterval(()=>{},1000)'], undefined, false, 100)).rejects.toThrow('timed out')
})

test('recovery commands can be pasted into PowerShell or sh without interpreting arguments', async () => {
  expect(displayCommand(['wsl.exe', '--distribution', "my 'distro' $name"], true)).toBe("& 'wsl.exe' '--distribution' 'my ''distro'' $name'")
  const value = "spaces ' and $(false)"
  expect(await execute('sh', ['-c', displayCommand(['printf', '%s', value], false)])).toBe(value)
})
