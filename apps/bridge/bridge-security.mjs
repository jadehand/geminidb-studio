const ALLOWED_ORIGINS = new Set([
  'tauri://localhost',
  'http://tauri.localhost',
  'https://tauri.localhost',
  'http://127.0.0.1:8791',
  'http://localhost:8791',
])

export function isAllowedBridgeOrigin(origin) {
  return !origin || ALLOWED_ORIGINS.has(origin)
}
