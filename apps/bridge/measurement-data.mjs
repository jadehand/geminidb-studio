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

function fetchLimit(offset, limit) {
  const value = offset + limit + 1
  if (!Number.isSafeInteger(value)) throw new RangeError('fetch limit must be a safe integer')
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
  const perSeriesLimit = fetchLimit(pageStart, pageSize)
  if (startNs === null && endNs === null) return `SELECT * FROM ${quoteIdentifier(name)} ORDER BY time DESC LIMIT ${perSeriesLimit} OFFSET 0`
  if (startNs === null || endNs === null) throw new RangeError('startNs and endNs must be supplied together')
  const start = nanoseconds(startNs, 'startNs')
  const end = nanoseconds(endNs, 'endNs')
  if (start > end) throw new RangeError('startNs must be less than or equal to endNs')
  return `SELECT * FROM ${quoteIdentifier(name)} WHERE time >= ${startNs}ns AND time <= ${endNs}ns ORDER BY time DESC LIMIT ${perSeriesLimit} OFFSET 0`
}

function parameterOnce(searchParams, name, { required = false, defaultValue = null } = {}) {
  const values = searchParams.getAll(name)
  if (values.length > 1) throw new RangeError(`${name} must appear at most once`)
  if (!values.length) {
    if (required) throw new RangeError(`${name} is required`)
    return defaultValue
  }
  return values[0]
}

function decimalInteger(value, name) {
  if (typeof value !== 'string' || !DECIMAL_NANOSECONDS.test(value)) throw new TypeError(`${name} must be a decimal integer`)
  const number = Number(value)
  if (!Number.isSafeInteger(number)) throw new RangeError(`${name} must be a safe integer`)
  return number
}

export function parseMeasurementDataOptions(searchParams) {
  const database = parameterOnce(searchParams, 'database', { required:true })
  const measurement = parameterOnce(searchParams, 'measurement', { required:true })
  const limit = pageLimit(decimalInteger(parameterOnce(searchParams, 'limit', { defaultValue:'50' }), 'limit'))
  const offset = pageOffset(decimalInteger(parameterOnce(searchParams, 'offset', { defaultValue:'0' }), 'offset'))
  const startNs = parameterOnce(searchParams, 'startNs')
  const endNs = parameterOnce(searchParams, 'endNs')
  if (!database || !measurement) throw new RangeError('database and measurement are required')
  if (startNs !== null) nanoseconds(startNs, 'startNs')
  if (endNs !== null) nanoseconds(endNs, 'endNs')
  return { database, measurement, limit, offset, startNs, endNs }
}

function canonicalIdentity(values) {
  return JSON.stringify(Object.entries(values)
    .sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0)
    .map(([key, value]) => [key, value === null ? 'null' : typeof value, value]))
}

export function flattenMeasurementSeries({ measurement, schema, series, limit, offset = 0 }) {
  const name = measurementIdentifier(measurement)
  const pageSize = resultLimit(limit)
  const pageStart = pageOffset(offset)
  const pageEnd = fetchLimit(pageStart, pageSize) - 1
  const points = []
  for (const [seriesIndex, item] of (series || []).entries()) {
    const columns = Array.isArray(item.columns) ? item.columns : []
    for (const [valueIndex, values] of (item.values || []).entries()) {
      const row = Object.fromEntries(columns.map((column, index) => [column, values[index]]))
      const timestampNs = row.time
      if (typeof timestampNs !== 'string') throw new TypeError('Influx nanosecond timestamps must be strings')
      const tags = Object.fromEntries(Object.entries(item.tags || {}).map(([key, value]) => [key, String(value)]))
      for (const tag of schema.tags || []) if (!Object.hasOwn(tags, tag) && row[tag] !== undefined && row[tag] !== null) tags[tag] = String(row[tag])
      const fields = Object.fromEntries((schema.fields || []).map(field => [field.name, row[field.name] ?? null]))
      const sortTags = canonicalIdentity(tags)
      const sortFields = canonicalIdentity(fields)
      points.push({
        id:`${name}\u0000${timestampNs}\u0000${sortTags}\u0000${sortFields}`,
        measurement:name,
        timestampNs,
        time:timestampNs,
        tags,
        fields,
        sortTimestamp:nanoseconds(timestampNs, 'time'),
        sortMeasurement:name,
        sortTags,
        sortFields,
      })
    }
  }
  points.sort((left, right) => {
    if (left.sortTimestamp !== right.sortTimestamp) return left.sortTimestamp > right.sortTimestamp ? -1 : 1
    if (left.sortMeasurement !== right.sortMeasurement) return left.sortMeasurement < right.sortMeasurement ? -1 : 1
    if (left.sortTags !== right.sortTags) return left.sortTags < right.sortTags ? -1 : 1
    if (left.sortFields !== right.sortFields) return left.sortFields < right.sortFields ? -1 : 1
    return 0
  })
  return {
    points:points.slice(pageStart, pageEnd).map(({ sortTimestamp, sortMeasurement, sortTags, sortFields, ...point }) => point),
    hasMore:points.length > pageEnd,
  }
}
