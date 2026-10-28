import { expect, test, mock } from 'bun:test'
import { ManagedWorkerFailure, reconcileManaged, type ManagedJob } from './lifecycle'

const job = (fields: Partial<ManagedJob> = {}) => ({ _id: 'fixture', status: 'running', experiment: 'original-experiment', deadline: Date.now() + 60_000, cancelRequested: false, ...fields }) as ManagedJob
function setup() {
  const resources = { prepare: mock(async () => []), start: mock(async () => {}), remove: mock(async () => {}) }
  const control = { progress: mock(async () => ({ complete: false, cancel: false, expired: false, failed: false })), cleaning: mock(async () => {}), finish: mock(async () => {}) }
  return { resources, control }
}
test('coordinator restart reconnects to an activated job without preparing new resources', async () => {
  const { resources, control } = setup()
  await reconcileManaged(job(), resources, control)
  expect(resources.prepare).not.toHaveBeenCalled()
  expect(resources.start).toHaveBeenCalledTimes(1)
  expect(resources.remove).not.toHaveBeenCalled()
})
test('cleanup failure never acknowledges completion or releases the durable slot', async () => {
  const { resources, control } = setup()
  control.progress.mockResolvedValue({ complete: true, cancel: false, expired: false, failed: false })
  resources.remove.mockRejectedValue(new Error('Provider unavailable'))
  await expect(reconcileManaged(job(), resources, control)).rejects.toThrow('Provider unavailable')
  expect(control.cleaning).toHaveBeenCalledWith(expect.anything(), 'completed')
  expect(control.finish).not.toHaveBeenCalled()
  expect(resources.prepare).not.toHaveBeenCalled()
})
test('cancelled, expired and cleaning jobs only remove resources, preserving cleanup outcome', async () => {
  for (const fields of [{ cancelRequested: true }, { deadline: 0 }, { status: 'cleanup' as const, cleanupOutcome: 'completed' as const }]) {
    const { resources, control } = setup()
    await reconcileManaged(job(fields), resources, control)
    expect(resources.start).not.toHaveBeenCalled(); expect(resources.prepare).not.toHaveBeenCalled()
    expect(resources.remove).toHaveBeenCalledTimes(1)
    expect(control.finish).toHaveBeenCalledWith(expect.anything(), fields.cancelRequested ? 'cancelled' : fields.cleanupOutcome ?? 'failed')
  }
})
test('ambiguous preparation or launch failure cleans up rather than repeating model work', async () => {
  const { resources, control } = setup()
  resources.start.mockRejectedValue(new Error('Lost launch acknowledgment'))
  await reconcileManaged(job({ experiment: undefined }), resources, control)
  expect(resources.prepare).toHaveBeenCalledTimes(1); expect(resources.start).toHaveBeenCalledTimes(1)
  expect(resources.remove).toHaveBeenCalledTimes(1)
  expect(control.finish).toHaveBeenCalledWith(expect.anything(), 'failed')
})
test('cancellation gives the original supervisor a bounded chance to upload partial evidence', async () => {
  const { resources, control } = setup()
  control.progress.mockResolvedValue({ complete: false, cancel: true, expired: false, failed: false, cleanupAfter: Date.now() + 60_000 } as Awaited<ReturnType<typeof control.progress>>)
  await reconcileManaged(job({ cancelRequested: true }), resources, control)
  expect(resources.start).not.toHaveBeenCalled(); expect(resources.remove).not.toHaveBeenCalled()
  expect(control.finish).not.toHaveBeenCalled()
})
test('temporary status and provider failures preserve existing execution for reconnection', async () => {
  for (const stage of ['progress', 'start'] as const) {
    const { resources, control } = setup()
    if (stage === 'progress') control.progress.mockRejectedValue(new Error('Cloud unavailable'))
    else resources.start.mockRejectedValue(new Error('Provider unavailable'))
    await expect(reconcileManaged(job(), resources, control)).rejects.toThrow('unavailable')
    expect(resources.prepare).not.toHaveBeenCalled(); expect(resources.remove).not.toHaveBeenCalled()
    expect(control.finish).not.toHaveBeenCalled()
  }
})
test('a confirmed missing original VM fails and cleans up without provisioning a replacement', async () => {
  const { resources, control } = setup()
  resources.start.mockRejectedValue(new ManagedWorkerFailure('Original VM missing'))
  await reconcileManaged(job(), resources, control)
  expect(resources.prepare).not.toHaveBeenCalled(); expect(resources.remove).toHaveBeenCalledTimes(1)
  expect(control.finish).toHaveBeenCalledWith(expect.anything(), 'failed')
})
