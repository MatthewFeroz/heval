import { useEffect, useRef } from 'react'
import { Terminal } from '@xterm/xterm'
import '@xterm/xterm/css/xterm.css'
import type { RunEvent, Runner } from '../data'
import { terminalFrame } from './terminalFrames'

type Props = { runner: Runner; visibleEvents: RunEvent[]; isDone: boolean; started: boolean; rawData?: string }

export function HarnessTui(props: Props) {
  const host = useRef<HTMLDivElement>(null)
  const redraw = useRef<(() => void) | null>(null)
  const current = useRef(props)

  useEffect(() => {
    current.current = props
    redraw.current?.()
  }, [props])

  useEffect(() => {
    const element = host.current
    if (!element) return
    const term = new Terminal({
      cols: 80,
      rows: 24,
      convertEol: true,
      cursorBlink: false,
      disableStdin: true,
      fontFamily: 'ui-monospace, "SFMono-Regular", Menlo, Consolas, monospace',
      fontSize: 11,
      lineHeight: 1.1,
      scrollback: 0,
      theme: { background: '#0d0e0e', foreground: '#d8d8d4', cursor: '#d8d8d4' },
    })
    term.open(element)
    let disposed = false
    let writing = false
    let requested = false
    let frame = 0
    let lastFrame = ''
    const schedule = () => {
      if (disposed) return
      requested = true
      if (!writing) {
        cancelAnimationFrame(frame)
        frame = requestAnimationFrame(render)
      }
    }
    const render = () => {
      if (disposed || !element.clientWidth || !element.clientHeight) return
      requested = false
      const style = getComputedStyle(element)
      const width = element.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight)
      const height = element.clientHeight - parseFloat(style.paddingTop) - parseFloat(style.paddingBottom)
      const fontSize = width < 300 ? 10 : 11
      if (term.options.fontSize !== fontSize) {
        term.options.fontSize = fontSize
        schedule()
        return
      }
      // Measure real cells after font layout; CSS font size is not a column width.
      const screen = element.querySelector<HTMLElement>('.xterm-screen')
      if (!screen?.offsetWidth || !screen.offsetHeight) return
      const cellWidth = parseFloat(screen.style.width) / term.cols
      const cellHeight = parseFloat(screen.style.height) / term.rows
      const cols = Math.max(40, Math.floor(width / cellWidth))
      const rows = Math.max(18, Math.floor(height / cellHeight))
      const resized = cols !== term.cols || rows !== term.rows
      if (resized) {
        term.resize(cols, rows)
        // These are complete frames; discard reflowed rows from the previous size.
        term.reset()
      }
      const { runner, visibleEvents, isDone, started, rawData } = current.current
      const data = rawData !== undefined
        ? `\x1b[0m\x1b[2J\x1b[H${rawData}`
        : terminalFrame(runner, visibleEvents, isDone, started, cols, rows)
      if (!resized && data === lastFrame) return
      lastFrame = data
      // Finish the current ANSI frame before resizing or disposing the parser.
      writing = true
      term.write(data, () => {
        writing = false
        if (disposed) term.dispose()
        else if (requested) schedule()
      })
    }
    redraw.current = schedule
    const observer = new ResizeObserver(schedule)
    observer.observe(element)
    // Font loading and device pixel ratio changes also alter the screen metrics.
    const screen = element.querySelector('.xterm-screen')
    if (screen) observer.observe(screen)
    void document.fonts.ready.then(schedule)
    schedule()
    return () => {
      disposed = true
      cancelAnimationFrame(frame)
      observer.disconnect()
      redraw.current = null
      if (!writing) term.dispose()
    }
  }, [])

  return <div className="real-terminal" ref={host} role="img" aria-label={`${props.runner.name} ${props.started ? 'terminal replay' : 'startup terminal'}`} />
}
