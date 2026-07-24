import { invoke, isTauri } from '@tauri-apps/api/core'
import { open } from '@tauri-apps/plugin-dialog'

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

export async function chooseExportDirectory() {
  if (!isTauri()) return null
  const selected = await open({ directory: true, multiple: false, title: '选择查询结果导出目录' })
  return typeof selected === 'string' ? selected : null
}

export async function writeExportFile(directory: string, filename: string, content: string) {
  if (!isTauri()) return null
  return invoke<string>('export_result_file', { directory, filename, content })
}
