import { useEffect, useState } from 'react'
import {
  SOCIAL_DEFAULTS,
  SOCIAL_PRESETS,
  socialSettings,
  type SocialSettings,
  type SocialPreset,
} from '../charts/social-presets'
import { motionInput } from '../project/motion-input'
import type { TrialRow } from '../charts/trial'

export function SocialPreview({
  rows,
  options,
  onChange,
  unavailableReason,
  collectionUnavailableReason,
}: {
  rows: readonly TrialRow[]
  options?: SocialSettings
  onChange: (settings: SocialSettings) => void
  unavailableReason?: string
  collectionUnavailableReason?: string
}) {
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
  const payload = JSON.stringify({ input: motionInput('Merge Evaluations', rows), settings })
  const preview = received?.signature === payload && !unavailableReason ? received : null
  useEffect(() => {
    const controller = new AbortController()
    if (unavailableReason || !rows.length) return
    const timer = setTimeout(() => {
      setPreview(null)
      setError('')
      setLoading(true)
      fetch('/api/posters/preview', {
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
  }, [payload, unavailableReason, rows.length])
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
      const response = await fetch('/api/posters/export', {
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
  const models = [...new Set(rows.map((r) => r.modelShort))].sort()
  const selected = settings.models.length ? settings.models : models
  return (
    <section className="social-preset-editor">
      <div className="social-preset-controls">
        <label>
          Chart preset
          <select
            value={settings.preset}
            onChange={(e) => change({ preset: e.target.value as SocialPreset })}
          >
            {Object.entries(SOCIAL_PRESETS).map(([id, p]) => (
              <option key={id} value={id}>
                {p.label}
              </option>
            ))}
          </select>
        </label>
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
                  change({ models: e.target.checked ? [...selected, m] : selected.filter((x) => x !== m) })
                }
              />
              {m}
            </label>
          ))}
        </fieldset>
        <fieldset>
          <legend>Images in thread</legend>
          {Object.entries(SOCIAL_PRESETS)
            .filter(([id]) => id !== 'completion')
            .map(([id, p]) => (
              <label key={id}>
                <input
                  type="checkbox"
                  checked={settings.collection.includes(id as SocialPreset)}
                  disabled={
                    settings.collection.length === 1 && settings.collection.includes(id as SocialPreset)
                  }
                  onChange={(e) =>
                    change({
                      collection: e.target.checked
                        ? [...settings.collection, id as SocialPreset]
                        : settings.collection.filter((x) => x !== id),
                    })
                  }
                />
                {p.label}
              </label>
            ))}
        </fieldset>
        <div>
          <button className="btn" disabled={!history.past.length} onClick={undo}>
            Undo
          </button>{' '}
          <button className="btn" disabled={!history.future.length} onClick={redo}>
            Redo
          </button>{' '}
          <button
            className="btn"
            disabled={busy || loading || !preview || !!unavailableReason}
            onClick={() => void download(false)}
          >
            Export image{settings.preset === 'disagreement' ? '(s)' : ''}
          </button>{' '}
          <button
            className="btn primary"
            disabled={busy || loading || !preview || !!unavailableReason || !!collectionUnavailableReason}
            title={collectionUnavailableReason}
            onClick={() => void download(true)}
          >
            {busy ? 'Rendering...' : 'Export thread ZIP'}
          </button>
        </div>
      </div>
      {(error || unavailableReason) && <p role="alert">{unavailableReason || error}</p>}
      {collectionUnavailableReason && <p>{collectionUnavailableReason}</p>}
      {!rows.length && <p>Select evaluation data to generate images.</p>}
      {loading && !unavailableReason && <p>Preparing preview...</p>}
      {preview?.chart.warnings.map((w) => (
        <p key={w}>{w}</p>
      ))}
      {preview?.pages.map((html, i) => (
        <iframe
          key={i}
          title={'Social chart preview ' + (i + 1)}
          sandbox=""
          srcDoc={html}
          style={{ width: '100%', aspectRatio: '16 / 9', border: 0, display: 'block', marginTop: 20 }}
        />
      ))}
    </section>
  )
}
