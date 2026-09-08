let busy = false
export function acquireExport(): (() => void) | null {
  if (busy) return null
  busy = true
  return () => {
    busy = false
  }
}
