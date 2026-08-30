import { cpSync, existsSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

export type HarnessId = 'claude-code' | 'codex' | 'opencode' | 'pi-agent'
export type Chunk = { at: number; data: string }
export type Grade = { passed: boolean; exitCode: number; output: string }
export type Run = {
  id: string
  harness: HarnessId
  model: string
  gateway: 'merge-gateway'
  status: 'running' | 'complete' | 'failed' | 'cancelled'
  startedAt: string
  exitCode?: number
  chunks: Chunk[]
  grade?: Grade
  terminal?: Bun.Terminal
  cancel?: () => void
}

const prompt = 'Fix the race condition in the async cache and make the full test suite pass. Preserve the public API.'
const gatewayModel = process.env.HEVAL_GATEWAY_MODEL || 'anthropic/claude-sonnet-4-5-20250929'
const gatewayKeyEnv = 'HEVAL_GATEWAY_API_KEY'
const mergeOpenAIBaseUrl = 'https://api-gateway.merge.dev/v1/openai'
const mergeAnthropicBaseUrl = 'https://api-gateway.merge.dev/v1/anthropic'

type Launch = { command: string[]; env: Record<string, string | undefined> }

export function prepareLaunch(harness: HarnessId, workspace: string): Launch {
  if (!process.env[gatewayKeyEnv]) throw new Error(`${gatewayKeyEnv} is not configured`)
  const configRoot = join(workspace, '.heval')
  mkdirSync(configRoot, { recursive: true })
  const env: Record<string, string | undefined> = {
    ...process.env,
    TERM: 'xterm-256color',
    COLORTERM: 'truecolor',
    MERGE_GATEWAY_API_KEY: process.env[gatewayKeyEnv],
  }

  if (harness === 'codex') {
    const codexHome = join(configRoot, 'codex')
    mkdirSync(codexHome, { recursive: true })
    writeFileSync(join(codexHome, 'config.toml'), [
      `model = ${JSON.stringify(gatewayModel)}`,
      'model_provider = "merge-gateway"',
      '',
      '[model_providers.merge-gateway]',
      'name = "Merge Gateway"',
      `base_url = ${JSON.stringify(mergeOpenAIBaseUrl)}`,
      'env_key = "MERGE_GATEWAY_API_KEY"',
      'wire_api = "responses"',
      '',
    ].join('\n'))
    env.CODEX_HOME = codexHome
    return {
      command: [
        'codex',
        '--dangerously-bypass-approvals-and-sandbox',
        '--dangerously-bypass-hook-trust',
        '--model',
        gatewayModel,
        prompt,
      ],
      env,
    }
  }

  if (harness === 'claude-code') {
    env.ANTHROPIC_BASE_URL = mergeAnthropicBaseUrl
    env.ANTHROPIC_AUTH_TOKEN = process.env[gatewayKeyEnv]
    env.ANTHROPIC_API_KEY = ''
    env.ANTHROPIC_DEFAULT_OPUS_MODEL = gatewayModel
    env.ANTHROPIC_DEFAULT_SONNET_MODEL = gatewayModel
    env.ANTHROPIC_DEFAULT_HAIKU_MODEL = gatewayModel
    return { command: ['claude', '--dangerously-skip-permissions', '--model', gatewayModel, prompt], env }
  }

  if (harness === 'opencode') {
    const opencodeRoot = join(configRoot, 'opencode')
    mkdirSync(opencodeRoot, { recursive: true })
    env.XDG_CONFIG_HOME = join(opencodeRoot, 'config')
    env.XDG_DATA_HOME = join(opencodeRoot, 'data')
    env.XDG_CACHE_HOME = join(opencodeRoot, 'cache')
    env.OPENCODE_CONFIG_DIR = join(opencodeRoot, 'agent')
    env.OPENCODE_CONFIG_CONTENT = JSON.stringify({
      $schema: 'https://opencode.ai/config.json',
      provider: {
        'merge-gateway': {
          models: { [gatewayModel]: { name: gatewayModel } },
        },
      },
    })
    return { command: ['opencode', '--auto', '--model', `merge-gateway/${gatewayModel}`, '--prompt', prompt], env }
  }

  const piRoot = join(configRoot, 'pi')
  mkdirSync(piRoot, { recursive: true })
  writeFileSync(join(piRoot, 'models.json'), JSON.stringify({
    providers: {
      'merge-gateway': {
        name: 'Merge Gateway',
        baseUrl: mergeOpenAIBaseUrl,
        api: 'openai-completions',
        // Pi 0.73 resolves a bare value as an environment-variable name.
        apiKey: 'MERGE_GATEWAY_API_KEY',
        compat: { supportsReasoningEffort: false },
        models: [{
          id: gatewayModel,
          name: gatewayModel,
          reasoning: true,
          input: ['text', 'image'],
          contextWindow: 200000,
          maxTokens: 64000,
        }],
      },
    },
  }, null, 2))
  env.PI_CODING_AGENT_DIR = piRoot
  return {
    command: [join(process.cwd(), 'node_modules', '.bin', 'pi'), '--model', `merge-gateway/${gatewayModel}`, prompt],
    env,
  }
}

export const runs = new Map<string, Run>()
export const subscribers = new Map<string, Set<{ send(data: string): unknown }>>()
const runWorkspaces = new Map<string, string>()

function emit(run: Run, message: object) {
  const payload = JSON.stringify(message)
  subscribers.get(run.id)?.forEach((socket) => socket.send(payload))
}

export function startRun(harness: HarnessId) {
  const fixture = join(import.meta.dir, '..', 'fixtures', 'concurrent-cache')
  if (!existsSync(fixture)) throw new Error('Pinned fixture is missing')
  const workspace = mkdtempSync(join(tmpdir(), `heval-${harness}-`))
  cpSync(fixture, workspace, { recursive: true })
  const id = crypto.randomUUID()
  const started = performance.now()
  const launch = prepareLaunch(harness, workspace)
  const run: Run = { id, harness, model: gatewayModel, gateway: 'merge-gateway', status: 'running', startedAt: new Date().toISOString(), chunks: [] }
  runs.set(id, run)
  runWorkspaces.set(id, workspace)
  mkdirSync(join(import.meta.dir, '..', 'recordings'), { recursive: true })

  const proc = Bun.spawn(launch.command, {
    cwd: workspace,
    env: launch.env,
    terminal: {
      cols: 96,
      rows: 24,
      data(_terminal, bytes) {
        const chunk = { at: Math.round(performance.now() - started), data: new TextDecoder().decode(bytes) }
        run.chunks.push(chunk)
        writeFileSync(join(import.meta.dir, '..', 'recordings', `${id}.json`), JSON.stringify({ ...run, terminal: undefined, cancel: undefined }))
        emit(run, { type: 'data', ...chunk })
      },
    },
  })
  run.terminal = proc.terminal
  run.cancel = () => proc.kill()
  void proc.exited.then((exitCode) => {
    run.exitCode = exitCode
    if (run.status === 'running') run.status = exitCode === 0 ? 'complete' : 'failed'
    run.terminal?.close()
    run.terminal = undefined
    run.cancel = undefined
    void Bun.write(join(import.meta.dir, '..', 'recordings', `${id}.json`), JSON.stringify(run))
    emit(run, { type: 'exit', exitCode, status: run.status })
  })
  return run
}

export function cancelRun(run: Run) {
  if (run.status !== 'running') return false
  run.status = 'cancelled'
  run.cancel?.()
  return true
}

export async function gradeRun(run: Run) {
  if (run.grade) return run.grade
  const workspace = runWorkspaces.get(run.id)
  if (!workspace) throw new Error('Run workspace is unavailable')
  const proc = Bun.spawn(['bun', 'test'], { cwd: workspace, stdout: 'pipe', stderr: 'pipe' })
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ])
  const grade = { passed: exitCode === 0, exitCode, output: `${stdout}${stderr}`.slice(-16_000) }
  run.grade = grade
  run.status = grade.passed ? 'complete' : 'failed'
  run.cancel?.()
  emit(run, { type: 'grade', grade, status: run.status })
  return grade
}

export function isHarness(value: unknown): value is HarnessId {
  return value === 'claude-code' || value === 'codex' || value === 'opencode' || value === 'pi-agent'
}
