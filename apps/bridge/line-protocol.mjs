function lineProtocolError(message) {
  const error = new Error(`LINE_PROTOCOL_INVALID: ${message}`)
  error.code = 'LINE_PROTOCOL_INVALID'
  return error
}

function requireSafeInteger(value, label) {
  if (!Number.isSafeInteger(value)) throw lineProtocolError(`${label} must be a safe integer`)
  return value
}

function requireFiniteNumber(value, label) {
  if (typeof value !== 'number' || !Number.isFinite(value)) throw lineProtocolError(`${label} must be finite`)
  return value
}

function assertFieldValue(type, value, label) {
  if (type === 'float') return requireFiniteNumber(value, label)
  if (type === 'integer') return requireSafeInteger(value, label)
  if (type === 'string') {
    if (typeof value !== 'string') throw lineProtocolError(`${label} must be a string`)
    return value
  }
  if (type === 'boolean') {
    if (typeof value !== 'boolean') throw lineProtocolError(`${label} must be a boolean`)
    return value
  }
  throw lineProtocolError(`unsupported field type ${type}`)
}

function rejectLineBreaks(value, label) {
  const stringValue = String(value)
  if (/[\r\n]/.test(stringValue)) throw lineProtocolError(`${label} cannot contain CR/LF`)
  return stringValue
}

function escapeIdentifier(value, label) {
  return rejectLineBreaks(value, label).replace(/([ ,=])/g, '\\$1')
}

function escapeString(value, label) {
  return rejectLineBreaks(value, label).replace(/([\\"])/g, '\\$1')
}

function normalizeObjectEntries(value, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw lineProtocolError(`${label} must be an object`)
  return Object.entries(value)
}

function encodeTimestamp(timestamp, precision) {
  if (precision === 'ms') return String(requireSafeInteger(timestamp, 'timestamp'))
  if (precision === 'ns') {
    if (typeof timestamp !== 'string' || !/^-?\d+$/.test(timestamp)) {
      throw lineProtocolError('nanosecond timestamp must be a decimal string')
    }
    return timestamp
  }
  throw lineProtocolError('precision must be ms or ns')
}

export function encodeLineProtocolPoint(point) {
  if (!point || typeof point !== 'object') throw lineProtocolError('point is required')
  if (typeof point.measurement !== 'string' || !point.measurement) throw lineProtocolError('measurement is required')
  const timestamp = encodeTimestamp(point.timestamp, point.precision)
  const tags = normalizeObjectEntries(point.tags ?? {}, 'tags').map(([key, value]) => `${escapeIdentifier(key, 'tag key')}=${escapeIdentifier(value, 'tag value')}`)
  const fields = normalizeObjectEntries(point.fields, 'fields').map(([key, field]) => {
    if (!field || typeof field !== 'object') throw lineProtocolError(`field ${key} is invalid`)
    const value = assertFieldValue(field.type, field.value, `field ${key}`)
    if (field.type === 'integer') return `${escapeIdentifier(key, 'field key')}=${value}i`
    if (field.type === 'boolean') return `${escapeIdentifier(key, 'field key')}=${value}`
    if (field.type === 'string') return `${escapeIdentifier(key, 'field key')}="${escapeString(value, 'string field value')}"`
    return `${escapeIdentifier(key, 'field key')}=${value}`
  })
  if (fields.length === 0) throw lineProtocolError('point requires at least one field')
  return `${escapeIdentifier(point.measurement, 'measurement')}${tags.length ? `,${tags.join(',')}` : ''} ${fields.join(',')} ${timestamp}`
}
