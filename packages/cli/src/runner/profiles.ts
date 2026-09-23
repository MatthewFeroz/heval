import { existsSync, mkdirSync, cpSync, readFileSync, renameSync, rmSync } from 'node:fs'
import { basename, dirname, isAbsolute, join, resolve } from 'node:path'
import { validateProfiles, type RunnerProfile } from '../../../../src/runners/protocol'
import { BENCHMARKS, type Benchmark } from '../../../../src/runners/benchmarks'
import { hashDirectory, randomSecret, readJson, sha256, writeJson } from './files'
import { mergeAgent, mergePath, mergeStatus, mergeHarnesses } from '../merge'

type JsonObject = Record<string, unknown>
type Descriptor = { id: string; title: string; benchmark: string; config: string; timeoutSeconds: number; envFile?: string; maxAttempts?: number; provider?: 'merge' }
export type LocalProfile = { public: RunnerProfile; config: JsonObject; taskPaths: string[]; taskHashes: string[]; envFile?: string; mergeConnection?: string }
const object = (value: unknown): JsonObject => { if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Expected a JSON object in the profile.'); return value as JsonObject }
export function initializeProfiles(directory: string, bundledTask: string) {
  const path = join(directory, 'profiles.json')
  if (existsSync(path)) return path
  mkdirSync(directory, { recursive: true, mode: 0o700 })
  // Explicit traversal avoids Node's native recursive-copy failure on Docker Desktop bind mounts.
  cpSync(bundledTask, join(directory, 'tasks/heval-setup'), { recursive: true, filter: name => !name.split('/').some(part => part === '.git' || part === '__pycache__') })
  writeJson(join(directory, 'setup.json'), { n_attempts: 1, agents: [{ name: 'oracle' }], tasks: [{ path: 'tasks/heval-setup' }] })
  writeJson(path, { schemaVersion: 1, profiles: [{ id: 'heval-setup', title: 'Check this machine', benchmark: 'Heval setup check v1', config: 'setup.json', timeoutSeconds: 300 }] })
  return path
}
export function loadProfiles(file: string, connectionDirectory = dirname(file)): LocalProfile[] {
  if (readFileSync(file).length > 100_000) throw new Error('The profile registry must be smaller than 100 KB.')
  const registry = readJson<{ schemaVersion: number; profiles: Descriptor[] }>(file)
  if (registry.schemaVersion !== 1 || !Array.isArray(registry.profiles) || registry.profiles.length > 20) throw new Error('Use a schemaVersion 1 profile registry with at most 20 profiles.')
  const loaded = registry.profiles.map(d => {
    const path = resolve(dirname(file), d.config)
    if (readFileSync(path).length > 100_000) throw new Error('Use a Harbor JSON config smaller than 100 KB.')
    const input = readJson<JsonObject>(path)
    for (const key of Object.keys(input)) if (!['n_attempts', 'agents', 'tasks'].includes(key)) throw new Error(`Unsupported profile config field: ${key}. This release accepts n_attempts, agents, and explicit local tasks.`)
    if (!Array.isArray(input.agents) || input.agents.length !== 1 || !Array.isArray(input.tasks) || !input.tasks.length || input.tasks.length > 20) throw new Error('Approve one agent/model and 1–20 explicit local task directories per profile.')
    let agent = object(input.agents[0])
    if (!['oracle', 'codex', 'claude-code', 'opencode', 'pi', 'terminus-2'].includes(String(agent.name)) || agent.import_path) throw new Error('Use a built-in supported Harbor agent.')
    for (const key of Object.keys(agent)) if (!['name', 'model_name', 'kwargs', 'env', 'override_timeout_sec', 'override_setup_timeout_sec'].includes(key)) throw new Error(`Unsupported agent field: ${key}`)
    if (agent.name !== 'oracle' && (typeof agent.model_name !== 'string' || !agent.model_name)) throw new Error('A model-backed profile needs model_name.')
    const displayModel = String(agent.model_name)
    if (d.provider !== undefined && d.provider !== 'merge') throw new Error('Unsupported profile provider.')
    if (d.provider === 'merge') {
      if (d.envFile || agent.env || agent.kwargs) throw new Error('Merge profiles manage credentials and harness settings automatically. Remove envFile, agent.env and agent.kwargs.')
      const connection = mergeStatus(connectionDirectory)
      if (!connection.connected || !connection.models.includes(displayModel)) throw new Error('Connect Merge and select a model from the validated catalog.')
      agent = { ...agent, ...mergeAgent(String(agent.name), displayModel) }
    }
    const taskPaths = input.tasks.map(t => {
      const task = object(t)
      if (typeof task.path !== 'string' || Object.keys(task).some(k => k !== 'path')) throw new Error('Each approved task must contain just its local path.')
      const path = resolve(dirname(resolve(dirname(file), d.config)), task.path)
      if (!existsSync(join(path, 'task.toml')) || !existsSync(join(path, 'instruction.md'))) throw new Error('Each approved task needs task.toml and instruction.md.')
      return path
    })
    const taskHashes = taskPaths.map(hashDirectory)
    const config = { n_attempts: input.n_attempts ?? 1, n_concurrent_trials: 1, retry: { max_retries: 0 }, agents: [agent], tasks: taskPaths.map(path => ({ path })), environment: { type: 'docker', delete: true, cpu_enforcement_policy: 'limit', memory_enforcement_policy: 'limit' } }
    const description = { id: d.id, title: d.title, benchmark: d.benchmark, agent: String(agent.name), model: agent.name === 'oracle' ? 'Reference solution (no model)' : displayModel, tasks: taskPaths.length, attempts: Number(config.n_attempts), timeoutSeconds: d.timeoutSeconds, setupCheck: agent.name === 'oracle', taskSet: sha256(JSON.stringify(taskHashes)), vendor: typeof object(agent.env ?? {}).HEVAL_VENDOR === 'string' ? String(object(agent.env ?? {}).HEVAL_VENDOR) : 'Provider default', maxAttempts: d.maxAttempts ?? Number(config.n_attempts) }
    // Include all executable task content and agent settings, excluding local path names.
    const digest = sha256(JSON.stringify({ description, config: { ...config, tasks: taskHashes } }))
    let envFile: string | undefined
    if (d.envFile) { envFile = isAbsolute(d.envFile) ? d.envFile : resolve(dirname(file), d.envFile); if (!existsSync(envFile)) throw new Error('The profile envFile does not exist on this machine.') }
    return { public: { ...description, digest }, config, taskPaths, taskHashes, envFile, ...(d.provider === 'merge' ? { mergeConnection: mergePath(connectionDirectory) } : {}) }
  })
  validateProfiles(loaded.map(p => p.public))
  return loaded
}

const copyTask = (from: string, to: string) => cpSync(from, to, { recursive: true, filter: name => !name.split('/').some(part => part === '.git' || part === '__pycache__') })

/** Copy a catalog benchmark's pinned tasks into the runner state, refusing any content that differs from the pin. */
function installBenchmark(directory: string, id: string, source: string, catalog: Benchmark[]) {
  const benchmark = catalog.find(b => b.id === id)
  if (!benchmark || benchmark.id === 'heval-smoke' || !benchmark.taskHashes || benchmark.status === 'unsupported') throw new Error(`Choose an installable benchmark: ${catalog.filter(b => b.taskHashes && b.status !== 'unsupported' && b.id !== 'heval-smoke').map(b => b.id).join(', ')}.`)
  const target = join(directory, 'benchmarks', benchmark.id)
  for (const [task, expected] of benchmark.taskHashes) {
    const path = join(resolve(source), task)
    if (!existsSync(join(path, 'task.toml'))) throw new Error(`${task} is missing from ${source}. Check out ${benchmark.source?.commit ?? 'the pinned commit'} first.`)
    if (hashDirectory(path) !== expected) throw new Error(`${task} differs from the pinned ${benchmark.title} content. Check out ${benchmark.source?.commit ?? 'the pinned commit'} and try again.`)
  }
  if (!existsSync(target)) {
    const staging = `${target}.${randomSecret().slice(0, 8)}.tmp`
    mkdirSync(dirname(target), { recursive: true, mode: 0o700 })
    try { for (const [task] of benchmark.taskHashes) copyTask(join(resolve(source), task), join(staging, task)); renameSync(staging, target) } finally { rmSync(staging, { recursive: true, force: true }) }
  }
  if (benchmark.taskHashes.some(([task, expected]) => hashDirectory(join(target, task)) !== expected)) throw new Error(`The installed copy in ${target} was modified. Remove it and run setup again.`)
  return benchmark
}

/** Add explicit smoke profiles without changing existing user-approved jobs. */
export function setupMergeProfiles(directory: string, bundledTask: string, model: string, harnesses: string[], benchmark?: { id: string; source: string }, catalog = BENCHMARKS) {
  if (!harnesses.length || new Set(harnesses).size !== harnesses.length || harnesses.some(h => !mergeHarnesses.includes(h as typeof mergeHarnesses[number]))) throw new Error(`Choose unique harnesses from: ${mergeHarnesses.join(', ')}.`)
  const connection = mergeStatus(directory)
  if (!connection.connected || !connection.models.includes(model)) throw new Error('Connect Merge first and choose a model listed by provider status.')
  const path = initializeProfiles(directory, bundledTask)
  const registry = readJson<{ schemaVersion: number; profiles: Descriptor[] }>(path)
  if (registry.schemaVersion !== 1 || !Array.isArray(registry.profiles)) throw new Error('Invalid existing profile registry.')
  if (registry.profiles.length + harnesses.length > 20) throw new Error('At most 20 profiles are supported.')
  const entry = benchmark && installBenchmark(directory, benchmark.id, benchmark.source, catalog)
  // Benchmark profiles include the model so one benchmark can offer several models per harness.
  const idFor = (harness: string) => entry ? `${entry.id}-${harness}-${sha256(model).slice(0, 8)}` : `merge-${harness}`
  for (const harness of harnesses) {
    if (registry.profiles.some(p => p.id === idFor(harness)) || existsSync(join(directory, `${idFor(harness)}.json`))) throw new Error(`${idFor(harness)} already exists; edit or remove that profile before replacing it.`)
  }
  for (const harness of harnesses) {
    const id = idFor(harness)
    const tasks = entry ? entry.taskHashes!.map(([task]) => ({ path: `benchmarks/${entry.id}/${task}` })) : [{ path: 'tasks/heval-setup' }]
    writeJson(join(directory, `${id}.json`), { n_attempts: 1, agents: [{ name: harness, model_name: model }], tasks })
    registry.profiles.push(entry
      ? { id, title: `${entry.title}: ${harness} / ${model}`, benchmark: entry.title, config: `${id}.json`, provider: 'merge', timeoutSeconds: entry.timeoutSeconds ?? 3600 }
      : { id, title: `Merge smoke: ${harness}`, benchmark: 'Heval model connection smoke test', config: `${id}.json`, provider: 'merge', timeoutSeconds: 600 })
  }
  writeJson(path, registry)
  return harnesses.map(idFor)
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

/** The browser may vary attempts only inside the worker's explicit approval. */
export function requestedProfile(profile: LocalProfile, attempts?: number): LocalProfile {
  if (attempts === undefined) return profile
  if (!Number.isSafeInteger(attempts) || attempts < 1 || attempts > (profile.public.maxAttempts ?? profile.public.attempts) || attempts * profile.public.tasks > 60) throw new Error('Requested attempts exceed this machine’s approval.')
  return { ...profile, config: { ...profile.config, n_attempts: attempts } }
}
