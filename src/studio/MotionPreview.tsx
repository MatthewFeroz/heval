import { useAppAuth, authorizedFetch } from '../auth'
import { motionInput } from '../project/motion-input'
import { useEffect, useMemo, useState, type CSSProperties, type ReactNode } from 'react'
import { AlertTriangle, Download, Film, Image as ImageIcon, RefreshCw, RotateCcw, Tags } from 'lucide-react'
import '@hyperframes/player'
import {
  CANVAS_IDS,
  COMPLETION_CONTROLS,
  COMPLETION_DEFAULTS,
  COMPLETION_FLAGS,
  COMPLETION_TEXT,
  COMPLETION_TICK_STEPS,
  FLAG_OPTIONS,
  MOTION_CANVASES,
  OVERRIDE_MAPS,
  TEXT_OPTIONS,
  motionCanvas,
  sameCompletionOptions,
  tickStepRate,
  type CanvasId,
  type CompletionOptions,
  type FlagOption,
  type NumericOption,
  type OverrideMap,
  type TextOption,
} from '../charts/motion-options'
import { MOTION_THEMES, THEME_IDS } from '../charts/motion-themes'
import { barLabelText, builtInCopy, tickKey } from '../charts/motion-copy'
import { buildPanel, PANELS } from '../charts/poster'
import type { TrialRow } from '../charts/trial'

type Format = 'mp4' | 'png' | 'jpeg'

function filenameFromHeader(header: string | null, fallback: string) {
  return header?.match(/filename="([^"]+)"/)?.[1] ?? fallback
}

function save(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = name
  anchor.click()
  URL.revokeObjectURL(url)
}

const pct = (v: number) => `${Math.round(v * 100)}%`

export function MotionPreview({
  job,
  rows,
  unavailableReason,
  options,
  onOptionsChange,
}: {
  job: string | null
  /**
   * The same resolved and filtered rows used by the presentation chart.
   */
  rows: readonly TrialRow[]
  unavailableReason?: string
  options?: CompletionOptions
  onOptionsChange?: (options: CompletionOptions) => void
}) {
  const auth = useAppAuth()
  const [preview, setPreview] = useState<{ url: string; input: ReturnType<typeof motionInput>; options: CompletionOptions; signature: string } | null>(null)
  const input = useMemo(() => motionInput(job ?? 'Presentation', rows), [job, rows])
  const [exportsEnabled, setExportsEnabled] = useState<boolean | null>(null)
  const [rendering, setRendering] = useState<Format | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [playerKey, setPlayerKey] = useState(0)
  // `draft` tracks the control under the cursor; `applied` is what the player and
  // the exporters use. Every keystroke of a drag would otherwise rebuild a
  // composition with megabytes of inlined fonts.
  const [localDraft, setDraft] = useState<CompletionOptions>(() => options ?? COMPLETION_DEFAULTS)
  const draft = options ?? localDraft
  const [applied, setApplied] = useState<CompletionOptions>(() => options ?? COMPLETION_DEFAULTS)

  const signature = JSON.stringify({ input, options: applied })

  const change = (next: CompletionOptions) => {
    setDraft(next)
    onOptionsChange?.(next)
  }

  useEffect(() => {
    authorizedFetch(auth, '/api/health')
      .then((response) => response.json())
      .then((health: { exportsEnabled?: boolean }) => setExportsEnabled(Boolean(health.exportsEnabled)))
      .catch(() => setExportsEnabled(false))
  }, [auth])

  useEffect(() => {
    const timer = setTimeout(() => setApplied(draft), 350)
    return () => clearTimeout(timer)
  }, [draft])

  const order = useMemo(() => [...new Set(rows.map((row) => row.modelShort))].sort(), [rows])

  /**
   * Exactly the bars the composition will draw: same panel, same rank order,
   * same omissions for models with no computable value. Deriving the list here
   * rather than from the raw model set means the label inputs cannot offer a
   * bar the frame does not have.
   */
  const panel = useMemo(
    () => (rows.length && order.length
      ? buildPanel(
        rows,
        { ...PANELS.completion, axisMax: draft.axisMax, axisMin: draft.axisMin, tickStep: draft.tickStep || undefined },
        order,
      )
      : null),
    [rows, order, draft.axisMax, draft.axisMin, draft.tickStep],
  )
  const bars = panel?.bars ?? []
  const ticks = panel?.ticks ?? []
  // Reading the count off the built panel rather than dividing by hand keeps
  // the readout honest when a step does not divide the span evenly.
  const tickCount = panel?.ticks.length ?? 0

  const built = useMemo(() => builtInCopy(rows, job ?? '', order.length, PANELS.completion.better), [rows, job, order])

  const exportFile = async (format: Format) => {
    if (!preview || preview.signature !== signature) return
    setRendering(format)
    setError(null)
    try {
      const response = await authorizedFetch(auth, '/api/social/export', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ input: preview.input, format, options: preview.options }),
      })
      if (!response.ok) {
        const payload = await response.json().catch(() => ({ error: response.statusText })) as { error?: string }
        throw new Error(payload.error || `Export failed with ${response.status}`)
      }
      const extension = format === 'jpeg' ? 'jpg' : format
      save(await response.blob(), filenameFromHeader(response.headers.get('content-disposition'), `${job}-completion-${applied.canvas}.${extension}`))
    } catch (cause) {
      setError((cause as Error).message)
    } finally {
      setRendering(null)
    }
  }

  useEffect(() => {
    if (exportsEnabled !== true || !rows.length || unavailableReason) return
    const controller = new AbortController()
    let objectUrl: string | null = null
    authorizedFetch(auth, '/api/social/preview', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: signature, signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) throw new Error((await response.json() as { error: string }).error)
        const html = await response.text()
        if (controller.signal.aborted) return
        objectUrl = URL.createObjectURL(new Blob([html], { type: 'text/html' }))
        const request = JSON.parse(signature) as { input: ReturnType<typeof motionInput>; options: CompletionOptions }
        setPreview({ url: objectUrl, ...request, signature })
        setError(null)
      })
      .catch((error: Error) => { if (!controller.signal.aborted) setError(error.message) })
    return () => { controller.abort(); if (objectUrl) URL.revokeObjectURL(objectUrl) }
  }, [signature, exportsEnabled, rows.length, unavailableReason, auth])

  if (unavailableReason) return <div className="motion-empty"><Film size={22} /><strong>Completion data unavailable</strong><p>{unavailableReason}</p></div>

  if (!rows.length) {
    return <div className="motion-empty"><Film size={22} /><strong>No presentation rows</strong><p>Select compatible sources and save the analysis to create a presentation.</p></div>
  }

  if (exportsEnabled === false) {
    return <div className="motion-empty"><Film size={22} /><strong>Local exports are disabled</strong><p>Start Heval with <code>HEVAL_ENABLE_EXPORTS=1 bun run start</code> to load the player and export media.</p></div>
  }

  const frame = motionCanvas(applied.canvas)
  const busy = rendering !== null
  const ready = preview?.signature === signature
  const modified = !sameCompletionOptions(draft, COMPLETION_DEFAULTS)
  const overrideCount = (map: OverrideMap) => Object.values(draft[map] ?? {}).filter(Boolean).length

  /**
   * What each slot draws while it is blank. The five copy slots come from the
   * same function the composition falls back to, and the wordmark from the
   * theme, so the grey text in every input is the literal string on the frame.
   */
  const placeholders: Record<TextOption, string> = {
    wordmark: MOTION_THEMES[draft.theme].wordmark || 'no wordmark in this theme',
    title: built.title,
    kicker: built.kicker,
    cue: built.cue,
    note: built.note,
    source: built.source,
  }

  const slider = (key: NumericOption, label: string, readout: string, hint: string) => (
    <label className="motion-knob" key={key}>
      <span className="motion-knob-label">{label}<em>{readout}</em></span>
      <input
        type="range"
        min={COMPLETION_CONTROLS[key].min}
        max={COMPLETION_CONTROLS[key].max}
        step={COMPLETION_CONTROLS[key].step}
        value={draft[key]}
        disabled={busy}
        onChange={(event) => change({ ...draft, [key]: Number(event.target.value) })}
      />
      <small>{hint}</small>
    </label>
  )

  const flagControl = (key: FlagOption) => (
    <label className="motion-knob motion-knob-check" key={key}>
      <span className="motion-knob-label">{COMPLETION_FLAGS[key].label}</span>
      <span className="check">
        <input
          type="checkbox"
          checked={draft[key]}
          disabled={busy}
          onChange={(event) => change({ ...draft, [key]: event.target.checked })}
        />
        Show
      </span>
      <small>{COMPLETION_FLAGS[key].hint}</small>
    </label>
  )

  const textControl = (key: TextOption) => {
    const field = COMPLETION_TEXT[key]
    return (
      <label className={`motion-knob motion-knob-text${field.wide ? ' motion-knob-wide' : ''}`} key={key}>
        {/* The readout says which of the two states the slot is in, so an empty
            input reads as "showing the built-in" rather than "showing nothing". */}
        <span className="motion-knob-label">{field.label}<em>{draft[key] ? `${draft[key].length}/${field.max}` : 'built-in'}</em></span>
        <input
          type="text"
          value={draft[key]}
          placeholder={placeholders[key]}
          maxLength={field.max}
          disabled={busy}
          onChange={(event) => change({ ...draft, [key]: event.target.value })}
        />
        <small>{field.hint}</small>
      </label>
    )
  }

  const setOverride = (map: OverrideMap, key: string, value: string) => {
    const next = { ...(draft[map] ?? {}) }
    // Dropping the key rather than storing '' keeps a cleared input out of the
    // player URL and off the override count.
    if (value) next[key] = value
    else delete next[key]
    change({ ...draft, [map]: next })
  }

  /**
   * One group per family of per-element overrides. `entries` is derived from the
   * built panel, so each group offers exactly the elements the frame draws, in
   * the order it draws them, and each placeholder is that element's real text.
   */
  const overrideGroup = (
    map: OverrideMap,
    title: string,
    hint: ReactNode,
    entries: { key: string; placeholder: string }[],
  ) => {
    const count = overrideCount(map)
    const max = OVERRIDE_MAPS[map].max
    return (
      <div className="motion-labels">
        <div className="motion-labels-head">
          <Tags size={12} />
          <strong>{title}</strong>
          <small>{hint}</small>
          <button
            type="button"
            className="btn sm ghost"
            onClick={() => change({ ...draft, [map]: {} })}
            disabled={busy || !count}
          >
            <RotateCcw size={12} />{count ? `Clear ${count}` : 'All built-in'}
          </button>
        </div>
        <div className="motion-controls">
          {entries.map(({ key, placeholder }) => {
            const value = draft[map]?.[key] ?? ''
            return (
              <label className="motion-knob motion-knob-text" key={key}>
                <span className="motion-knob-label">
                  <code>{key}</code>
                  <em>{value ? `${value.length}/${max}` : 'built-in'}</em>
                </span>
                <input
                  type="text"
                  value={value}
                  placeholder={placeholder}
                  maxLength={max}
                  disabled={busy}
                  onChange={(event) => setOverride(map, key, event.target.value)}
                />
              </label>
            )
          })}
        </div>
      </div>
    )
  }

  return (
    <div className="motion-panel">
      <div className="motion-toolbar">
        <div>
          <span className="eyebrow">HyperFrames 0.8.27</span>
          <strong>Completion-rate reveal</strong>
          <small>{applied.duration}s · {frame.width}×{frame.height} · 30 fps · silent</small>
        </div>
        <div className="motion-actions">
          <button type="button" className="btn" onClick={() => setPlayerKey((key) => key + 1)} disabled={busy}>
            <RefreshCw size={13} />Replay
          </button>
          <button type="button" className="btn" onClick={() => void exportFile('png')} disabled={busy || exportsEnabled !== true || !ready}>
            <ImageIcon size={13} />{rendering === 'png' ? 'Rendering…' : 'PNG'}
          </button>
          <button type="button" className="btn" onClick={() => void exportFile('jpeg')} disabled={busy || exportsEnabled !== true || !ready}>
            <ImageIcon size={13} />{rendering === 'jpeg' ? 'Rendering…' : 'JPEG'}
          </button>
          <button type="button" className="btn primary" onClick={() => void exportFile('mp4')} disabled={busy || exportsEnabled !== true || !ready}>
            <Download size={13} />{rendering === 'mp4' ? 'Rendering MP4…' : 'MP4'}
          </button>
        </div>
      </div>

      <div className="motion-controls">
        <label className="motion-knob motion-knob-text">
          <span className="motion-knob-label">Theme</span>
          <select
            value={draft.theme}
            disabled={busy}
            onChange={(event) => change({ ...draft, theme: event.target.value as typeof draft.theme })}
          >
            {THEME_IDS.map((id) => <option key={id} value={id}>{MOTION_THEMES[id].label}</option>)}
          </select>
          <small>palette, fonts, and branding</small>
        </label>
        <label className="motion-knob motion-knob-text">
          <span className="motion-knob-label">Canvas</span>
          <select
            value={draft.canvas}
            disabled={busy}
            onChange={(event) => change({ ...draft, canvas: event.target.value as CanvasId })}
          >
            {CANVAS_IDS.map((id) => <option key={id} value={id}>{MOTION_CANVASES[id].label}</option>)}
          </select>
          <small>frame size · plot fills what remains</small>
        </label>
        {TEXT_OPTIONS.map((key) => textControl(key))}
        {slider('typeScale', 'Text size', pct(draft.typeScale), 'scales labels and header spacing · outer padding stays fixed')}
        {slider('topPad', 'Top margin', `${draft.topPad}px`, 'space above the lockup · lower it to lift the header and grow the plot')}
        {slider('duration', 'Length', `${draft.duration}s`, 'the whole timeline stretches to fit')}
        {slider('axisMax', 'Axis ceiling', pct(draft.axisMax), 'top of the scale · lower it to cut empty sky')}
        {slider('axisMin', 'Axis floor', pct(draft.axisMin), 'bottom of the scale · 0% keeps bars proportional')}
        <label className="motion-knob motion-knob-text">
          <span className="motion-knob-label">Tick step<em>{tickCount} levels</em></span>
          <select
            value={draft.tickStep}
            disabled={busy}
            onChange={(event) => change({ ...draft, tickStep: tickStepRate(event.target.value) })}
          >
            {COMPLETION_TICK_STEPS.map((step) => <option key={step.value} value={step.value}>{step.label}</option>)}
          </select>
          <small>interval between ticks · Gridlines rules each one</small>
        </label>
        {slider('tickOffset', 'Tick nudge', `${draft.tickOffset}%`, 'vertical offset · 0% sits on the tick')}
        {FLAG_OPTIONS.map((key) => flagControl(key))}
        <button
          type="button"
          className="btn sm ghost"
          onClick={() => change({ ...COMPLETION_DEFAULTS, barLabels: {} })}
          disabled={busy || !modified}
        >
          <RotateCcw size={12} />Reset all
        </button>
      </div>

      {/* Everything else the frame draws is per-element rather than a fixed
          slot, so each family gets its own row keyed by what it labels. */}
      {bars.length > 0 && overrideGroup(
        'barLabels',
        'Bar labels',
        <>in plot order · <code>|</code> breaks the line · blank keeps the derived name</>,
        bars.map((bar) => ({ key: bar.key, placeholder: barLabelText(bar.key) })),
      )}

      {ticks.length > 0 && overrideGroup(
        'tickLabels',
        'Tick labels',
        <>bottom to top · text only, the scale still places the tick</>,
        ticks.map((tick) => ({ key: tickKey(tick.value), placeholder: tick.label })),
      )}

      {bars.length > 0 && overrideGroup(
        'valueLabels',
        'Bar values',
        <>the number above each bar · blank keeps the measured value</>,
        bars.map((bar) => ({ key: bar.key, placeholder: PANELS.completion.format(bar.value) })),
      )}

      {overrideCount('valueLabels') > 0 && (
        <div className="motion-note">
          <AlertTriangle size={13} />
          <span>
            {overrideCount('valueLabels') === 1 ? 'One bar prints' : `${overrideCount('valueLabels')} bars print`} a
            label instead of the value measured for it. The bar heights still come from the data, so a caption that
            disagrees with its own bar will read as an error to anyone who checks it against the report.
          </span>
        </div>
      )}

      {applied.axisMin > 0 && (
        <div className="motion-note">
          <AlertTriangle size={13} />
          <span>
            Floor above 0% truncates the baseline: bar length no longer matches the value, so a {pct(applied.axisMax)} bar
            and a {pct(applied.axisMin + (applied.axisMax - applied.axisMin) / 2)} bar look further apart than they are.
            It also adds empty sky rather than removing it — the ceiling is the control for that.
          </span>
        </div>
      )}

      {error && <div className="motion-error">{error}</div>}
      <div
        className="motion-stage"
        style={{ '--motion-w': frame.width, '--motion-h': frame.height } as CSSProperties}
      >
        {ready && preview ? <hyperframes-player
          key={`${preview.url}-${playerKey}`}
          src={preview.url}
          width={String(frame.width)}
          height={String(frame.height)}
          controls=""
          muted=""
          audio-locked=""
          autoplay=""
        /> : <p role="status">{error ? 'Preview unavailable' : 'Preparing preview…'}</p>}
      </div>
    </div>
  )
}
