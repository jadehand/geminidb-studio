export type DateTimeZone = 'beijing' | 'utc'

export type TimeConversion = {
  beijing: string
  utc: string
  unixSeconds: string
  unixMilliseconds: string
  influxQL: string
}

const DATE_TIME_PATTERN = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})(?::(\d{2}))?$/

export function formatBeijing(date: Date) {
  return new Intl.DateTimeFormat('sv-SE', {
    timeZone:'Asia/Shanghai',
    year:'numeric',
    month:'2-digit',
    day:'2-digit',
    hour:'2-digit',
    minute:'2-digit',
    second:'2-digit',
    hourCycle:'h23',
  }).format(date)
}

export function formatUtcInput(date: Date) {
  return date.toISOString().slice(0, 19).replace('T', ' ')
}

export function conversionFromMilliseconds(milliseconds: number): TimeConversion | null {
  const date = new Date(milliseconds)
  if (!Number.isFinite(milliseconds) || Number.isNaN(date.getTime())) return null
  const utc = date.toISOString().replace('.000Z', 'Z')
  return {
    beijing:formatBeijing(date),
    utc,
    unixSeconds:String(Math.floor(milliseconds / 1000)),
    unixMilliseconds:String(Math.trunc(milliseconds)),
    influxQL:`'${utc}'`,
  }
}

export function parseUnixTimestamp(value: string): number | null {
  const normalized = value.trim()
  if (!/^-?\d+$/.test(normalized)) return null
  const digits = normalized.replace('-', '').length
  const numeric = Number(normalized)
  if (!Number.isFinite(numeric)) return null
  if (digits <= 10) return numeric * 1000
  if (digits <= 13) return numeric
  if (digits <= 16) return Math.trunc(numeric / 1000)
  if (digits <= 19) return Math.trunc(numeric / 1_000_000)
  return null
}

export function parseDateTime(value: string, zone: DateTimeZone): number | null {
  const match = value.trim().match(DATE_TIME_PATTERN)
  if (!match) return null
  const [, year, month, day, hour, minute, second = '0'] = match
  const parts = [year, month, day, hour, minute, second].map(Number)
  const [y, mo, d, h, mi, s] = parts
  if (mo < 1 || mo > 12 || d < 1 || d > 31 || h > 23 || mi > 59 || s > 59) return null
  const utcMilliseconds = Date.UTC(y, mo - 1, d, h - (zone === 'beijing' ? 8 : 0), mi, s)
  const check = new Date(utcMilliseconds + (zone === 'beijing' ? 8 * 3600_000 : 0))
  if (
    check.getUTCFullYear() !== y ||
    check.getUTCMonth() !== mo - 1 ||
    check.getUTCDate() !== d ||
    check.getUTCHours() !== h ||
    check.getUTCMinutes() !== mi ||
    check.getUTCSeconds() !== s
  ) return null
  return utcMilliseconds
}
