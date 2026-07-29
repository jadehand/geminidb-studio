import { useSyncExternalStore } from 'react'

export const GRID_ZOOM_STORAGE_KEY = 'gdb.resultGridZoom'
export const DEFAULT_GRID_ZOOM = 100
export const MIN_GRID_ZOOM = 80
export const MAX_GRID_ZOOM = 160

export function normalizeGridZoom(value: unknown) {
  const numeric = Number(value)
  if (!Number.isFinite(numeric)) return DEFAULT_GRID_ZOOM
  return Math.max(MIN_GRID_ZOOM, Math.min(MAX_GRID_ZOOM, Math.round(numeric / 10) * 10))
}

export function stepGridZoom(current: number, direction: -1 | 1) {
  return normalizeGridZoom(current + direction * 10)
}

function persistedGridZoom() {
  try { return normalizeGridZoom(globalThis.localStorage?.getItem(GRID_ZOOM_STORAGE_KEY) ?? DEFAULT_GRID_ZOOM) } catch { return DEFAULT_GRID_ZOOM }
}

let gridZoom = persistedGridZoom()
const gridZoomListeners = new Set<() => void>()

export function getGridZoomSnapshot() { return gridZoom }
export function subscribeGridZoom(listener: () => void) { gridZoomListeners.add(listener); return () => gridZoomListeners.delete(listener) }
export function setGridZoom(value: number | ((current: number) => number)) {
  const next = normalizeGridZoom(typeof value === 'function' ? value(gridZoom) : value)
  if (next === gridZoom) return
  gridZoom = next
  try { globalThis.localStorage?.setItem(GRID_ZOOM_STORAGE_KEY, String(next)) } catch { /* storage is optional */ }
  gridZoomListeners.forEach(listener => listener())
}

export function useGridZoom() {
  const zoom = useSyncExternalStore(subscribeGridZoom, getGridZoomSnapshot, getGridZoomSnapshot)
  return [zoom, setGridZoom] as const
}
