import { invoke, isTauri } from '@tauri-apps/api/core'

export type DesktopBridgeStatus = {
  running: boolean
  error: string | null
  logPath: string | null
}

const browserStatus: DesktopBridgeStatus = { running: true, error: null, logPath: null }

export async function getDesktopBridgeStatus() {
  return isTauri() ? invoke<DesktopBridgeStatus>('bridge_status') : browserStatus
}

export async function restartDesktopBridge() {
  return isTauri() ? invoke<DesktopBridgeStatus>('restart_bridge') : browserStatus
}
