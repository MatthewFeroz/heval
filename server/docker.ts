import type { HarnessId, RunConfig } from './types'

export type RunAccess = { apiKey: string; baseUrl: string; release: () => void }
export type WorkerProcess = { exited: Promise<number>; stop: () => Promise<void> }
export interface WorkerBackend {
  start(id: string, harness: HarnessId, output: (data: string) => void, config?: RunConfig, access?: RunAccess): WorkerProcess
  grade(id: string, output: (data: string) => void): WorkerProcess
  cleanup(id: string): Promise<void>
}

export function containerArgs(id: string, image: string, grading: boolean): string[] {
  return ['run', '--pull=never', '--name', `heval-${id}${grading ? '-grade' : ''}`,
    '--label', 'heval.worker=true', '--init', '--user', '1000:1000', '--read-only',
    '--cap-drop=ALL', '--security-opt=no-new-privileges', '--pids-limit=128',
    '--cpus=2', '--memory=2g', '--memory-swap=2g',
    '--tmpfs', '/tmp:rw,nosuid,nodev,size=536870912,mode=1777',
    '--mount', `type=volume,source=heval-${id},target=${grading ? '/candidate,readonly' : '/workspace'}`,
    '--entrypoint=timeout',
    ...(grading ? ['--network=none'] : ['--env', 'HEVAL_GATEWAY_API_KEY', '--env', 'HEVAL_GATEWAY_MODEL', '--env', 'HEVAL_PROVIDER', '--env', 'HEVAL_VENDOR_PINS_JSON', '--env', 'HEVAL_INFERENCE_BASE_URL']),
    // Container-side ceiling also bounds execution if the control plane crashes.
    image, '--signal=KILL', grading ? '310s' : '3610s', 'bun',
    grading ? '/opt/heval/worker/grade.ts' : '/opt/heval/worker/main.ts']
}

async function control(args: string[], allowMissing = false) {
  const proc = Bun.spawn(['docker', ...args], { stdout: 'pipe', stderr: 'pipe' })
  const timeout = setTimeout(() => proc.kill(), 15_000)
  try {
    const [code, out, err] = await Promise.all([proc.exited, new Response(proc.stdout).text(), new Response(proc.stderr).text()])
    if (code !== 0 && !(allowMissing && /No such (container|volume)/i.test(err))) throw new Error(`Docker ${args[0]} failed: ${(err || out).slice(0, 300)}`)
  } finally { clearTimeout(timeout) }
}

export function dockerBackend(image: string): WorkerBackend {
  function launch(id: string, grading: boolean, output: (data: string) => void, harness?: HarnessId, config?: RunConfig, access?: RunAccess): WorkerProcess {
    const args = containerArgs(id, image, grading)
    if (harness) args.push(harness)
    const proc = Bun.spawn(['docker', ...args], { stdout: 'pipe', stderr: 'pipe', env: { ...process.env, HEVAL_GATEWAY_API_KEY: process.env.HEVAL_PROVIDER === 'nvidia' ? process.env.HEVAL_NVIDIA_API_KEY : process.env.HEVAL_GATEWAY_API_KEY, ...(config ? { HEVAL_GATEWAY_MODEL: config.model } : {}), HEVAL_INFERENCE_BASE_URL: access?.baseUrl, ...(access ? { HEVAL_GATEWAY_API_KEY: access.apiKey, HEVAL_PROVIDER: 'merge-gateway', HEVAL_VENDOR_PINS_JSON: '{}' } : {}) } })
    async function drain(stream: ReadableStream<Uint8Array>) {
      const decoder = new TextDecoder()
      const reader = stream.getReader()
      try {
        while (true) {
          const { value, done } = await reader.read()
          if (done) break
          output(decoder.decode(value, { stream: true }))
        }
        const tail = decoder.decode()
        if (tail) output(tail)
      } finally { reader.releaseLock() }
    }
    const name = `heval-${id}${grading ? '-grade' : ''}`
    return {
      exited: Promise.all([proc.exited, drain(proc.stdout), drain(proc.stderr)]).then(([code]) => code),
      // Stop the container, not just its attached Docker client. Retry after
      // the client exits in cleanup to cover cancellation during creation.
      stop: async () => { try { await control(['rm', '-f', name]) } finally { proc.kill() } },
    }
  }
  return {
    start: (id, harness, output, config, access) => launch(id, false, output, harness, config, access),
    grade: (id, output) => launch(id, true, output),
    async cleanup(id) {
      await control(['rm', '-f', `heval-${id}`], true)
      await control(['rm', '-f', `heval-${id}-grade`], true)
      await control(['volume', 'rm', '-f', `heval-${id}`], true)
    },
  }
}
