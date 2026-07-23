export const DEFAULT_SIDEBAR_WIDTH = 340
export const MIN_SIDEBAR_WIDTH = 260
export const MAX_SIDEBAR_WIDTH = 620

export function clampSidebarWidth(value: number) {
  return Math.min(MAX_SIDEBAR_WIDTH, Math.max(MIN_SIDEBAR_WIDTH, Math.round(value)))
}
