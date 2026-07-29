import type { MeasurementSchema } from './types'

const NANOSECONDS_PER_SECOND = 1_000_000_000n
const NANOSECONDS_PER_DAY = 86_400n * NANOSECONDS_PER_SECOND
const BEIJING_OFFSET_SECONDS = 8 * 60 * 60
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

function dayParts(timestampMs: number) {
  const values = Object.fromEntries(
    beijingDateFormatter.formatToParts(new Date(timestampMs))
      .filter(part => part.type !== 'literal')
      .map(part => [part.type, part.value]),
  )
  return { year: Number(values.year), month: Number(values.month), day: Number(values.day) }
}

function nanoseconds(value: string, name: string) {
  if (!/^\d+$/.test(value)) throw new TypeError(`${name} must be a decimal nanosecond string`)
  return BigInt(value)
}

export function measurementDay(measurement: string): MeasurementDay | null {
  const suffix = measurement.match(/_(\d{10})$/)?.[1]
  if (!suffix) return null

  const timestampSeconds = BigInt(suffix)
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

  const startNs = input.startNs ?? null
  const endNs = input.endNs ?? null
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
