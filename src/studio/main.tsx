import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { AuthBoundary } from '../AuthBoundary'
import { StudioRoute } from './StudioRoute'
import './studio.css'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <AuthBoundary>{() => <StudioRoute />}</AuthBoundary>
  </StrictMode>,
)
