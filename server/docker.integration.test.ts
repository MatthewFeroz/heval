import { expect, test } from 'bun:test'
import { containerArgs, dockerBackend } from './docker'

// Opt-in: builds/runs containers but never calls a model or consumes model credits.
test.skipIf(process.env.HEVAL_DOCKER_TEST !== '1')('real Docker isolates the workspace and grades only the pinned test', async () => {
  const id = crypto.randomUUID()
  const image = process.env.HEVAL_WORKER_IMAGE || 'heval-worker:local'
  const backend = dockerBackend(image)
  async function docker(args: string[]) {
    const proc = Bun.spawn(['docker', ...args], { stdout: 'pipe', stderr: 'pipe' })
    const timer = setTimeout(() => proc.kill(), 30_000)
    try {
      const [code, out, err] = await Promise.all([proc.exited, new Response(proc.stdout).text(), new Response(proc.stderr).text()])
      if (code !== 0) throw new Error(`Docker smoke failed: ${out}${err}`)
      return out
    } finally { clearTimeout(timer) }
  }
  try {
    const args = containerArgs(id, image, false)
    args.splice(args.indexOf(image) + 1)
    args[args.indexOf('--entrypoint=timeout')] = '--entrypoint=bun'
    // Deliberately fake the writable tests. The immutable grader must still fail
    // the original broken implementation, proving it ignores candidate tests.
    args.push('-e', `
      const fs = require('node:fs');
      if (process.getuid() === 0) throw Error('root');
      if (fs.existsSync('/var/run/docker.sock')) throw Error('socket exposed');
      let blocked = false;
      try { fs.writeFileSync('/opt/heval/escape', 'bad') } catch { blocked = true }
      if (!blocked) throw Error('root filesystem writable');
      fs.cpSync('/opt/heval/fixture', '/workspace', { recursive: true });
      fs.writeFileSync('/workspace/cache.test.ts', "import { test } from 'bun:test'; test('fake pass', () => {})");
      console.log('isolation verified');
    `)
    expect(await docker(args)).toContain('isolation verified')
    let output = ''
    const grader = backend.grade(id, (data) => { output += data })
    expect(await grader.exited).not.toBe(0)
    expect(output).toContain('coalesces concurrent cache misses')
  } finally { await backend.cleanup(id) }
}, 60_000)
