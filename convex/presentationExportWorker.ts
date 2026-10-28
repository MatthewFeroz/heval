'use node'
import { v } from 'convex/values'
import { internalAction } from './_generated/server'
import { internal } from './_generated/api'
import { renderHostedExport } from '../server/hosted-exports/render'

export const cleanup = internalAction({ args: { paths: v.array(v.string()), attempt: v.number() }, handler: async (ctx, { paths, attempt }) => {
  try {
    const { del } = await import('@vercel/blob')
    await del(paths, { token: process.env.BLOB_READ_WRITE_TOKEN })
  } catch {
    if (attempt >= 10) throw new Error('Deleted report export cleanup failed after retries. Inspect the scheduled cleanup job.')
    await ctx.scheduler.runAfter(Math.min(3600_000, 30_000 * 2 ** attempt), internal.presentationExportWorker.cleanup, { paths, attempt: attempt + 1 })
  }
} })

export const render = internalAction({ args: { job: v.id('presentationExports') }, handler: async (ctx, { job }) => {
  const input = await ctx.runQuery(internal.presentationExports.input, { job })
  if (!input) return
  try {
    const artifact = await renderHostedExport({ job, payload: input.payload, snapshotId: input.snapshotId })
    const accepted = await ctx.runMutation(internal.presentationExports.finish, { job, artifact })
    if (!accepted) {
      const { del } = await import('@vercel/blob')
      await del(artifact.pathname, { token: process.env.BLOB_READ_WRITE_TOKEN })
    }
  } catch {
    // Do not return provider error bodies (which can contain tokens or private data).
    await ctx.runMutation(internal.presentationExports.finish, { job, error: 'The export could not be rendered. Check the presentation layout or contact the workspace administrator.' })
  }
} })
