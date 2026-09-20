'use node'
import { v } from 'convex/values'
import { internalAction } from './_generated/server'
import { internal } from './_generated/api'
import { renderHostedExport } from '../server/hosted-exports/render'

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
