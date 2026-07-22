import { isTauri } from '@tauri-apps/api/core'

export async function waitForDesktopBridge() {
  if (!isTauri() || import.meta.env.DEV) return
  for (let attempt = 0; attempt < 40; attempt += 1) {
    try {
      const response = await fetch('http://127.0.0.1:8790/health')
      if (response.ok) return
    } catch { /* sidecar is still starting */ }
    await new Promise(resolve => window.setTimeout(resolve, 100))
  }
  throw new Error('GeminiDB Bridge sidecar 启动超时')
}
