import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import { applyLang } from './i18n'
import App from './App.tsx'

applyLang()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
