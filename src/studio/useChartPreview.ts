import { useEffect, useRef, useState } from 'react'
import embed, { type Result as EmbedResult } from 'vega-embed'

/** Owns the displayed Vega view and the export handle for that exact render. */
export function useChartPreview(spec: object | null) {
  const host = useRef<HTMLDivElement>(null)
  const view = useRef<EmbedResult['view'] | null>(null)
  const [error, setError] = useState<string | null>(null)
  useEffect(() => {
    if (!host.current) return
    host.current.replaceChildren()
    view.current = null
    if (!spec) return
    let disposed = false
    let result: EmbedResult | null = null
    // Each request gets its own detached host, so an obsolete asynchronous
    // embed cannot replace the DOM belonging to a newer chart.
    const container = document.createElement('div')
    embed(container, spec as never, { actions: false, renderer: 'svg' })
      .then((next) => {
        if (disposed) return next.finalize()
        result = next
        host.current?.replaceChildren(container)
        view.current = next.view
        setError(null)
      })
      .catch((cause: Error) => { if (!disposed) setError(cause.message) })
    return () => { disposed = true; result?.finalize(); view.current = null }
  }, [spec])
  return { host, view, error, setError }
}
