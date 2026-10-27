import { markCut, MOTION_VIEWBOX } from '../brand'

/**
 * The split-O mark. With `motion`, each half can move outward (see the
 * site-brand hover) and the SVG draws into the wider motion frame so the strokes
 * never clip; the mark itself stays `size` tall.
 */
export function OpenEvalMark({ size = 24, motion = false }: { size?: number; motion?: boolean }) {
  const cut = markCut(size)
  return <svg width={motion ? size * 40 / 32 : size} height={size} viewBox={motion ? MOTION_VIEWBOX : '0 0 32 32'} fill="none" aria-hidden="true" className="openeval-mark">
    <path className="openeval-mark-left" d={cut.left} stroke="currentColor" strokeWidth={cut.stroke} strokeLinecap="square" />
    <path className="openeval-mark-right" d={cut.right} stroke="currentColor" strokeWidth={cut.stroke} strokeLinecap="square" />
  </svg>
}
