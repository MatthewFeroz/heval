import { useCallback, useReducer, type SetStateAction } from 'react'
import { editorReducer, type EditorDocument } from '../project/editor'

export function useChartDocument(initial: EditorDocument) {
  const [history, dispatch] = useReducer(editorReducer, { past: [], present: initial, future: [] })
  const change = useCallback(<K extends keyof EditorDocument>(key: K, action: SetStateAction<EditorDocument[K]>) => {
    dispatch({ type: 'change', update: (current) => ({
      ...current,
      [key]: typeof action === 'function' ? (action as (value: EditorDocument[K]) => EditorDocument[K])(current[key]) : action,
    }) })
  }, [])
  const setState = useCallback((action: SetStateAction<EditorDocument['chart']>) => change('chart', action), [change])
  const setSourceIds = useCallback((action: SetStateAction<string[]>) => change('sourceIds', action), [change])
  const setOverride = useCallback((action: SetStateAction<string | null>) => change('customSpec', action), [change])
  const setDocumentFilters = useCallback((action: SetStateAction<EditorDocument['filters']>) => change('filters', action), [change])
  return { document: history.present, setState, setSourceIds, setOverride, setDocumentFilters,
    canUndo: history.past.length > 0, canRedo: history.future.length > 0,
    undo: () => dispatch({ type: 'undo' }), redo: () => dispatch({ type: 'redo' }),
    load: (document: EditorDocument) => dispatch({ type: 'load', document }),
  }
}
