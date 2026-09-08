import { posterDocuments, renderPosters } from './social-posters'
import { socialSettings } from '../src/charts/social-presets'
import { parseMotionInput } from '../src/project/motion-input'
import { presentationCompositionHtml, compositionHtml, renderSocialExport, socialCompositionAsset, SOCIAL_FORMATS, SocialExportError, type SocialFormat } from './social-export'
import { completionOptions } from '../harbor/social/completion'

export const exportsEnabled = process.env.HEVAL_ENABLE_EXPORTS === '1'
export async function socialApi(req: Request): Promise<Response | null> {
  const url = new URL(req.url)
  if (['/api/posters/preview', '/api/posters/export'].includes(url.pathname) && req.method === 'POST') {
    if (!exportsEnabled) return Response.json({ error: 'Local exports are disabled' }, { status: 403 })
    let input, settings, collection
    try {
      const body = await req.json()
      input = parseMotionInput(body.input)
      settings = socialSettings(body.settings)
      collection = body.collection === true
      if (collection) for (const preset of settings.collection) posterDocuments(input, { ...settings, preset })
      else posterDocuments(input, settings)
    } catch (error) { return Response.json({ error: (error as Error).message }, { status: 400 }) }
    try {
      if (url.pathname.endsWith('/preview')) return Response.json(posterDocuments(input, settings), { headers: { 'Cache-Control': 'no-store' } })
      const output = await renderPosters(input, settings, collection)
      return new Response(new Uint8Array(output.bytes), { headers: { 'Content-Type': output.type, 'Content-Disposition': 'attachment; filename="' + output.filename + '"', 'Cache-Control': 'no-store' } })
    } catch (error) { return Response.json({ error: (error as Error).message }, { status: (error as { status?: number }).status ?? 500 }) }
  }
    const compositionMatch = url.pathname.match(/^\/results\/harbor\/social\/([a-z0-9][a-z0-9-]*)\/index\.html$/)
    if (compositionMatch && req.method === 'GET') {
      if (!exportsEnabled) return new Response('Social exports are disabled', { status: 403 })
      try {
        // The editor's knobs ride in the query string, so the player reloads a
        // new composition just by changing its src.
        const html = await compositionHtml(compositionMatch[1], completionOptions(Object.fromEntries(url.searchParams)))
        return new Response(html, { headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' } })
      } catch (error) {
        return new Response((error as Error).message, { status: error instanceof SocialExportError ? error.status : 500 })
      }
    }
    const compositionAssetMatch = url.pathname.match(/^\/results\/harbor\/social\/([a-z0-9][a-z0-9-]*)\/assets\/([^/]+)$/)
    if (compositionAssetMatch && req.method === 'GET') {
      if (!exportsEnabled) return new Response('Social exports are disabled', { status: 403 })
      try {
        return new Response(Bun.file(socialCompositionAsset(compositionAssetMatch[1], compositionAssetMatch[2])), {
          headers: { 'Content-Type': 'text/javascript; charset=utf-8', 'Cache-Control': 'public, max-age=31536000, immutable' },
        })
      } catch (error) {
        return new Response((error as Error).message, { status: error instanceof SocialExportError ? error.status : 500 })
      }
    }
    if (url.pathname === '/api/social/preview' && req.method === 'POST') {
      if (!exportsEnabled) return Response.json({ error: 'Social exports are disabled on this server' }, { status: 403 })
      try {
        const body = await req.json() as { input?: unknown; options?: Record<string, unknown> }
        const input = parseMotionInput(body.input)
        const html = await presentationCompositionHtml(input, completionOptions(body.options))
        return new Response(html, { headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' } })
      } catch (error) {
        return Response.json({ error: (error as Error).message }, { status: 400 })
      }
    }
    if (url.pathname === '/api/social/export' && req.method === 'POST') {
      if (!exportsEnabled) return Response.json({ error: 'Social exports are disabled on this server' }, { status: 403 })
      const body = await req.json().catch(() => ({})) as { input?: unknown; job?: unknown; format?: unknown; options?: Record<string, unknown> }
      if ((typeof body.job !== 'string' && !body.input) || !SOCIAL_FORMATS.includes(body.format as SocialFormat)) {
        return Response.json({ error: 'Expected presentation data or a catalog job and format mp4, png, or jpeg' }, { status: 400 })
      }
      try {
        let input
        try { input = body.input === undefined ? undefined : parseMotionInput(body.input) } catch (error) { return Response.json({ error: (error as Error).message }, { status: 400 }) }
        const output = await renderSocialExport(input?.job ?? body.job as string, body.format as SocialFormat, completionOptions(body.options), input)
        return new Response(new Uint8Array(output.bytes), {
          headers: {
            'Content-Type': output.type,
            'Content-Disposition': `attachment; filename="${output.filename}"`,
            'Cache-Control': 'no-store',
          },
        })
      } catch (error) {
        const status = error instanceof SocialExportError ? error.status : 500
        return Response.json({ error: (error as Error).message }, { status })
      }
    }

  return null
}
