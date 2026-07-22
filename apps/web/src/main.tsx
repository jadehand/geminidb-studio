import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import './styles.css'
import './sidebar-polish.css'
import './data-grid.css'
import './results-scroll.css'
import './query-editor.css'
import './editor-loading.css'
import { startDesktopBridge, stopDesktopBridge } from './desktop'

window.addEventListener('beforeunload', stopDesktopBridge)
startDesktopBridge().catch(error => console.error(error)).finally(() => {
  ReactDOM.createRoot(document.getElementById('root')!).render(
    <React.StrictMode><App /></React.StrictMode>
  )
})
