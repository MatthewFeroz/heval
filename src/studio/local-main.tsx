import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './studio.css'

// This entry is intentionally absent from the production build inputs.
// Local files and publishing work without an account; hosted Studio still signs in.
const root = document.getElementById('root')!
if (import.meta.env.DEV && ['localhost', '127.0.0.1', '[::1]'].includes(location.hostname)) {
  void import('./Studio').then(({ Studio }) => {
    createRoot(root).render(<StrictMode><Studio /></StrictMode>)
  })
} else {
  root.textContent = 'Open the local editor with bun run studio:local, or use /studio to sign in.'
}
