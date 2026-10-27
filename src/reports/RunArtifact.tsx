import { useMemo, useState } from 'react'
import { parseTimeline, type EvidenceKind } from './runArtifacts'
import { previewDocument } from './previewDocument'

export type TrialArtifact = { id: string; trial: string; title: string; kind: EvidenceKind; text: string; hash: string; published: boolean }

export function RunArtifact({ artifact }: { artifact: TrialArtifact }) {
  if (artifact.kind === 'timeline') return <Timeline key={artifact.id} text={artifact.text} />
  if (artifact.kind === 'html') return <HtmlPreview source={artifact.text} />
  if (artifact.kind === 'image') return <Screenshot source={artifact.text} title={artifact.title} />
  return <pre className={`run-evidence-text run-evidence-${artifact.kind}`}>{artifact.text}</pre>
}
function HtmlPreview({ source }: { source: string }) {
  const document = useMemo(() => previewDocument(source), [source])
  const [width, setWidth] = useState('100%'), [open, setOpen] = useState(false)
  return <div className="run-preview">
    <p className="report-muted">Static HTML preview. Scripts, links, forms and network access are disabled.</p>
    {!open ? <button type="button" onClick={() => setOpen(true)}>Load output preview</button> : <>
      <label>Preview width<select aria-label="Preview width" value={width} onChange={event => setWidth(event.target.value)}><option value="100%">Fit panel</option><option value="320px">Mobile · 320 px</option></select></label>
      <iframe title="Recorded HTML output" sandbox="" referrerPolicy="no-referrer" srcDoc={document} style={{ width, maxWidth: '100%' }} />
    </>}
  </div>
}
function Screenshot({ source, title }: { source: string; title: string }) {
  const [expanded, setExpanded] = useState(false)
  return <figure className="run-screenshot"><button type="button" aria-expanded={expanded} onClick={() => setExpanded(value => !value)}>{expanded ? 'Fit screenshot' : 'Expand screenshot'}</button><img src={source} alt={title} style={expanded ? undefined : { maxHeight: 420, objectFit: 'contain', objectPosition: 'top' }} /><figcaption>Recorded screenshot</figcaption></figure>
}
function Timeline({ text }: { text: string }) {
  const [index, setIndex] = useState(0)
  const result = useMemo(() => { try { return { timeline: parseTimeline(text), error: '' } } catch { return { timeline: null, error: 'This recorded timeline could not be read.' } } }, [text])
  if (!result.timeline) return <p role="alert">{result.error}</p>
  const events = result.timeline.events, selected = events[Math.min(index, events.length - 1)], start = events[0].at
  const elapsed = (at: number) => `+${((at - start) / 1000).toFixed(1)}s`
  return <div className="run-timeline">
    <p className="report-muted">Recorded events · {events.length} retained · {elapsed(events.at(-1)!.at)} observed span</p>
    <div className="run-timeline-controls"><button type="button" aria-label="Previous recorded event" disabled={index === 0} onClick={() => setIndex(value => value - 1)}>Previous</button><label>Event<input aria-label="Recorded event" type="range" min={0} max={events.length - 1} value={index} onChange={event => setIndex(Number(event.target.value))} /></label><button type="button" aria-label="Next recorded event" disabled={index >= events.length - 1} onClick={() => setIndex(value => value + 1)}>Next</button></div>
    <div className="run-event-detail" aria-live="polite"><span className="report-eyebrow">{elapsed(selected.at)} · {selected.kind}</span><h4>{selected.title}</h4>{selected.text && <pre>{selected.text}</pre>}</div>
    <details><summary>All recorded events</summary><ol className="run-event-list">{events.map((event, position) => <li key={position}><button type="button" aria-pressed={position === index} onClick={() => setIndex(position)}>{elapsed(event.at)} · {event.title}</button></li>)}</ol></details>
  </div>
}
