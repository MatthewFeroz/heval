import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { AuthBoundary } from '../AuthBoundary'
import { Studio } from './Studio'
import './studio.css'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <AuthBoundary>{auth => <Studio key={auth.user?.email || 'public'} />}</AuthBoundary>
  </StrictMode>,
)
