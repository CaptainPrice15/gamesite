import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import { initAnalytics } from './lib/analytics'
import { initMonitoring } from './lib/monitoring'
import './styles/global.css'

const container = document.getElementById('root')
if (!container) throw new Error('root element missing')

initAnalytics()
void initMonitoring()

createRoot(container).render(
  <StrictMode>
    <App />
  </StrictMode>,
)

const warnServiceWorker = () => console.warn('service worker registration failed')

if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    try {
      navigator.serviceWorker.register('/sw.js').catch(warnServiceWorker)
    } catch {
      warnServiceWorker()
    }
  })
}
