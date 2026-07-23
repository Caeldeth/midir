import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import './assets/main.css'

// Send a renderer failure to the log the main process writes. A packaged build
// has no console in either process, so without this a crash here leaves no
// trace. The listeners are set before the first render, so a failure during
// boot is caught as well.
window.addEventListener('error', (event) => {
  void window.api?.diagnostics?.report({
    source: 'window',
    message: event.message,
    stack: event.error instanceof Error ? (event.error.stack ?? '') : ''
  })
})

window.addEventListener('unhandledrejection', (event) => {
  const reason: unknown = event.reason
  void window.api?.diagnostics?.report({
    source: 'promise',
    message: reason instanceof Error ? reason.message : String(reason),
    stack: reason instanceof Error ? (reason.stack ?? '') : ''
  })
})

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
)
