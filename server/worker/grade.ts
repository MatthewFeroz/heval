import { cp, mkdir, readFile, realpath, writeFile } from 'node:fs/promises'

// Execute the pinned tests in a fresh, networkless container, never tests or
// package scripts the agent could have replaced. Only the task solution crosses.
const candidate = await realpath('/candidate/src/cache.ts')
if (!candidate.startsWith('/candidate/')) throw new Error('Solution escapes candidate workspace')
const source = await readFile(candidate)
if (source.length > 1024 * 1024) throw new Error('Solution exceeds 1 MiB')
await cp('/opt/heval/fixture', '/tmp/grade', { recursive: true })
await mkdir('/tmp/grade/src', { recursive: true })
await writeFile('/tmp/grade/src/cache.ts', source)
const proc = Bun.spawn(['bun', 'test', '/tmp/grade/cache.test.ts'], {
  cwd: '/tmp/grade', env: { PATH: process.env.PATH, HOME: '/tmp' }, stdout: 'inherit', stderr: 'inherit',
})
process.exit(await proc.exited)
