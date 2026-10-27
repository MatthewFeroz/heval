import { createHash, createHmac, randomBytes } from 'node:crypto'
import { Daytona, DaytonaNotFoundError, type Sandbox } from '@daytona/sdk'
import { ConvexHttpClient } from 'convex/browser'
import { api } from '../../convex/_generated/api'
import { cloudUrl } from '../../packages/cli/src/runner/client'
import type { RunnerProfile } from '../../src/runners/protocol'
import type { Id } from '../../convex/_generated/dataModel'
import type { CapturedEvidence } from '../../packages/cli/src/runner/evidence'
import { managedGateway } from './gateway'
import { ManagedWorkerFailure, reconcileManaged, type ManagedJob } from './lifecycle'

export function coordinatorConfiguration(env: NodeJS.ProcessEnv) {
  const token = env.HEVAL_MANAGED_CONTROL_TOKEN ?? ''
  if (!/^[a-f0-9]{64}$/.test(token) || !env.CONVEX_URL || !env.DAYTONA_API_KEY || !env.HEVAL_GATEWAY_MANAGEMENT_KEY || !env.HEVAL_GATEWAY_PROJECT_ID) throw new Error('Managed coordinator configuration is incomplete.')
  const url = cloudUrl(env.CONVEX_URL)
  return { token, url, daytonaKey: env.DAYTONA_API_KEY, managementKey: env.HEVAL_GATEWAY_MANAGEMENT_KEY, project: env.HEVAL_GATEWAY_PROJECT_ID, target: env.DAYTONA_TARGET ?? 'us' }
}

export async function runManagedCoordinator(signal: AbortSignal, onHeartbeat: () => void, env = process.env) {
  const config = coordinatorConfiguration(env)
  const cloud = new ConvexHttpClient(config.url, { fetch: ((input, init) => fetch(input, { ...init, signal: AbortSignal.timeout(20_000) })) as typeof fetch })
  const daytona = new Daytona({ apiKey: config.daytonaKey, target: config.target })
  const gateway = managedGateway(config.managementKey, config.project)
  const lease = randomBytes(32).toString('hex'), namespace = createHash('sha256').update(config.url).digest('hex').slice(0, 10)
  const args = (job: ManagedJob) => ({ id: job._id, token: config.token, lease })
  const name = (job: ManagedJob) => `heval-${namespace}-${job._id}`
  const credential = (job: ManagedJob) => createHmac('sha256', config.token).update(`runner:${job._id}`).digest('hex')
  let currentJob: ManagedJob | null = null, leaseLost = false
  async function ensureLease() {
    if (!currentJob || leaseLost) throw new Error('Managed coordinator no longer owns this job.')
    const job = currentJob
    try { await cloud.mutation(api.managedComparisons.renew, args(job)); onHeartbeat() }
    catch { if (currentJob?._id === job._id) leaseLost = true; throw new Error('Managed coordinator lease unavailable.') }
  }
  async function find(job: ManagedJob) {
    try {
      const sandbox = await daytona.get(name(job))
      if (sandbox.labels?.['heval.deployment'] !== namespace || sandbox.labels?.['heval.job'] !== job._id) throw new Error('Managed sandbox ownership mismatch.')
      return sandbox
    } catch (e) { if (e instanceof DaytonaNotFoundError) return null; throw e }
  }
  async function command(sandbox: Sandbox, value: string, seconds = 60) {
    await ensureLease()
    const result = await sandbox.process.executeCommand(value, undefined, undefined, seconds)
    if (result.exitCode !== 0) throw new ManagedWorkerFailure('Managed worker command failed.')
  }
  let lastFailure = false
  while (!signal.aborted) {
    try {
      const job = await cloud.mutation(api.managedComparisons.claim, { token: config.token, lease })
      onHeartbeat(); lastFailure = false
      if (job) {
        currentJob = job; leaseLost = false
        let renewing = false
        const renewTimer = setInterval(() => {
          if (renewing) return
          renewing = true
          void ensureLease().catch(() => {}).finally(() => { renewing = false })
        }, 15_000)
        let sandbox: Sandbox | null = null
        try { await reconcileManaged(job, {
          async prepare() {
            sandbox = await find(job)
            // An unactivated VM may have a lost one-time key response. Revoke
            // its credentials and remove it before preparing a fresh runtime.
            if (sandbox) { await ensureLease(); await gateway.removeNamed(name(job)); await ensureLease(); await daytona.delete(sandbox, 60, true) }
            const snapshot = await daytona.snapshot.get(job.snapshot)
            if (snapshot.sandboxClass !== 'linux-vm' || ![snapshot.cpu, snapshot.mem, snapshot.disk].every(Number.isFinite) || snapshot.cpu < 2 || snapshot.cpu > 4 || snapshot.mem < 4 || snapshot.mem > 8 || snapshot.disk < 20 || snapshot.disk > 40 || !/@sha256:[a-f0-9]{64}$/.test(snapshot.imageName ?? '')) throw new Error('Approve a Linux VM snapshot from an immutable image digest within the managed beta resource bounds.')
            await ensureLease()
            const key = await gateway.create(name(job), job.spec.models, job.spec.budgetUsd, job.deadline)
            await ensureLease()
            sandbox = await daytona.create({ name: name(job), snapshot: job.snapshot, user: 'root', public: false, autoStopInterval: 0, autoPauseInterval: 0, autoDeleteInterval: 0, ttlMinutes: Math.max(1, Math.ceil((job.deadline - Date.now()) / 60_000)), queueTimeout: 2, labels: { 'heval.deployment': namespace, 'heval.job': job._id } }, { timeout: 90 })
            await command(sandbox, 'install -d -m 700 -o heval -g heval /home/heval/managed')
            await sandbox.fs.uploadFile(Buffer.from(JSON.stringify({ key: key.key, models: job.spec.models, harnesses: job.spec.harnesses })), '/home/heval/managed/input.json')
            await command(sandbox, "chown heval:heval /home/heval/managed/input.json && chmod 600 /home/heval/managed/input.json && su -s /bin/sh heval -c 'node /opt/heval/dist/managed-worker.js prepare'", 90)
            const profiles = JSON.parse((await sandbox.fs.downloadFile('/home/heval/managed/public-profiles.json')).toString()) as RunnerProfile[]
            return profiles
          },
          async start(_, profiles) {
            sandbox ??= await find(job)
            if (!sandbox) throw new ManagedWorkerFailure('The original managed worker is unavailable. Execution will not be duplicated.')
            const ready = profiles ? await cloud.mutation(api.managedComparisons.ready, { ...args(job), credential: credential(job), profiles }) : { experiment: job.experiment!, runner: job.runner! }
            // Update this local object so progress observes the new experiment
            // in this iteration as well as after a coordinator restart.
            job.experiment = ready.experiment; job.runner = ready.runner
            await sandbox.fs.uploadFile(Buffer.from(JSON.stringify({ url: config.url, credential: credential(job), id: ready.runner, name: 'Managed comparison worker' })), '/home/heval/managed/connection.json')
            await command(sandbox, "chown heval:heval /home/heval/managed/connection.json && chmod 600 /home/heval/managed/connection.json && su -s /bin/sh heval -c 'node /opt/heval/dist/managed-worker.js start'")
          },
          async remove() {
            // Revoke model access first, even if deleting the VM must be retried.
            await ensureLease(); await gateway.removeNamed(name(job))
            sandbox = await find(job)
            if (sandbox) {
              try {
                await command(sandbox, "su -s /bin/sh heval -c 'node /opt/heval/dist/managed-worker.js evidence'")
                const captured = await sandbox.fs.downloadFile('/home/heval/managed/evidence.json')
                if (captured.length <= 200_000) {
                  const entries = JSON.parse(captured.toString()) as CapturedEvidence[]
                  if (job.experiment && entries.length) await cloud.mutation(api.reportEvidence.captureManaged, { job: job._id, token: config.token, entries: entries.map(entry => ({ ...entry, report: entry.report as Id<'reports'> })) })
                }
              } catch { console.error('Managed verifier evidence could not be retained. Saved trial reports remain available.') }
              await ensureLease(); await daytona.delete(sandbox, 60, true)
            }
          },
        }, {
          progress: job => cloud.mutation(api.managedComparisons.progress, args(job)),
          cleaning: async (job, outcome) => { await cloud.mutation(api.managedComparisons.cleanup, { ...args(job), outcome }) },
          finish: async (job, outcome) => { await cloud.mutation(api.managedComparisons.finish, { ...args(job), outcome }) },
        }) } finally { clearInterval(renewTimer); currentJob = null }
      }
    } catch {
      if (!lastFailure) console.error('Managed coordinator could not reconcile its queue. Resources remain reserved for recovery; check service configuration and provider status.')
      lastFailure = true
    }
    if (!signal.aborted) await new Promise<void>(resolve => {
      const done = () => { clearTimeout(timer); signal.removeEventListener('abort', done); resolve() }
      const timer = setTimeout(done, 5000)
      signal.addEventListener('abort', done, { once: true })
    })
  }
}
