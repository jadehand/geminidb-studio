export const BULK_LIMITS = Object.freeze({
  maxDates: 30,
  maxPoints: 100_000,
  maxSeries: 10_000,
  minIntervalSeconds: 1,
  maxIntervalSeconds: 86_400,
})

function planError(message, code = 'BULK_PLAN_INVALID') {
  const error = new Error(message)
  error.code = code
  return error
}

function requirePlainName(value, label) {
  if (typeof value !== 'string' || !value.trim()) throw planError(`${label} is required`)
  return value.trim()
}

function parseBeijingDate(date) {
  if (typeof date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    throw planError('date format must be YYYY-MM-DD')
  }
  const [year, month, day] = date.split('-').map(Number)
  const milliseconds = Date.UTC(year, month - 1, day)
  const parsed = new Date(milliseconds)
  if (parsed.getUTCFullYear() !== year || parsed.getUTCMonth() !== month - 1 || parsed.getUTCDate() !== day) {
    throw planError('date is invalid')
  }
  return { year, month, day, milliseconds }
}

function parseTime(time) {
  if (typeof time !== 'string' || !/^\d{2}:\d{2}:\d{2}$/.test(time)) {
    throw planError('time format must be HH:mm:ss')
  }
  const [hours, minutes, seconds] = time.split(':').map(Number)
  if (hours > 23 || minutes > 59 || seconds > 59) throw planError('time is invalid')
  return hours * 3_600 + minutes * 60 + seconds
}

function safeMultiply(left, right) {
  if (!Number.isSafeInteger(left) || !Number.isSafeInteger(right) || left * right > Number.MAX_SAFE_INTEGER) {
    throw planError('safe integer multiplication overflow')
  }
  return left * right
}

function normalizeSchema(schema) {
  if (!schema || typeof schema !== 'object') throw planError('schema is required')
  const tags = Array.isArray(schema.tags) ? schema.tags.map(tag => requirePlainName(tag, 'schema tag')) : null
  const fields = Array.isArray(schema.fields)
    ? schema.fields.map(field => ({ name: requirePlainName(field?.name, 'schema field'), type: requirePlainName(field?.type, 'schema field type') }))
    : null
  if (!tags || !fields) throw planError('schema tags and fields are required')
  if (new Set(tags).size !== tags.length) throw planError('schema tags must be unique')
  if (new Set(fields.map(field => field.name)).size !== fields.length) throw planError('schema fields must be unique')
  return { tags, fields }
}

function indexByName(items, itemLabel) {
  if (!Array.isArray(items)) throw planError(`${itemLabel} generators are required`)
  const index = new Map()
  for (const item of items) {
    const name = requirePlainName(item?.name, itemLabel)
    if (index.has(name)) throw planError(`duplicate ${itemLabel} generator ${name}`)
    index.set(name, item)
  }
  return index
}

export function beijingDateToUnixSeconds(date) {
  const { milliseconds } = parseBeijingDate(date)
  return (milliseconds - 8 * 60 * 60 * 1_000) / 1_000
}

export function measurementForDate(prefix, date) {
  return `${requirePlainName(prefix, 'prefix')}_${beijingDateToUnixSeconds(date)}`
}

export function buildTimeSlots(date, startTime, endTime, intervalSeconds) {
  const startSeconds = parseTime(startTime)
  const endSeconds = parseTime(endTime)
  if (startSeconds > endSeconds) throw planError('start time cannot be later than end time')
  if (!Number.isInteger(intervalSeconds)) throw planError('interval seconds must be an integer')
  if (intervalSeconds < BULK_LIMITS.minIntervalSeconds || intervalSeconds > BULK_LIMITS.maxIntervalSeconds) {
    throw planError(`interval seconds must be between ${BULK_LIMITS.minIntervalSeconds} and ${BULK_LIMITS.maxIntervalSeconds}`)
  }

  const startMilliseconds = beijingDateToUnixSeconds(date) * 1_000 + startSeconds * 1_000
  const endMilliseconds = beijingDateToUnixSeconds(date) * 1_000 + endSeconds * 1_000
  const slots = []
  for (let timestamp = startMilliseconds; timestamp <= endMilliseconds; timestamp += intervalSeconds * 1_000) slots.push(timestamp)
  return slots
}

export function normalizePlanInput(input) {
  if (!input || typeof input !== 'object') throw planError('plan input is required')
  const prefix = requirePlainName(input.prefix, 'prefix')
  const schema = normalizeSchema(input.schema)
  if (!Array.isArray(input.dates) || input.dates.length === 0) throw planError('at least one date is required')
  const dateSet = new Set()
  for (const date of input.dates) {
    parseBeijingDate(date)
    if (dateSet.has(date)) throw planError(`duplicate date ${date}`)
    dateSet.add(date)
  }
  const dates = [...dateSet].sort()
  if (dates.length > BULK_LIMITS.maxDates) throw planError(`at most ${BULK_LIMITS.maxDates} dates are allowed`)

  const tagInputs = indexByName(input.tags, 'tag')
  const fieldInputs = indexByName(input.fields, 'field')

  const tags = schema.tags.map(name => {
    const tag = tagInputs.get(name)
    if (!tag) throw planError(`missing generator for schema tag ${name}`)
    if (!Array.isArray(tag.values) || tag.values.length === 0) throw planError(`tag ${name} requires at least one value`)
    const values = tag.values.map(value => {
      if (typeof value !== 'string') throw planError(`tag value for ${name} must be a string`)
      const trimmed = value.trim()
      if (!trimmed) throw planError('tag value cannot be empty')
      return trimmed
    })
    return { ...tag, name, values }
  })
  const fields = schema.fields.map(schemaField => {
    const field = fieldInputs.get(schemaField.name)
    if (!field) throw planError(`missing generator for schema field ${schemaField.name}`)
    if (!field.generator || typeof field.generator !== 'object') throw planError(`field ${schemaField.name} requires a generator`)
    return { ...field, name: schemaField.name, type: schemaField.type }
  })
  if (tagInputs.size !== schema.tags.length) throw planError('tag generators must match schema tags')
  if (fieldInputs.size !== schema.fields.length) throw planError('field generators must match schema fields')

  return {
    ...input,
    prefix,
    dates,
    schema,
    tags,
    fields,
    startTime: input.startTime,
    endTime: input.endTime,
    intervalSeconds: input.intervalSeconds,
  }
}

export function estimatePlan(input) {
  const plan = normalizePlanInput(input)
  const timestamps = buildTimeSlots(plan.dates[0], plan.startTime, plan.endTime, plan.intervalSeconds)
  let tagCombinationCount = 1
  for (const tag of plan.tags) tagCombinationCount = safeMultiply(tagCombinationCount, tag.values.length)
  const pointCount = safeMultiply(safeMultiply(plan.dates.length, timestamps.length), tagCombinationCount)
  const maxNewSeries = safeMultiply(plan.dates.length, tagCombinationCount)
  if (pointCount > BULK_LIMITS.maxPoints) throw planError('point limit exceeded')
  if (maxNewSeries > BULK_LIMITS.maxSeries) throw planError('series limit exceeded')

  return {
    ...plan,
    tagCombinationCount,
    pointCount,
    maxNewSeries,
    targets: plan.dates.map(date => ({
      date,
      measurement: measurementForDate(plan.prefix, date),
      timestamps: buildTimeSlots(date, plan.startTime, plan.endTime, plan.intervalSeconds),
    })),
  }
}

export function validateRetentionPolicy(rp, timestamps, now = Date.now()) {
  if (!rp || !Number.isSafeInteger(rp.durationMs) || rp.durationMs < 0) throw planError('retention policy duration is invalid')
  if (rp.durationMs === 0) return
  if (!Array.isArray(timestamps) || !Number.isSafeInteger(now)) throw planError('retention validation input is invalid')
  const cutoff = now - rp.durationMs
  if (timestamps.some(timestamp => !Number.isSafeInteger(timestamp) || timestamp < cutoff)) {
    throw planError('retention policy window is exceeded', 'RP_RETENTION_EXCEEDED')
  }
}

export function compareTargetSchema(source, target) {
  const sourceSchema = normalizeSchema(source)
  const targetSchema = normalizeSchema(target)
  const warnings = []
  const sourceTags = new Set(sourceSchema.tags)
  const targetTags = new Set(targetSchema.tags)
  for (const name of sourceSchema.tags) if (!targetTags.has(name)) warnings.push({ kind: 'missing-tag', name })
  for (const name of targetSchema.tags) if (!sourceTags.has(name)) warnings.push({ kind: 'extra-tag', name })

  const sourceFields = new Map(sourceSchema.fields.map(field => [field.name, field]))
  const targetFields = new Map(targetSchema.fields.map(field => [field.name, field]))
  for (const field of sourceSchema.fields) if (!targetFields.has(field.name)) warnings.push({ kind: 'missing-field', name: field.name })
  for (const field of targetSchema.fields) if (!sourceFields.has(field.name)) warnings.push({ kind: 'extra-field', name: field.name })

  const conflicts = []
  for (const field of sourceSchema.fields) {
    const targetField = targetFields.get(field.name)
    if (targetField && targetField.type !== field.type) {
      conflicts.push({ name: field.name, sourceType: field.type, targetType: targetField.type })
    }
  }
  return { warnings, conflicts }
}
