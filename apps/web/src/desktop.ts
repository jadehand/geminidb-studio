import { isTauri } from '@tauri-apps/api/core'
import { Command, type Child } from '@tauri-apps/plugin-shell'

let bridge: Child | null = null

export async function startDesktopBridge() {
  if (!isTauri() || import.meta.env.DEV) return
  const command = Command.sidecar('binaries/geminidb-bridge')
  command.stderr.on('data', line => console.error(`[Bridge] ${line}`))
  bridge = await command.spawn()
  for (let attempt = 0; attempt < 40; attempt += 1) {
    try {
      const response = await fetch('http://127.0.0.1:8790/health')
      if (response.ok) return
    } catch { /* sidecar is still starting */ }
    await new Promise(resolve => window.setTimeout(resolve, 100))
  }
  throw new Error('GeminiDB Bridge sidecar 启动超时')
}

export function stopDesktopBridge() {
  if (bridge) void bridge.kill()
  bridge = null
}
