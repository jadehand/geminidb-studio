import { encodeLineProtocolPoint, isLineProtocolError } from './line-protocol.mjs'
import { assertEnvironmentWritable } from './write-policy.mjs'

const DECIMAL_NANOSECONDS = /^-?\d+$/
const FIELD_TYPES = new Set(['integer', 'float', 'string', 'boolean'])

function updateError(message) {
  const error = new Error(message)
  error.code = 'MEASUREMENT_UPDATE_INVALID'
  error.status = 400
  return error
}

function schemaError() {
  const error = new Error('measurement schema is invalid')
  error.code = 'MEASUREMENT_SCHEMA_INVALID'
  error.status = 502
  return error
}

function objectEntries(value, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw updateError(`${label} must be an object`)
  return Object.entries(value)
}

function schemaDefinition(schema) {
  if (!schema || typeof schema !== 'object' || !Array.isArray(schema.tags) || !Array.isArray(schema.fields)) throw schemaError()
  const tags = new Set()
  for (const tag of schema.tags) {
    if (typeof tag !== 'string' || !tag || tags.has(tag)) throw schemaError()
    tags.add(tag)
  }
  const fields = new Map()
  for (const field of schema.fields) {
    if (!field || typeof field !== 'object' || typeof field.name !== 'string' || !field.name || !FIELD_TYPES.has(field.type) || fields.has(field.name)) throw schemaError()
    fields.set(field.name, field.type)
  }
  return { tags, fields }
}

function normalizedField(type, value, name) {
  if (value === null) throw updateError(`field ${name} cannot be null`)
  if (type === 'integer') {
    if (!Number.isSafeInteger(value)) throw updateError(`field ${name} must be a safe integer`)
  } else if (type === 'float') {
    if (typeof value !== 'number' || !Number.isFinite(value)) throw updateError(`field ${name} must be a finite number`)
  } else if (type === 'string') {
    if (typeof value !== 'string') throw updateError(`field ${name} must be a string`)
  } else if (typeof value !== 'boolean') {
    throw updateError(`field ${name} must be a boolean`)
  }
  return { type, value }
}

export function normalizePointUpdate(update, schema) {
  if (!update || typeof update !== 'object' || Array.isArray(update)) throw updateError('update must be an object')
  if (Object.hasOwn(update, 'measurement')) throw updateError('measurement must be specified by the request')
  if (typeof update.timestampNs !== 'string' || !DECIMAL_NANOSECONDS.test(update.timestampNs)) throw updateError('timestampNs must be a decimal string')

  const definition = schemaDefinition(schema)
  const tagEntries = objectEntries(update.tags, 'tags')
  if (tagEntries.length !== definition.tags.size || tagEntries.some(([name]) => !definition.tags.has(name))) {
    throw updateError('tags must include every schema tag exactly once')
  }
  const tags = {}
  for (const [name, value] of tagEntries) {
    if (typeof value !== 'string') throw updateError(`tag ${name} must be a string`)
    tags[name] = value
  }

  const fieldEntries = objectEntries(update.fields, 'fields')
  if (fieldEntries.length === 0) throw updateError('fields must contain at least one changed field')
  const fields = {}
  for (const [name, value] of fieldEntries) {
    const type = definition.fields.get(name)
    if (!type) throw updateError(`field ${name} is not defined by the measurement schema`)
    fields[name] = normalizedField(type, value, name)
  }

  return { timestampNs:update.timestampNs, tags, fields }
}

function requireContext(value, name) {
  if (typeof value !== 'string' || !value) throw updateError(`${name} must be a non-empty string`)
  return value
}

function requireUpdateId(update) {
  if (typeof update.id !== 'string' || !update.id) throw updateError('update id must be a non-empty string')
  return update.id
}

function encodeUpdatePoint(measurement, update) {
  try {
    return encodeLineProtocolPoint({
      measurement,
      tags:update.point.tags,
      fields:update.point.fields,
      timestamp:update.point.timestampNs,
      precision:'ns',
    })
  } catch (error) {
    if (isLineProtocolError(error)) throw updateError('point contains an invalid line protocol value')
    throw error
  }
}

export async function executeMeasurementUpdates({ session, database, measurement, updates, loadSchema, writePoint }) {
  assertEnvironmentWritable(session)
  const targetDatabase = requireContext(database, 'database')
  const targetMeasurement = requireContext(measurement, 'measurement')
  if (!Array.isArray(updates) || updates.length === 0) throw updateError('updates must be a non-empty array')
  if (typeof loadSchema !== 'function' || typeof writePoint !== 'function') throw new TypeError('loadSchema and writePoint are required')

  const schema = await loadSchema(targetDatabase, targetMeasurement)
  const prepared = updates.map((update, index) => {
    const point = normalizePointUpdate(update, schema)
    const id = requireUpdateId(update)
    return { id, index, point, line:encodeUpdatePoint(targetMeasurement, { point }) }
  })

  const succeededIds = []
  for (const update of prepared) {
    try {
      await writePoint(update.line)
      succeededIds.push(update.id)
    } catch (error) {
      return {
        summary:{ total:prepared.length, succeeded:succeededIds.length, failed:1, skipped:prepared.length - succeededIds.length - 1 },
        succeededIds,
        failed:{ id:update.id, index:update.index, message:'point write failed' },
      }
    }
  }

  return {
    summary:{ total:prepared.length, succeeded:prepared.length, failed:0, skipped:0 },
    succeededIds,
    failed:null,
  }
}

export function handleMeasurementUpdatesRequest({ session, body, getMeasurementSchema, influxWrite }) {
  return executeMeasurementUpdates({
    session,
    database:body?.database,
    measurement:body?.measurement,
    updates:body?.updates,
    loadSchema:(database, measurement) => getMeasurementSchema(session, database, measurement),
    writePoint:line => influxWrite(session, body?.database, line, { precision:'ns' }),
  })
}
