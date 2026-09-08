import type { ChartState } from '../charts/recipes'
import type { AnalysisFilter, AnalysisView } from './schema'

export type EditorDocument = {
  chart: ChartState
  filters: AnalysisFilter[]
  sourceIds: string[]
  customSpec: string | null
}
export type EditorHistory = { past: EditorDocument[]; present: EditorDocument; future: EditorDocument[] }
export type EditorAction =
  | { type: 'change'; update: (current: EditorDocument) => EditorDocument }
  | { type: 'load'; document: EditorDocument }
  | { type: 'undo' }
  | { type: 'redo' }

export function editorReducer(history: EditorHistory, action: EditorAction): EditorHistory {
  if (action.type === 'load') return { past: [], present: action.document, future: [] }
  if (action.type === 'undo') {
    const previous = history.past.at(-1)
    return previous ? { past: history.past.slice(0, -1), present: previous, future: [history.present, ...history.future] } : history
  }
  if (action.type === 'redo') {
    const next = history.future[0]
    return next ? { past: [...history.past, history.present], present: next, future: history.future.slice(1) } : history
  }
  const next = action.update(history.present)
  if (JSON.stringify(next) === JSON.stringify(history.present)) return history
  return { past: [...history.past.slice(-99), history.present], present: next, future: [] }
}

export function viewDocument(view: AnalysisView): EditorDocument {
  return { chart: view.chart, filters: view.filters, sourceIds: view.sourceIds, customSpec: view.customSpec ?? null }
}

export function saveDocument(view: AnalysisView, document: EditorDocument): AnalysisView {
  return { ...view, ...document, updatedAt: new Date().toISOString() }
}
