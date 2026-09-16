import { StrictMode, lazy, Suspense } from 'react'
import { createRoot } from 'react-dom/client'
import { AuthBoundary } from './AuthBoundary'
import './styles.css'
import './workbench.css'

// The app entry point does not export components.
// eslint-disable-next-line react-refresh/only-export-components
const App = import.meta.env.VITE_HEVAL_PUBLIC_DEMO === '1'
  ? lazy(() => import('./PublicApp'))
  : lazy(() => import('./App'))

createRoot(document.getElementById('root')!).render(
  <StrictMode><AuthBoundary>{auth => <Suspense fallback={<p>Loading Heval…</p>}><App auth={auth} /></Suspense>}</AuthBoundary></StrictMode>,
)
