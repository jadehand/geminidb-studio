export const DEFAULT_CLAUDE_DRAWER_WIDTH=760
export const MIN_CLAUDE_DRAWER_WIDTH=520
export const CLAUDE_DRAWER_VIEWPORT_GAP=96

export function fitClaudeDrawerWidth(value:number,viewportWidth:number) {
  const available=Math.max(0,Math.floor(viewportWidth))
  if(available<=760)return available
  const maximum=Math.max(MIN_CLAUDE_DRAWER_WIDTH,available-CLAUDE_DRAWER_VIEWPORT_GAP)
  return Math.min(maximum,Math.max(MIN_CLAUDE_DRAWER_WIDTH,Math.round(value)))
}
