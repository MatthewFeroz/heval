import { useSyncExternalStore } from 'react'

export type ReportSection = 'results' | 'analyze' | 'export' | 'share'
export const reportSections: { id: ReportSection; label: string }[] = [
  { id: 'results', label: 'Results' },
  { id: 'analyze', label: 'Analyze' },
  { id: 'export', label: 'Export' },
  { id: 'share', label: 'Share' },
]
const event = 'heval-workspace-navigation'
function subscribe(listener: () => void) {
  window.addEventListener('popstate', listener)
  window.addEventListener(event, listener)
  return () => { window.removeEventListener('popstate', listener); window.removeEventListener(event, listener) }
}
export function useReportSection(fallback: ReportSection = 'results') {
  const search = useSyncExternalStore(subscribe, () => location.search)
  const value = new URLSearchParams(search).get('tab')
  const section: ReportSection = reportSections.find(s => s.id === value)?.id ?? fallback
  return { section, navigate(next: ReportSection) {
    const url = new URL(location.href)
    url.searchParams.set('tab', next)
    history.pushState(null, '', url)
    window.dispatchEvent(new Event(event))
  } }
}

export function reportHref(id: string, section: ReportSection = 'results') {
  return `/library?report=${encodeURIComponent(id)}${section === 'results' ? '' : `&tab=${section}`}`
}

