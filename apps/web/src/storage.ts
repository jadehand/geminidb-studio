export function load<T>(key: string, fallback: T): T {
  try { return JSON.parse(localStorage.getItem(key) || '') as T } catch { return fallback }
}
export function save<T>(key: string, value: T) { localStorage.setItem(key, JSON.stringify(value)) }
