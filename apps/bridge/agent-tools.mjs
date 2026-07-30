import { AgentError, AGENT_LIMITS } from './agent-types.mjs'
import { assertQuerySql, assertToolEnvironment, redactSensitive } from './agent-policy.mjs'

const rules = [
  ['list_databases', {}, []],
  ['list_measurements', { filter:{ type:'string', minLength:1, maxLength:1_000 } }, []],
  ['get_schema', { measurement:{ type:'string', minLength:1, maxLength:1_000 } }, ['measurement']],
  ['query_influxql', { sql:{ type:'string', minLength:1, maxLength:100_000 } }, ['sql']],
  ['verify_data', { sql:{ type:'string', minLength:1, maxLength:100_000 } }, ['sql']],
  ['write_points', {
    lines:{ type:'array', minItems:1, maxItems:AGENT_LIMITS.maxDirectWritePoints, items:{ type:'string', minLength:1 } },
  }, ['lines']],
  ['preview_bulk_data', {
    prefix:{ type:'string', minLength:1, maxLength:1_000 },
    sourceMeasurement:{ type:'string', minLength:1, maxLength:1_000 },
    dates:{ type:'array', minItems:1, maxItems:30, items:{ type:'string', minLength:1, maxLength:10 } },
    startTime:{ type:'string', minLength:1, maxLength:8 },
    endTime:{ type:'string', minLength:1, maxLength:8 },
    intervalSeconds:{ type:'number' },
    tags:{ type:'array' },
    fields:{ type:'array' },
    constraints:{ type:'array' },
  }, ['prefix', 'sourceMeasurement', 'dates', 'startTime', 'endTime', 'intervalSeconds', 'tags', 'fields', 'constraints']],
  ['create_bulk_job', {
    previewId:{ type:'string', minLength:1, maxLength:1_000 },
  }, ['previewId']],
  ['get_bulk_job', {
    jobId:{ type:'string', minLength:1, maxLength:1_000 },
  }, ['jobId']],
]

const descriptions = {
  list_databases:'List Databases visible to the current connection.',
  list_measurements:'List Measurements in the session-bound Database.',
  get_schema:'Get Field and Tag schema for a Measurement in the session-bound Database.',
  query_influxql:'Execute one read-only InfluxQL statement in the session-bound Database.',
  verify_data:'Run one read-only verification query in the session-bound Database.',
  write_points:'Write up to 1000 Line Protocol points to the session-bound Database and Retention Policy.',
  preview_bulk_data:'Preview a bulk data plan using the session-bound Database and Retention Policy.',
  create_bulk_job:'Start the bulk job produced by this run and accept its server-required acknowledgements.',
  get_bulk_job:'Get a bulk job owned by the current connection.',
}

function deepFreeze(value) {
  Object.freeze(value)
  for (const nested of Object.values(value)) {
    if (nested && typeof nested === 'object' && !Object.isFrozen(nested)) deepFreeze(nested)
  }
  return value
}

const schemas = deepFreeze(rules.map(([name, properties, required]) => ({
  name,
  description:descriptions[name],
  input_schema:{
    type:'object',
    additionalProperties:false,
    ...(required.length ? { required } : {}),
    properties,
  },
})))

const validationRules = new Map(rules.map(([name, properties, required]) => [
  name,
  deepFreeze({
    properties:structuredClone(properties),
    required:[...required],
  }),
]))

function invalid(message, details) {
  throw new AgentError(400, 'AGENT_TOOL_INPUT_INVALID', message, details)
}

function invalidOutput(message, details) {
  throw new AgentError(502, 'AGENT_TOOL_OUTPUT_INVALID', message, details)
}

function safeInputValue(value, field) {
  try {
    return sanitizeToolOutput(value, { maxDepth:20, maxNodes:10_000, maxStringBytes:100_000 })
  } catch {
    invalid('Tool input must contain only bounded plain JSON data', { field })
  }
}

export function sanitizeToolOutput(value, {
  maxDepth = 20,
  maxNodes = 50_000,
  maxStringBytes = 100_000,
} = {}) {
  const clone = value === null || typeof value !== 'object' ? value : Array.isArray(value) ? [] : Object.create(null)
  const stack = [{ value, parent:null, key:null, depth:0, clone }]
  const seen = new WeakSet()
  let nodes = 0

  while (stack.length) {
    const current = stack.pop()
    const item = current.value
    if (++nodes > maxNodes) invalidOutput('Tool output exceeds node limit')
    if (current.depth > maxDepth) invalidOutput('Tool output exceeds depth limit')

    let normalized
    if (item === null || typeof item === 'boolean') normalized = item
    else if (typeof item === 'string') {
      if (Buffer.byteLength(item, 'utf8') > maxStringBytes) invalidOutput('Tool output string exceeds byte limit')
      normalized = item
    } else if (typeof item === 'number') {
      if (!Number.isFinite(item)) invalidOutput('Tool output contains a non-finite number')
      normalized = item
    } else if (typeof item === 'object') {
      const isArray = Array.isArray(item)
      const prototype = Object.getPrototypeOf(item)
      if (isArray && prototype !== Array.prototype) invalidOutput('Tool output contains a non-plain array')
      if (!isArray && prototype !== Object.prototype && prototype !== null) {
        invalidOutput('Tool output contains a non-plain object')
      }
      if (seen.has(item)) invalidOutput('Tool output contains a circular or repeated reference')
      seen.add(item)
      if (Object.getOwnPropertySymbols(item).length) invalidOutput('Tool output contains a symbol field')
      const descriptors = Object.getOwnPropertyDescriptors(item)
      normalized = current.clone
      const entries = Object.entries(descriptors)
      for (let index = entries.length - 1; index >= 0; index--) {
        const [key, descriptor] = entries[index]
        if (isArray && key === 'length') continue
        if (!descriptor.enumerable || !Object.hasOwn(descriptor, 'value')) {
          invalidOutput('Tool output fields must be enumerable data properties', { field:key })
        }
        if (isArray && !/^(0|[1-9]\d*)$/.test(key)) invalidOutput('Tool output array contains a named field')
        const child = descriptor.value
        const childClone = child !== null && typeof child === 'object'
          ? (Array.isArray(child) ? [] : Object.create(null))
          : child
        Object.defineProperty(normalized, key, {
          value:childClone, enumerable:true, writable:true, configurable:true,
        })
        stack.push({ value:child, parent:normalized, key, depth:current.depth + 1, clone:childClone })
      }
      if (isArray && Object.keys(descriptors).length - 1 !== item.length) {
        invalidOutput('Tool output contains a sparse array')
      }
    } else {
      invalidOutput('Tool output contains an unsupported value')
    }
    if (current.parent) {
      Object.defineProperty(current.parent, current.key, {
        value:normalized, enumerable:true, writable:true, configurable:true,
      })
    }
  }
  return clone
}

function validate(name, input) {
  if (input === null || typeof input !== 'object' || Array.isArray(input)
    || (Object.getPrototypeOf(input) !== Object.prototype && Object.getPrototypeOf(input) !== null)) {
    invalid('Tool input must be a plain object')
  }
  if (Object.getOwnPropertySymbols(input).length) invalid('Tool input contains a symbol field')
  const descriptors = Object.getOwnPropertyDescriptors(input)
  const definition = validationRules.get(name)
  const values = {}
  for (const [key, descriptor] of Object.entries(descriptors)) {
    if (!descriptor.enumerable || !Object.hasOwn(descriptor, 'value')) {
      invalid('Tool input fields must be enumerable data properties', { field:key })
    }
    const value = descriptor.value
    values[key] = value
    const properties = definition.properties
    if (!Object.hasOwn(properties, key)) invalid('Tool input contains an unknown field', { field:key })
    const rule = properties[key]
    if (rule.type === 'string' && (typeof value !== 'string' || value.length < rule.minLength || value.length > rule.maxLength)) {
      invalid('Tool input field is invalid', { field:key })
    }
    if (rule.type === 'number' && (!Number.isFinite(value) || value <= 0)) {
      invalid('Tool input field is invalid', { field:key })
    }
    if (rule.type === 'array') {
      if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype
        || (rule.minItems !== undefined && value.length < rule.minItems)
        || (rule.maxItems !== undefined && value.length > rule.maxItems)) {
        invalid('Tool input field is invalid', { field:key })
      }
      const copy = []
      for (let index = 0; index < value.length; index += 1) {
        const item = Object.getOwnPropertyDescriptor(value, String(index))
        if (!item?.enumerable || !Object.hasOwn(item, 'value')) invalid('Tool input array is invalid', { field:key })
        if (rule.items?.type === 'string') {
          const string = item.value
          if (typeof string !== 'string'
            || string.length < (rule.items.minLength ?? 0)
            || string.length > (rule.items.maxLength ?? Infinity)) {
            invalid('Tool input array item is invalid', { field:key, index })
          }
        }
        copy.push(rule.items?.type === 'string' ? item.value : safeInputValue(item.value, key))
      }
      values[key] = copy
    }
  }
  for (const key of definition.required) {
    if (!Object.hasOwn(descriptors, key)) invalid('Tool input is missing a required field', { field:key })
  }
  return values
}

function bulkError(response) {
  const body = response?.body
  throw new AgentError(
    Number.isInteger(response?.status) ? response.status : 502,
    typeof body?.code === 'string' ? body.code : 'AGENT_BULK_FAILED',
    typeof body?.message === 'string' ? body.message : 'Bulk operation failed',
    body?.details,
  )
}

function dataProperties(value) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)
    || (Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null)) {
    invalidOutput('Tool output must be a plain object')
  }
  const descriptors = Object.getOwnPropertyDescriptors(value)
  if (Object.getOwnPropertySymbols(value).length) invalidOutput('Tool output contains a symbol field')
  for (const [key, descriptor] of Object.entries(descriptors)) {
    if (!descriptor.enumerable || !Object.hasOwn(descriptor, 'value')) {
      invalidOutput('Tool output fields must be enumerable data properties', { field:key })
    }
  }
  return Object.fromEntries(Object.entries(descriptors).map(([key, descriptor]) => [key, descriptor.value]))
}

function listResult(result) {
  if (!Array.isArray(result)) invalidOutput('List tool output must be an array')
  const { length:totalCount, items:prefix } = safeArrayPrefix(result, 10_000)
  if (prefix.length > 10_000) prefix.pop()
  const items = prefix
  if (!items.every(item => typeof item === 'string')) invalidOutput('List tool output items must be strings')
  return sanitizeToolOutput({ items, truncated:totalCount > items.length, totalCount })
}

export function safeArrayPrefix(value, maxItems) {
  if (Object.getPrototypeOf(value) !== Array.prototype || Object.getOwnPropertySymbols(value).length) {
    invalidOutput('Tool output contains a non-plain array')
  }
  const lengthDescriptor = Object.getOwnPropertyDescriptor(value, 'length')
  const length = lengthDescriptor?.value
  if (!Object.hasOwn(lengthDescriptor ?? {}, 'value') || !Number.isSafeInteger(length) || length < 0) {
    invalidOutput('Tool output array has an invalid length')
  }
  const items = []
  for (let index = 0; index < Math.min(length, maxItems + 1); index++) {
    const descriptor = Object.getOwnPropertyDescriptor(value, String(index))
    if (!descriptor || !descriptor.enumerable || !Object.hasOwn(descriptor, 'value')) {
      invalidOutput('Tool output array items must be enumerable data properties')
    }
    items.push(descriptor.value)
  }
  return { items, length }
}

function schemaResult(result) {
  const values = dataProperties(result)
  for (const key of ['fields', 'tags']) {
    if (values[key] !== undefined && !Array.isArray(values[key])) invalidOutput(`Schema ${key} must be an array`)
  }
  const fieldPrefix = safeArrayPrefix(values.fields ?? [], 10_000)
  const tagPrefix = safeArrayPrefix(values.tags ?? [], 10_000)
  if (fieldPrefix.items.length > 10_000) fieldPrefix.items.length = 10_000
  if (tagPrefix.items.length > 10_000) tagPrefix.items.length = 10_000
  const fields = fieldPrefix.items
  const tags = tagPrefix.items
  return sanitizeToolOutput({
    ...values,
    fields,
    tags,
    truncated:{
      fields:fieldPrefix.length > fields.length,
      tags:tagPrefix.length > tags.length,
    },
  })
}

function queryResult(database, rawResult) {
  const result = dataProperties(rawResult)
  const rows = Array.isArray(result.rows) ? result.rows : []
  const prefix = safeArrayPrefix(rows, AGENT_LIMITS.maxQueryRows)
  if (prefix.items.length > AGENT_LIMITS.maxQueryRows) prefix.items.length = AGENT_LIMITS.maxQueryRows
  const rowCount = Number.isSafeInteger(result.rowCount) && result.rowCount >= 0 ? result.rowCount : prefix.length
  return sanitizeToolOutput({
    database,
    rows:prefix.items,
    rowCount,
    durationMs:Number.isFinite(result.durationMs) ? result.durationMs : 0,
    truncated:prefix.length > AGENT_LIMITS.maxQueryRows || rowCount > AGENT_LIMITS.maxQueryRows,
  })
}

export function createAgentTools({ influx, resolveSession, bulkApi, now = Date.now }) {
  if (!influx || typeof resolveSession !== 'function') throw new TypeError('influx and resolveSession are required')
  const previewBindings = new Map()

  return {
    schemas,
    async execute(name, input, context) {
      if (!validationRules.has(name)) {
        throw new AgentError(404, 'AGENT_TOOL_UNKNOWN', 'Unknown Agent tool', { tool:name })
      }
      input = validate(name, input)
      const agentSession = context?.agentSession
      const session = await resolveSession(agentSession?.connectionId, context)
      if (!session) throw new AgentError(401, 'SESSION_REQUIRED', 'Bridge session is required')
      assertToolEnvironment(session, name)
      const database = agentSession?.database

      let result
      if (name === 'list_databases') result = listResult(await influx.listDatabases(session))
      else if (name === 'list_measurements') {
        const raw = await influx.listMeasurements(session, database)
        if (!Array.isArray(raw)) invalidOutput('List tool output must be an array')
        if (input.filter) {
          const filter = input.filter.toLocaleLowerCase()
          const scanned = safeArrayPrefix(raw, 20_000)
          const items = []
          for (const item of scanned.items) {
            if (typeof item !== 'string') invalidOutput('List tool output items must be strings')
            if (item.toLocaleLowerCase().includes(filter) && items.length <= 10_000) items.push(item)
          }
          const matchesTruncated = items.length > 10_000
          if (matchesTruncated) items.pop()
          result = sanitizeToolOutput({
            items,
            truncated:scanned.length > scanned.items.length || matchesTruncated,
            totalCount:items.length,
          })
        } else {
          result = listResult(raw)
        }
      } else if (name === 'get_schema') {
        result = schemaResult(await influx.getMeasurementSchema(session, database, input.measurement))
      } else if (name === 'query_influxql' || name === 'verify_data') {
        const sql = assertQuerySql(input.sql)
        result = queryResult(database, await influx.influxQuery(session, database, sql, { signal:context?.signal }))
      } else if (name === 'write_points') {
        const body = input.lines.join('\n')
        if (input.lines.some(line => !line.trim()) || Buffer.byteLength(body, 'utf8') > 2 * 1024 * 1024) {
          invalid('Line Protocol must contain non-empty lines and be at most 2 MB')
        }
        const written = await influx.influxWrite(session, database, body, {
          retentionPolicy:agentSession?.retentionPolicy,
          precision:'ms',
          signal:context?.signal,
        })
        result = {
          pointCount:input.lines.length,
          durationMs:Number.isFinite(written?.durationMs) ? written.durationMs : 0,
        }
      } else {
        if (!bulkApi?.handle) throw new AgentError(503, 'AGENT_BULK_UNAVAILABLE', 'Bulk data service is unavailable')
        if (name === 'preview_bulk_data') {
          const response = await bulkApi.handle({
            method:'POST',
            pathname:'/bulk-jobs/preview',
            session,
            payload:{ ...input, database, retentionPolicy:agentSession?.retentionPolicy },
          })
          if (response?.status !== 200) bulkError(response)
          const previewId = response.body?.previewId
          if (typeof previewId !== 'string') invalidOutput('Bulk preview output is invalid')
          previewBindings.set(previewId, {
            sessionId:agentSession?.id,
            runId:context?.run?.id,
            expiresAt:response.body.expiresAt,
            requiredAcknowledgements:Array.isArray(response.body.requiredAcknowledgements)
              ? [...response.body.requiredAcknowledgements]
              : [],
          })
          result = response.body
        } else if (name === 'create_bulk_job') {
          const binding = previewBindings.get(input.previewId)
          if (!binding
            || binding.sessionId !== agentSession?.id
            || binding.runId !== context?.run?.id
            || (Number.isFinite(binding.expiresAt) && binding.expiresAt <= now())) {
            throw new AgentError(403, 'AGENT_POLICY_DENIED', 'Bulk preview does not belong to this Agent run')
          }
          const acknowledgements = Object.fromEntries(
            binding.requiredAcknowledgements.map(key => [key, true]),
          )
          const response = await bulkApi.handle({
            method:'POST',
            pathname:'/bulk-jobs',
            session,
            payload:{ previewId:input.previewId, database, ...acknowledgements },
          })
          if (response?.status !== 200) bulkError(response)
          previewBindings.delete(input.previewId)
          result = response.body
        } else {
          const response = await bulkApi.handle({
            method:'GET',
            pathname:`/bulk-jobs/${encodeURIComponent(input.jobId)}`,
            session,
          })
          if (response?.status !== 200) bulkError(response)
          result = response.body
        }
      }
      return redactSensitive(result)
    },
  }
}
