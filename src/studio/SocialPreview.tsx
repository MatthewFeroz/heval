import { PRESENTATION_DEFAULT_THEME } from '../charts/presentation-defaults'
import { browserSocialPreview } from './browser-social-preview'
import { useAppAuth, authorizedFetch } from '../auth'
import { SOCIAL_THEMES, type SocialTheme } from '../charts/social-themes'
import { useEffect, useState, useRef, type ReactNode } from 'react'
import {
  SOCIAL_DEFAULTS,
  SOCIAL_PRESETS,
  SOCIAL_QUESTIONS,
  socialSettings,
  type SocialSettings,
  type SocialPreset,
} from '../charts/social-presets'
import { motionInput } from '../project/motion-input'
import type { TrialRow } from '../charts/trial'

export function SocialPreview({
  rows,
  serverExports = true,
  hostedExportControls,
  options,
  onChange,
  unavailableReason,
  collectionUnavailableReason,
}: {
  hostedExportControls?: (ready: boolean, collectionReady: boolean) => ReactNode
  serverExports?: boolean
  rows: readonly TrialRow[]
  options?: SocialSettings
  onChange: (settings: SocialSettings) => void
  unavailableReason?: string
  collectionUnavailableReason?: string
}) {
  const auth = useAppAuth()
  const frames = useRef<(HTMLIFrameElement | null)[]>([])
  const [checks, setChecks] = useState<Record<number, { errors: string[]; adjustments: string[]; svg?: string }>>(
    {},
  )
  useEffect(() => {
    const receive = (event: MessageEvent) => {
      const index = frames.current.findIndex((frame) => frame?.contentWindow === event.source)
      if (
        index < 0 ||
        event.data?.type !== 'heval-layout' ||
        !Array.isArray(event.data.errors) ||
        !Array.isArray(event.data.adjustments)
      )
        return
      setChecks((current) => ({ ...current, [index]: event.data }))
    }
    window.addEventListener('message', receive)
    return () => window.removeEventListener('message', receive)
  }, [])
  const settings = options ?? SOCIAL_DEFAULTS
  const [received, setPreview] = useState<{
    signature: string
    pages: string[]
    chart: { warnings: string[] }
  } | null>(null)
  const [history, setHistory] = useState<{ past: SocialSettings[]; future: SocialSettings[] }>({
    past: [],
    future: [],
  })
  const [error, setError] = useState(''),
    [busy, setBusy] = useState(false),
    [loading, setLoading] = useState(false)
  const payload = JSON.stringify({ input: motionInput(settings.source || 'Heval evaluations', rows), settings })
  const preview = received?.signature === payload && !unavailableReason ? received : null
  useEffect(() => {
    const controller = new AbortController()
    if (unavailableReason || !rows.length) return
    const timer = setTimeout(() => {
      setPreview(null)
      setChecks({})
      setError('')
      setLoading(true)
      if (!serverExports) {
        try {
          setPreview({ ...browserSocialPreview(rows, socialSettings(JSON.parse(payload).settings)), signature: payload })
        } catch (e) { setError((e as Error).message) }
        setLoading(false)
        return
      }
      authorizedFetch(auth, '/api/posters/preview', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: payload,
        signal: controller.signal,
      })
        .then(async (r) => {
          const d = await r.json()
          if (!r.ok) throw new Error(d.error)
          return d
        })
        .then((d) => {
          setPreview({ ...d, signature: payload })
          setLoading(false)
        })
        .catch((e) => {
          if (!controller.signal.aborted) {
            setError(e.message)
            setLoading(false)
          }
        })
    }, 200)
    return () => {
      clearTimeout(timer)
      controller.abort()
    }
  }, [payload, unavailableReason, rows, auth, serverExports])
  const change = (patch: Partial<SocialSettings>) => {
    setHistory((h) => ({ past: [...h.past, settings].slice(-100), future: [] }))
    onChange(socialSettings({ ...settings, ...patch }))
  }
  const undo = () => {
    const prior = history.past.at(-1)
    if (prior) {
      setHistory({ past: history.past.slice(0, -1), future: [settings, ...history.future] })
      onChange(prior)
    }
  }
  const redo = () => {
    const next = history.future[0]
    if (next) {
      setHistory({ past: [...history.past, settings], future: history.future.slice(1) })
      onChange(next)
    }
  }
  async function download(collection: boolean) {
    setBusy(true)
    setError('')
    try {
      if (!serverExports) {
        if (collection) throw new Error('Use hosted export to create a thread ZIP.')
        for (let i = 0; i < (preview?.pages.length ?? 0); i++) {
          const svg = checks[i]?.svg
          if (!svg) throw new Error('Wait for the preview layout check to finish.')
          const url = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml' }))
          const a = document.createElement('a')
          a.href = url
          a.download = `heval-${settings.preset}-${i + 1}.svg`
          a.click()
          setTimeout(() => URL.revokeObjectURL(url), 1000)
        }
        return
      }
      const response = await authorizedFetch(auth, '/api/posters/export', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...JSON.parse(payload), collection }),
      })
      if (!response.ok) throw new Error((await response.json()).error)
      const url = URL.createObjectURL(await response.blob()),
        a = document.createElement('a')
      a.href = url
      a.download =
        response.headers.get('content-disposition')?.match(/filename="([^"]+)"/)?.[1] ??
        'merge-evaluations.png'
      a.click()
      setTimeout(() => URL.revokeObjectURL(url), 1000)
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }
  const layoutReady =
    !!preview && preview.pages.every((_, i) => checks[i] && !checks[i].errors.length && (serverExports || !!checks[i].svg))
  const models = [...new Set(rows.map((r) => r.modelShort))].sort()
  const selected = settings.models.length ? settings.models : models
  return (
    <section className="social-preset-editor">
      <div className="social-preset-controls">
        <label>
          Question
          <select
            aria-label="Question"
            value={settings.preset}
            onChange={(e) => change({ preset: e.target.value as SocialPreset })}
          >
            {Object.entries(SOCIAL_PRESETS).map(([id]) => (
              <option key={id} value={id}>
                {SOCIAL_QUESTIONS[id as SocialPreset]}
              </option>
            ))}
          </select>
        </label>
        <label>
          Style
          <select
            aria-label="Style"
            value={settings.theme ?? PRESENTATION_DEFAULT_THEME}
            onChange={(e) => change({ theme: e.target.value as SocialTheme })}
          >
            {Object.entries(SOCIAL_THEMES).map(([id, t]) => (
              <option key={id} value={id}>
                {t.label}
              </option>
            ))}
          </select>
        </label>
        <div>
          <button className="btn" disabled={!history.past.length} onClick={undo}>
            Undo
          </button>{' '}
          <button className="btn" disabled={!history.future.length} onClick={redo}>
            Redo
          </button>{' '}
          <button
            className="btn"
            disabled={busy || loading || !layoutReady || !!unavailableReason}
            onClick={() => void download(false)}
          >
            {serverExports ? 'Export image' : 'Export SVG'}{settings.preset === 'disagreement' ? '(s)' : ''}
          </button>{' '}
          <button
            className="btn primary"
            hidden={!!hostedExportControls || !serverExports}
            disabled={
              busy ||
              loading ||
              !layoutReady ||
              !!unavailableReason ||
              !!collectionUnavailableReason || !serverExports
            }
            title={collectionUnavailableReason}
            onClick={() => void download(true)}
          >
            {busy ? 'Rendering...' : 'Export thread ZIP'}
          </button>
        </div>
      </div>
      {hostedExportControls?.(layoutReady && !unavailableReason, !collectionUnavailableReason)}
      {!serverExports && <p>Preview and SVG export use your browser’s fonts. Hosted PNG and ZIP exports use the original presentation fonts.</p>}
      <details className="social-customize">
        <summary>Customize models, text and thread</summary>
        <div className="social-preset-controls">
          {' '}
          <label>
            Source
            <input
              value={settings.source}
              maxLength={150}
              onChange={(e) => change({ source: e.target.value })}
            />
          </label>
          <div className="social-visibility">
            {(
              [
                ['showSubtitle', 'Task-count subtitle'],
                ['showDirection', 'Direction label'],
                ['showSource', 'Source footer'],
              ] as const
            ).map(([key, label]) => (
              <label key={key}>
                <input
                  type="checkbox"
                  checked={settings[key]}
                  onChange={(e) => change({ [key]: e.target.checked })}
                />
                {label}
              </label>
            ))}
          </div>
          <fieldset>
            <legend>Models</legend>
            {models.map((m) => (
              <label key={m}>
                <input
                  type="checkbox"
                  checked={selected.includes(m)}
                  disabled={
                    (selected.includes(m) && selected.length === 1) ||
                    (!selected.includes(m) && selected.length >= 6)
                  }
                  onChange={(e) =>
                    change({
                      models: e.target.checked ? [...selected, m] : selected.filter((x) => x !== m),
                    })
                  }
                />
                {m}
              </label>
            ))}
          </fieldset>
          <fieldset>
            <legend>Charts in ZIP</legend>
            <p className="social-collection-help" id="social-collection-help">
              Choose charts for the ZIP export. The Question menu above controls the single-image preview.
              {' '}Keep at least one chart selected.
            </p>
            <span className="social-selection-count" role="status">{settings.collection.length} charts selected</span>
            <div className="social-chart-choices" aria-describedby="social-collection-help">
            {Object.entries(SOCIAL_PRESETS)
              .filter(([id]) => id !== 'completion')
              .map(([id, p]) => (
                <label className="social-chart-choice" key={id}>
                  <input
                    aria-label={p.label}
                    type="checkbox"
                    checked={settings.collection.includes(id as SocialPreset)}
                    disabled={
                      settings.collection.length === 1 &&
                      settings.collection.includes(id as SocialPreset)
                    }
                    onChange={(e) =>
                      change({
                        collection: e.target.checked
                          ? [...settings.collection, id as SocialPreset]
                          : settings.collection.filter((x) => x !== id),
                      })
                    }
                  />
                  <span>
                    <strong>{p.label}</strong>
                    <small>{SOCIAL_QUESTIONS[id as SocialPreset]}</small>
                  </span>
                </label>
              ))}
            </div>
          </fieldset>
        </div>
      </details>
      {(error || unavailableReason) && <p role="alert">{unavailableReason || error}</p>}
      {collectionUnavailableReason && <p>{collectionUnavailableReason}</p>}
      {!rows.length && <p>Select evaluation data to generate images.</p>}
      {loading && !unavailableReason && <p>Preparing preview...</p>}
      {preview?.chart.warnings.map((w) => (
        <p key={w}>{w}</p>
      ))}
      {preview && (
        <p role="status">
          {layoutReady
            ? 'Layout checked. Ready to export.'
            : Object.values(checks).some((c) => c.errors.length)
              ? 'Layout needs adjustment before export.'
              : 'Checking label fit...'}
        </p>
      )}
      {Object.values(checks)
        .flatMap((c) => c.errors)
        .map((message, i) => (
          <p role="alert" key={i}>
            {message}. Try fewer models or shorter labels.
          </p>
        ))}
      {Object.values(checks).some((c) => c.adjustments.length > 0) && (
        <details>
          <summary>Automatic label adjustments</summary>
          {Object.values(checks)
            .flatMap((c) => c.adjustments)
            .map((message, i) => (
              <p key={i}>{message}</p>
            ))}
        </details>
      )}
      {preview?.pages.map((html, i) => (
        <iframe
          ref={(frame) => {
            frames.current[i] = frame
          }}
          key={i}
          title={'Social chart preview ' + (i + 1)}
          sandbox="allow-scripts"
          srcDoc={html}
          style={{
            width: '100%',
            aspectRatio: '16 / 9',
            border: 0,
            display: 'block',
            marginTop: 20,
          }}
        />
      ))}
    </section>
  )
}
