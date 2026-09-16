import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { Studio } from '../../../src/studio/Studio'
import '../../../src/studio/studio.css'

createRoot(document.getElementById('root')!).render(
  <StrictMode><Studio localViewer /></StrictMode>,
)
