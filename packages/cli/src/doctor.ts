import { execFile } from 'node:child_process'

export type Check = { name: string; ok: boolean; required: boolean; detail: string; fix?: string }
export type Probe = (command: string, args: string[]) => Promise<string | null>

export const probe: Probe = (command, args) => new Promise((done) => {
  execFile(command, args, { timeout: 8000, maxBuffer: 8192, windowsHide: true }, (error, stdout) => {
    done(error ? null : stdout.trim())
  })
})

export async function doctor(run: Probe = probe, env = process.env): Promise<Check[]> {
  const [harbor, docker, bun] = await Promise.all([
    run('harbor', ['--version']),
    run('docker', ['info', '--format', '{{.ServerVersion}}']),
    run('bun', ['--version']),
  ])
  const supportedHarbor = harbor !== null && /\b0\.22\.0\b/.test(harbor)
  const credentials = ['HEVAL_GATEWAY_API_KEY', 'OPENAI_API_KEY', 'ANTHROPIC_API_KEY', 'ANTHROPIC_AUTH_TOKEN'].filter(key => Boolean(env[key]))
  return [
    { name: 'Node.js', ok: Number(process.versions.node.split('.')[0]) >= 22, required: true, detail: process.version, fix: 'Install Node.js 22 or newer.' },
    { name: 'Harbor', ok: supportedHarbor, required: true, detail: harbor ?? 'Not found', fix: 'Install the supported version: uv tool install harbor==0.22.0' },
    { name: 'Docker engine', ok: docker !== null, required: true, detail: docker ?? 'Not reachable', fix: 'Install and start Docker Desktop (Linux containers) or Docker Engine.' },
    { name: 'Provider credentials', ok: credentials.length > 0, required: false, detail: credentials.length ? `Present in this shell: ${credentials.join(', ')} (values hidden; not validated)` : 'No known provider credentials in this shell', fix: 'Set credentials for the Harbor agent/provider you choose, or use its env file. Heval does not make a model call to check them.' },
    { name: 'Bun', ok: bun !== null, required: false, detail: bun ?? 'Not installed; only needed for repository development scripts' },
  ]
}
