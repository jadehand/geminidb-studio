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
