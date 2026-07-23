import { conversionFromMilliseconds } from './time-converter.ts'

export type TimeHoverMatch = {
  startColumn: number
  endColumn: number
  beijing: string
}

const RFC3339_PATTERN = /(['"])(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,9})?)?(?:Z|[+-]\d{2}:\d{2}))\1/g
const TIME_COMPARISON_PATTERN = /\btime\s*(?:>=|<=|=|>|<)\s*(-?\d{10,13})(s|ms)?\b/gi

function timestampMilliseconds(value: string, unit: string | undefined) {
  const numeric = Number(value)
  if (!Number.isFinite(numeric)) return null
  if (unit?.toLowerCase() === 's') return numeric * 1000
  if (unit?.toLowerCase() === 'ms') return numeric
  return value.replace('-', '').length <= 10 ? numeric * 1000 : numeric
}

function isValidRfc3339(value: string) {
  const match = value.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2})(?:\.\d{1,9})?)?(?:Z|([+-])(\d{2}):(\d{2}))$/)
  if (!match) return false
  const [, year, month, day, hour, minute, second = '0', , offsetHour = '0', offsetMinute = '0'] = match
  const y = Number(year)
  const mo = Number(month)
  const d = Number(day)
  return mo >= 1 && mo <= 12
    && d >= 1 && d <= new Date(Date.UTC(y, mo, 0)).getUTCDate()
    && Number(hour) <= 23
    && Number(minute) <= 59
    && Number(second) <= 59
    && Number(offsetHour) <= 23
    && Number(offsetMinute) <= 59
}

function matchAtColumn(
  line: string,
  column: number,
  pattern: RegExp,
  valueGroup: number,
  toMilliseconds: (match: RegExpExecArray) => number | null,
) {
  pattern.lastIndex = 0
  let match: RegExpExecArray | null
  while ((match = pattern.exec(line))) {
    const value = match[valueGroup]
    const valueOffset = match.index + match[0].indexOf(value)
    const startColumn = valueOffset + 1
    const endColumn = startColumn + value.length
    if (column < startColumn || column > endColumn) continue
    const milliseconds = toMilliseconds(match)
    const conversion = milliseconds === null ? null : conversionFromMilliseconds(milliseconds)
    if (!conversion) return null
    return { startColumn, endColumn, beijing:conversion.beijing } satisfies TimeHoverMatch
  }
  return null
}

export function findTimeHover(line: string, column: number): TimeHoverMatch | null {
  const dateTime = matchAtColumn(line, column, RFC3339_PATTERN, 2, match => {
    if (!isValidRfc3339(match[2])) return null
    const milliseconds = Date.parse(match[2])
    return Number.isNaN(milliseconds) ? null : milliseconds
  })
  if (dateTime) return dateTime
  return matchAtColumn(
    line,
    column,
    TIME_COMPARISON_PATTERN,
    1,
    match => timestampMilliseconds(match[1], match[2]),
  )
}
