import type { Doc } from '../../convex/_generated/dataModel'
import type { RunnerProfile } from '../../src/runners/protocol'

export type ManagedJob = Doc<'managedComparisons'>
/** A confirmed lost VM/daemon, distinct from a transient provider/network error. */
export class ManagedWorkerFailure extends Error {}
export interface ManagedResources {
  /** Recover only the original named VM. Never recreate an activated job. */
  prepare(job: ManagedJob): Promise<RunnerProfile[]>
  start(job: ManagedJob, profiles?: RunnerProfile[]): Promise<void>
  remove(job: ManagedJob): Promise<void>
}
export interface ManagedControl {
  progress(job: ManagedJob): Promise<{ complete: boolean; cancel: boolean; expired: boolean; failed: boolean; cleanupAfter?: number }>
  cleaning(job: ManagedJob, outcome: 'completed' | 'cancelled' | 'failed'): Promise<void>
  finish(job: ManagedJob, outcome: 'completed' | 'cancelled' | 'failed'): Promise<void>
}

/** Cleanup remains retryable. An unavailable provider cannot release the queue. */
export async function reconcileManaged(job: ManagedJob, resources: ManagedResources, control: ManagedControl) {
  let outcome: 'completed' | 'cancelled' | 'failed' = job.cancelRequested ? 'cancelled' : job.cleanupOutcome ?? 'failed'
  if (job.status !== 'cleanup') {
    let progress = job.experiment ? await control.progress(job) : null
    if (!progress?.complete && !job.cancelRequested && !progress?.cancel && job.deadline > Date.now()) {
      try {
        if (!job.experiment) await resources.start(job, await resources.prepare(job))
        else await resources.start(job)
      } catch (error) {
        // Existing execution survives network/control-plane errors. A confirmed
        // missing VM/daemon fails without replacement. An ambiguous *initial*
        // launch is cleaned up rather than submitted again.
        if (job.experiment && !(error instanceof ManagedWorkerFailure)) throw error
        await control.cleaning(job, 'failed')
        await resources.remove(job)
        await control.finish(job, job.cancelRequested ? 'cancelled' : 'failed')
        return
      }
      // A lost status response must not kill otherwise healthy model work.
      progress = await control.progress(job)
    }
    // Let the original supervisor upload partial verified results on cancellation.
    if (progress && !progress.complete && progress.cleanupAfter && Date.now() < progress.cleanupAfter) return
    if (progress && !progress.complete && !progress.cancel && !progress.expired && !job.cancelRequested && job.deadline > Date.now()) return
    if (progress) {
      outcome = job.cancelRequested || progress.cancel ? 'cancelled' : progress.complete && !progress.failed ? 'completed' : 'failed'
    }
  }
  await control.cleaning(job, outcome)
  await resources.remove(job)
  await control.finish(job, outcome)
}
