import { invoke, isTauri } from '@tauri-apps/api/core'
import { getCurrentWindow } from '@tauri-apps/api/window'
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

export async function currentExportDirectory(directory: string) {
  if (!isTauri()) return directory
  return invoke<string>('current_export_directory', { directory })
}

export async function writeExportFile(directory: string, filename: string, content: string) {
  if (!isTauri()) return null
  return invoke<string>('export_result_file', { directory, filename, content })
}

export type DesktopNote={path:string;content:string;modifiedMs:number}
export async function chooseNotesDirectory(){if(!isTauri())return null;const selected=await open({directory:true,multiple:false,title:'选择个人笔记 Markdown 目录'});return typeof selected==='string'?selected:null}
export async function authorizeNotesDirectory(directory:string){return isTauri()?invoke<string>('authorize_notes_directory',{directory}):null}
export async function listNotes(){return isTauri()?invoke<DesktopNote[]>('list_notes'):[]}
export async function writeNote(path:string,content:string){return isTauri()?invoke<string>('write_note',{path,content}):null}
export async function renameNote(path:string,newName:string){return isTauri()?invoke<string>('rename_note',{path,newName}):null}
export async function deleteNote(path:string){if(isTauri())await invoke('delete_note',{path})}

export async function registerDesktopCloseGuard(shouldGuard:() => boolean, onGuardedClose:() => void) {
  if (!isTauri()) return () => {}
  return getCurrentWindow().onCloseRequested(event => {
    event.preventDefault()
    if (shouldGuard()) onGuardedClose()
    else void destroyDesktopWindow()
  })
}

export async function destroyDesktopWindow() {
  if (isTauri()) await invoke('exit_app')
}
