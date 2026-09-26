import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from 'react'
import { createPortal } from 'react-dom'
import { X } from 'lucide-react'
import { FIRST_RUN_TOUR, TOUR_ID, type TourStep } from './firstRunTour'
import './tour.css'

type Rect = { top: number; left: number; width: number; height: number }
const CARD_WIDTH = 360, GAP = 12, PAD = 6

function tourHref(step: TourStep, index: number) {
  return `${step.page}?tour=${TOUR_ID}&step=${index}`
}
const visible = (target: string) => [...document.querySelectorAll<HTMLElement>(`[data-tour="${target}"]`)].find(el => el.getClientRects().length)

/**
 * Spotlight tour driven by `?tour=first-run&step=N`, so a step survives
 * reloads and moves between pages with the URL. The page stays usable: the
 * overlay never captures clicks, and the card sits beside the highlighted area.
 */
export function Tour() {
  const params = new URLSearchParams(location.search)
  const [index, setIndex] = useState(() => params.get('tour') === TOUR_ID ? Math.min(Math.max(Number(params.get('step')) || 0, 0), FIRST_RUN_TOUR.length - 1) : -1)
  const [rect, setRect] = useState<Rect | null>(null)
  const [missing, setMissing] = useState(false)
  const [cardHeight, setCardHeight] = useState(240)
  const direction = useRef(1)
  const card = useRef<HTMLDivElement>(null), heading = useRef<HTMLHeadingElement>(null)
  const step = index >= 0 ? FIRST_RUN_TOUR[index] : undefined

  function close() {
    const url = new URL(location.href)
    url.searchParams.delete('tour'); url.searchParams.delete('step')
    history.replaceState(null, '', url)
    setIndex(-1)
  }
  function go(next: number) {
    if (next < 0 || next >= FIRST_RUN_TOUR.length) return close()
    direction.current = next > index ? 1 : -1
    const target = FIRST_RUN_TOUR[next]
    if (target.page !== location.pathname) return location.assign(tourHref(target, next))
    const url = new URL(location.href)
    url.searchParams.set('step', String(next))
    history.replaceState(null, '', url)
    setRect(null); setMissing(false)
    setIndex(next)
  }

  // Find the target once the page's data has rendered; skip optional steps that never appear.
  useEffect(() => {
    if (!step) return
    if (step.page !== location.pathname) { location.replace(tourHref(step, index)); return }
    let tries = 0, timer = 0
    const find = () => {
      const el = visible(step.target)
      if (el) {
        el.scrollIntoView({ block: 'center', behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' })
        return
      }
      if (++tries < 20) { timer = window.setTimeout(find, 100); return }
      if (step.optional) go(index + direction.current)
      else setMissing(true)
    }
    find()
    return () => clearTimeout(timer)
    // eslint-disable-next-line react-hooks/exhaustive-deps -- re-run per step only
  }, [index])

  // Track the highlighted element through scrolling, resizing, and content changes, not on every frame.
  useLayoutEffect(() => {
    if (!step || missing) return
    let frame = 0
    const measure = () => {
      cancelAnimationFrame(frame)
      frame = requestAnimationFrame(() => {
        const el = visible(step.target)
        if (!el) return
        const r = el.getBoundingClientRect()
        setRect({ top: r.top - PAD, left: r.left - PAD, width: r.width + PAD * 2, height: r.height + PAD * 2 })
      })
    }
    measure()
    const observer = new ResizeObserver(measure)
    const el = visible(step.target)
    if (el) observer.observe(el)
    observer.observe(document.body)
    addEventListener('scroll', measure, true); addEventListener('resize', measure)
    return () => { cancelAnimationFrame(frame); observer.disconnect(); removeEventListener('scroll', measure, true); removeEventListener('resize', measure) }
  }, [step, missing])

  // Focus moves to each step's title once its card is on screen.
  const shown = !!step && (missing || rect !== null)
  useLayoutEffect(() => {
    if (!shown || !card.current) return
    const element = card.current
    const measure = () => setCardHeight(element.getBoundingClientRect().height)
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(element)
    return () => observer.disconnect()
  }, [shown, index])
  useEffect(() => { if (shown) heading.current?.focus({ preventScroll: true }) }, [index, shown])

  if (!step || (!rect && !missing)) return null
  const width = Math.min(CARD_WIDTH, innerWidth - 32)
  let position: CSSProperties = { width }
  if (missing || !rect) position = { ...position, left: (innerWidth - width) / 2, top: Math.max(16, (innerHeight - cardHeight) / 2) }
  else {
    const left = Math.min(Math.max(16, rect.left), innerWidth - width - 16)
    const below = innerHeight - (rect.top + rect.height)
    // Beside the target when there is room, else pinned to the bottom edge over the page.
    position = below >= cardHeight + GAP + 16 ? { ...position, left, top: rect.top + rect.height + GAP }
      : rect.top >= cardHeight + GAP + 16 ? { ...position, left, bottom: innerHeight - rect.top + GAP }
      : { ...position, left, bottom: 16 }
  }
  const last = index === FIRST_RUN_TOUR.length - 1
  return createPortal(<div className="tour" onKeyDown={event => {
    if (event.key === 'Escape') close()
    if (event.key === 'ArrowRight') go(index + 1)
    if (event.key === 'ArrowLeft' && index > 0) go(index - 1)
  }}>
    {rect && !missing ? <div className="tour-spotlight" style={rect} /> : <div className="tour-backdrop" />}
    <div className="tour-card" ref={card} role="dialog" aria-modal="false" aria-labelledby="tour-title" aria-describedby="tour-body" style={position}>
      <div className="tour-card-head">
        <span className="tour-count" aria-live="polite">{index + 1} of {FIRST_RUN_TOUR.length}</span>
        <button type="button" className="tour-close" aria-label="Close tour" onClick={close}><X size={16} aria-hidden="true" /></button>
      </div>
      <h2 id="tour-title" ref={heading} tabIndex={-1}>{step.title}</h2>
      <p id="tour-body">{step.body}{missing && ' This appears once a worker is connected.'}</p>
      <div className="tour-actions">
        {index > 0 && <button type="button" className="secondary" onClick={() => go(index - 1)}>Back</button>}
        <button type="button" className="primary" onClick={() => go(index + 1)}>{last ? 'Done' : FIRST_RUN_TOUR[index + 1].page !== step.page ? 'Next: Evaluations' : 'Next'}</button>
      </div>
    </div>
  </div>, document.querySelector('.report-shell') ?? document.body)
}
