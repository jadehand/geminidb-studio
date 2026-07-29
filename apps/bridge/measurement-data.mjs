const PAGE_SIZES = new Set([50, 100, 200, 500])
const DECIMAL_NANOSECONDS = /^(?:0|[1-9]\d*)$/

function quoteIdentifier(value) {
  return `"${value.replaceAll('\\', '\\\\').replaceAll('"', '\\"')}"`
}

function measurementIdentifier(value) {
  if (typeof value !== 'string' || !value || value.length > 512 || /[\u0000\r\n]/.test(value)) throw new TypeError('measurement must be a non-empty identifier')
  return value
}

function pageLimit(value) {
  if (!Number.isSafeInteger(value) || !PAGE_SIZES.has(value)) throw new RangeError('limit must be one of 50, 100, 200, or 500')
  return value
}

function pageOffset(value) {
  if (!Number.isSafeInteger(value) || value < 0) throw new RangeError('offset must be a non-negative safe integer')
  return value
}

function resultLimit(value) {
  if (!Number.isSafeInteger(value) || value < 1) throw new RangeError('limit must be a positive safe integer')
  return value
}

function nanoseconds(value, name) {
  if (typeof value !== 'string' || !DECIMAL_NANOSECONDS.test(value)) throw new TypeError(`${name} must be a decimal nanosecond string`)
  return BigInt(value)
}

export function buildMeasurementDataQuery({ measurement, limit, offset, startNs, endNs }) {
  const name = measurementIdentifier(measurement)
  const pageSize = pageLimit(limit)
  const pageStart = pageOffset(offset)
  if (startNs === null && endNs === null) return `SELECT * FROM ${quoteIdentifier(name)} ORDER BY time DESC LIMIT ${pageSize + 1} OFFSET ${pageStart}`
  if (startNs === null || endNs === null) throw new RangeError('startNs and endNs must be supplied together')
  const start = nanoseconds(startNs, 'startNs')
  const end = nanoseconds(endNs, 'endNs')
  if (start > end) throw new RangeError('startNs must be less than or equal to endNs')
  return `SELECT * FROM ${quoteIdentifier(name)} WHERE time >= ${startNs}ns AND time <= ${endNs}ns ORDER BY time DESC LIMIT ${pageSize + 1} OFFSET ${pageStart}`
}

export function flattenMeasurementSeries({ measurement, schema, series, limit }) {
  const name = measurementIdentifier(measurement)
  const pageSize = resultLimit(limit)
  const points = []
  for (const [seriesIndex, item] of (series || []).entries()) {
    const columns = Array.isArray(item.columns) ? item.columns : []
    for (const [valueIndex, values] of (item.values || []).entries()) {
      const row = Object.fromEntries(columns.map((column, index) => [column, values[index]]))
      const timestampNs = row.time
      if (typeof timestampNs !== 'string') throw new TypeError('Influx nanosecond timestamps must be strings')
      const tags = Object.fromEntries(Object.entries(item.tags || {}).map(([key, value]) => [key, String(value)]))
      for (const tag of schema.tags || []) if (row[tag] !== undefined && row[tag] !== null) tags[tag] = String(row[tag])
      const fields = Object.fromEntries((schema.fields || []).map(field => [field.name, row[field.name] ?? null]))
      points.push({
        id:`${name}:${seriesIndex}:${valueIndex}`,
        measurement:name,
        timestampNs,
        time:timestampNs,
        tags,
        fields,
      })
    }
  }
  return { points:points.slice(0, pageSize), hasMore:points.length > pageSize }
}
