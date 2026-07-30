import { conversionFromMilliseconds, formatBeijing } from './time-converter.ts'
import type { MeasurementDataWorkspaceTab, MeasurementSchema } from './types'

const NANOSECONDS_PER_SECOND = 1_000_000_000n
const NANOSECONDS_PER_DAY = 86_400n * NANOSECONDS_PER_SECOND
const BEIJING_OFFSET_SECONDS = 8 * 60 * 60
// Measurement day tables support ten-digit epoch seconds only (2001-09-09 onward).
// Asia/Shanghai has no DST after 1991, so this supported domain is fixed UTC+8.
const SUPPORTED_MEASUREMENT_EPOCH_START_SECONDS = 1_000_000_000n
const PAGE_SIZES = new Set([50, 100, 200, 500])
const beijingDateFormatter = new Intl.DateTimeFormat('en-US', {
  timeZone: 'Asia/Shanghai',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
})

export type MeasurementDay = {
  date: string
  startNs: string
  endNs: string
}

export type MeasurementDataOptions = {
  limit: 50 | 100 | 200 | 500
  offset: number
  startNs: string | null
  endNs: string | null
}

export type MeasurementDataOptionsInput = Partial<MeasurementDataOptions> & {
  day?: MeasurementDay | null
}

export type MeasurementPoint = {
  id: string
  measurement: string
  timestampNs: string
  time: string
  tags: Record<string, string>
  fields: Record<string, string | number | boolean | null>
}

export type MeasurementDataPage = {
  schema: MeasurementSchema
  points: MeasurementPoint[]
  page: { limit: number; offset: number; hasMore: boolean }
}

export type ReadyConnectionSession = {
  connectionId: string
  generation: number
  environment: 'prod' | 'test' | 'dev'
}

export type MeasurementDataResult = {
  requestKey: string
  page: MeasurementDataPage
}

export type MeasurementTimeDisplay = 'timestamp' | 'utc' | 'beijing'

export function measurementPointMatchesSearch(point: MeasurementPoint, query: string) {
  const needle = query.trim().toLocaleLowerCase()
  if (!needle) return true
  const values = [
    point.time,
    ...Object.entries(point.tags).flat(),
    ...Object.entries(point.fields).flatMap(([name, value]) => [name, value === null ? '' : String(value)]),
  ]
  return values.some(value => value.toLocaleLowerCase().includes(needle))
}

export function measurementDataRequestKey(
  tab: Pick<MeasurementDataWorkspaceTab, 'connectionId' | 'database' | 'measurement'>,
  readySession: ReadyConnectionSession | null,
  currentDatabase: string,
) {
  if (
    !readySession
    || readySession.connectionId !== tab.connectionId
    || currentDatabase !== tab.database
    || !Number.isSafeInteger(readySession.generation)
    || readySession.generation < 0
  ) return null
  return JSON.stringify([readySession.connectionId, readySession.generation, tab.database, tab.measurement])
}

export function measurementDataPageForRequest(result: MeasurementDataResult | null, requestKey: string | null) {
  if (!result || !requestKey || result.requestKey !== requestKey) return null
  return result.page
}

export function measurementNanosecondsToBeijing(value: unknown) {
  if (typeof value !== 'string' || !/^\d+$/.test(value)) return null
  try {
    const milliseconds = BigInt(value) / 1_000_000n
    if (milliseconds > BigInt(Number.MAX_SAFE_INTEGER)) return null
    return conversionFromMilliseconds(Number(milliseconds))?.beijing ?? null
  } catch {
    return null
  }
}

export function formatMeasurementTime(value: unknown, display: MeasurementTimeDisplay) {
  if (typeof value !== 'string' || !/^\d+$/.test(value)) return String(value ?? '')
  if (display === 'timestamp') return value
  try {
    const nanoseconds = BigInt(value)
    const seconds = nanoseconds / NANOSECONDS_PER_SECOND
    const fraction = (nanoseconds % NANOSECONDS_PER_SECOND).toString().padStart(9, '0')
    const date = new Date(Number(seconds * 1_000n))
    if (Number.isNaN(date.getTime())) return value
    if (display === 'utc') return `${date.toISOString().slice(0, 19).replace('T', ' ')}.${fraction} UTC`
    return `${formatBeijing(date)}.${fraction} UTC+8`
  } catch {
    return value
  }
}

export function nextMeasurementOffset(displayedPage: MeasurementDataPage['page'] | null, direction: -1 | 1) {
  if (!displayedPage) return 0
  return Math.max(0, displayedPage.offset + direction * displayedPage.limit)
}

function dayParts(timestampMs: number) {
  const values = Object.fromEntries(
    beijingDateFormatter.formatToParts(new Date(timestampMs))
      .filter(part => part.type !== 'literal')
      .map(part => [part.type, part.value]),
  )
  return { year: Number(values.year), month: Number(values.month), day: Number(values.day) }
}

function nanoseconds(value: unknown, name: string) {
  if (typeof value !== 'string' || !/^\d+$/.test(value)) throw new TypeError(`${name} must be a decimal nanosecond string`)
  return BigInt(value)
}

function beijingTimeNanoseconds(value: string) {
  const match = value.match(/^(\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,9}))?)?$/)
  if (!match) throw new RangeError('time must use HH:mm, HH:mm:ss, or HH:mm:ss.nnnnnnnnn')
  const [, hours, minutes, seconds = '0', fractional = ''] = match
  const hour = Number(hours)
  const minute = Number(minutes)
  const second = Number(seconds)
  if (hour > 23 || minute > 59 || second > 59) throw new RangeError('time must be within one Beijing natural day')
  return BigInt(hour * 3_600 + minute * 60 + second) * NANOSECONDS_PER_SECOND
    + BigInt(fractional.padEnd(9, '0'))
}

export function measurementDay(measurement: string): MeasurementDay | null {
  const suffix = measurement.match(/_(\d{10})$/)?.[1]
  if (!suffix) return null

  const timestampSeconds = BigInt(suffix)
  if (timestampSeconds < SUPPORTED_MEASUREMENT_EPOCH_START_SECONDS) return null
  const timestampMs = Number(timestampSeconds * 1_000n)
  const { year, month, day } = dayParts(timestampMs)
  const startSeconds = BigInt(Date.UTC(year, month - 1, day) / 1_000 - BEIJING_OFFSET_SECONDS)
  const startNs = startSeconds * NANOSECONDS_PER_SECOND

  return {
    date: `${year.toString().padStart(4, '0')}-${month.toString().padStart(2, '0')}-${day.toString().padStart(2, '0')}`,
    startNs: startNs.toString(),
    endNs: (startNs + NANOSECONDS_PER_DAY - 1n).toString(),
  }
}

export function normalizeMeasurementDataOptions(input: MeasurementDataOptionsInput = {}): MeasurementDataOptions {
  const limit = input.limit ?? 50
  if (!PAGE_SIZES.has(limit)) throw new RangeError('limit must be one of 50, 100, 200, or 500')

  const offset = input.offset ?? 0
  if (!Number.isSafeInteger(offset) || offset < 0) throw new RangeError('offset must be a non-negative integer')

  let startNs = input.startNs ?? null
  let endNs = input.endNs ?? null
  if (startNs === null && endNs === null && input.day) {
    startNs = input.day.startNs
    endNs = input.day.endNs
  }
  if (startNs === null && endNs === null) return { limit, offset, startNs, endNs }
  if (startNs === null || endNs === null) throw new RangeError('custom ranges require both startNs and endNs')

  const start = nanoseconds(startNs, 'startNs')
  const end = nanoseconds(endNs, 'endNs')
  if (start > end) throw new RangeError('startNs must be less than or equal to endNs')

  const day = input.day
  if (!day) throw new RangeError('custom ranges require a selected day')
  const dayStart = nanoseconds(day.startNs, 'selected day startNs')
  const dayEnd = nanoseconds(day.endNs, 'selected day endNs')
  if (start < dayStart || end > dayEnd) throw new RangeError('custom range must stay within the selected day')

  return { limit, offset, startNs: start.toString(), endNs: end.toString() }
}

/** Converts Asia/Shanghai wall-clock inputs to inclusive bounds within the selected natural day. */
export function measurementRangeFromBeijingTime(day: MeasurementDay | null, startTime: string, endTime: string) {
  if (!day) throw new RangeError('custom ranges require a selected day')
  const dayStart = nanoseconds(day.startNs, 'selected day startNs')
  const startNs = (dayStart + beijingTimeNanoseconds(startTime)).toString()
  const endNs = (dayStart + beijingTimeNanoseconds(endTime)).toString()
  const options = normalizeMeasurementDataOptions({ day, startNs, endNs })
  return { startNs: options.startNs!, endNs: options.endNs! }
}
