import { invoke, isTauri } from '@tauri-apps/api/core'

export async function saveCredential(id: string, password: string) {
  if (!password) return
  if (isTauri()) await invoke('save_credential', { id, password })
  else sessionStorage.setItem(`gdb.password.${id}`, password)
}

export async function loadCredential(id: string) {
  if (isTauri()) return invoke<string | null>('load_credential', { id })
  return sessionStorage.getItem(`gdb.password.${id}`)
}

export async function deleteCredential(id: string) {
  if (isTauri()) await invoke('delete_credential', { id })
  else sessionStorage.removeItem(`gdb.password.${id}`)
}
