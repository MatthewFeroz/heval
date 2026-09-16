import { existsSync, mkdirSync, cpSync, readFileSync } from 'node:fs'
import { basename, dirname, isAbsolute, join, resolve } from 'node:path'
import { validateProfiles, type RunnerProfile } from '../../../../src/runners/protocol'
import { hashDirectory, readJson, sha256, writeJson } from './files'

type JsonObject = Record<string, unknown>
type Descriptor = { id: string; title: string; benchmark: string; config: string; timeoutSeconds: number; envFile?: string }
export type LocalProfile = { public: RunnerProfile; config: JsonObject; taskPaths: string[]; taskHashes: string[]; envFile?: string }
const object = (value: unknown): JsonObject => { if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Expected a JSON object in the profile.'); return value as JsonObject }
export function initializeProfiles(directory: string, bundledTask: string) {
  const path = join(directory, 'profiles.json')
  if (existsSync(path)) return path
  mkdirSync(directory, { recursive: true, mode: 0o700 })
  cpSync(bundledTask, join(directory, 'tasks/heval-setup'), { recursive: true })
  writeJson(join(directory, 'setup.json'), { n_attempts: 1, agents: [{ name: 'oracle' }], tasks: [{ path: 'tasks/heval-setup' }] })
  writeJson(path, { schemaVersion: 1, profiles: [{ id: 'heval-setup', title: 'Check this machine', benchmark: 'Heval setup check v1', config: 'setup.json', timeoutSeconds: 300 }] })
  return path
}
export function loadProfiles(file: string): LocalProfile[] {
  if (readFileSync(file).length > 100_000) throw new Error('The profile registry must be smaller than 100 KB.')
  const registry = readJson<{ schemaVersion: number; profiles: Descriptor[] }>(file)
  if (registry.schemaVersion !== 1 || !Array.isArray(registry.profiles) || registry.profiles.length > 20) throw new Error('Use a schemaVersion 1 profile registry with at most 20 profiles.')
  const loaded = registry.profiles.map(d => {
    const path = resolve(dirname(file), d.config)
    if (readFileSync(path).length > 100_000) throw new Error('Use a Harbor JSON config smaller than 100 KB.')
    const input = readJson<JsonObject>(path)
    for (const key of Object.keys(input)) if (!['n_attempts', 'agents', 'tasks'].includes(key)) throw new Error(`Unsupported profile config field: ${key}. This release accepts n_attempts, agents, and explicit local tasks.`)
    if (!Array.isArray(input.agents) || input.agents.length !== 1 || !Array.isArray(input.tasks) || !input.tasks.length || input.tasks.length > 20) throw new Error('Approve one agent/model and 1–20 explicit local task directories per profile.')
    const agent = object(input.agents[0])
    if (!['oracle', 'codex', 'claude-code', 'opencode', 'terminus-2'].includes(String(agent.name)) || agent.import_path) throw new Error('Use a built-in supported Harbor agent.')
    for (const key of Object.keys(agent)) if (!['name', 'model_name', 'kwargs', 'env', 'override_timeout_sec', 'override_setup_timeout_sec'].includes(key)) throw new Error(`Unsupported agent field: ${key}`)
    if (agent.name !== 'oracle' && (typeof agent.model_name !== 'string' || !agent.model_name)) throw new Error('A model-backed profile needs model_name.')
    const taskPaths = input.tasks.map(t => {
      const task = object(t)
      if (typeof task.path !== 'string' || Object.keys(task).some(k => k !== 'path')) throw new Error('Each approved task must contain just its local path.')
      const path = resolve(dirname(resolve(dirname(file), d.config)), task.path)
      if (!existsSync(join(path, 'task.toml')) || !existsSync(join(path, 'instruction.md'))) throw new Error('Each approved task needs task.toml and instruction.md.')
      return path
    })
    const taskHashes = taskPaths.map(hashDirectory)
    const config = { n_attempts: input.n_attempts ?? 1, n_concurrent_trials: 1, retry: { max_retries: 0 }, agents: [agent], tasks: taskPaths.map(path => ({ path })), environment: { type: 'docker', delete: true, cpu_enforcement_policy: 'limit', memory_enforcement_policy: 'limit' } }
    const description = { id: d.id, title: d.title, benchmark: d.benchmark, agent: String(agent.name), model: agent.name === 'oracle' ? 'Reference solution (no model)' : String(agent.model_name), tasks: taskPaths.length, attempts: Number(config.n_attempts), timeoutSeconds: d.timeoutSeconds, setupCheck: agent.name === 'oracle' }
    // Include all executable task content and agent settings, excluding local path names.
    const digest = sha256(JSON.stringify({ description, config: { ...config, tasks: taskHashes } }))
    let envFile: string | undefined
    if (d.envFile) { envFile = isAbsolute(d.envFile) ? d.envFile : resolve(dirname(file), d.envFile); if (!existsSync(envFile)) throw new Error('The profile envFile does not exist on this machine.') }
    return { public: { ...description, digest }, config, taskPaths, taskHashes, envFile }
  })
  validateProfiles(loaded.map(p => p.public))
  return loaded
}
export function snapshotProfile(profile: LocalProfile, directory: string) {
  const tasks = profile.taskPaths.map((path, index) => {
    const target = join(directory, 'tasks', String(index + 1), basename(path))
    cpSync(path, target, { recursive: true, filter: name => !name.split('/').some(part => part === '.git' || part === '__pycache__') })
    if (hashDirectory(target) !== profile.taskHashes[index]) throw new Error('Task contents changed while creating the run. Review the updated profile and start again.')
    return { path: target }
  })
  const config = { ...profile.config, tasks, job_name: 'evaluation', jobs_dir: join(directory, 'jobs') }
  writeJson(join(directory, 'harbor.json'), config)
}
