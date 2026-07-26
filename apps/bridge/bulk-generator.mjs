function createError(message, code) {
  const error = new Error(`${code}: ${message}`)
  error.code = code
  return error
}

function generatorError(message) {
  return createError(message, 'GENERATOR_INVALID')
}

function constraintError(message, code = 'CONSTRAINT_INVALID') {
  return createError(message, code)
}

function isFiniteNumber(value) {
  return typeof value === 'number' && Number.isFinite(value)
}

function requireFieldName(value) {
  if (typeof value !== 'string' || !value.trim()) throw generatorError('field name is required')
  return value.trim()
}

function requireSafeInteger(value, label) {
  if (!Number.isSafeInteger(value)) throw generatorError(`${label} must be a safe integer`)
  return value
}

function requireFiniteNumber(value, label) {
  if (!isFiniteNumber(value)) throw generatorError(`${label} must be finite`)
  return value
}

function assertFieldValue(type, value, label = 'field value') {
  if (type === 'float') return requireFiniteNumber(value, label)
  if (type === 'integer') return requireSafeInteger(value, label)
  if (type === 'string') {
    if (typeof value !== 'string') throw generatorError(`${label} must be a string`)
    return value
  }
  if (type === 'boolean') {
    if (typeof value !== 'boolean') throw generatorError(`${label} must be a boolean`)
    return value
  }
  throw generatorError(`unsupported field type ${type}`)
}

function normalizeGenerator(field) {
  const name = requireFieldName(field?.name)
  const type = field?.type
  const generator = field?.generator
  if (!generator || typeof generator !== 'object') throw generatorError(`field ${name} generator is required`)

  if (generator.kind === 'fixed') {
    return { name, type, kind: 'fixed', value: assertFieldValue(type, generator.value, `${name} fixed value`) }
  }
  if (generator.kind === 'random-number') {
    if (type !== 'float' && type !== 'integer') throw generatorError(`${name} random-number only supports numeric fields`)
    const min = assertFieldValue(type, generator.min, `${name} minimum`)
    const max = assertFieldValue(type, generator.max, `${name} maximum`)
    if (min > max) throw generatorError(`${name} minimum cannot exceed maximum`)
    return { name, type, kind: 'random-number', min, max }
  }
  if (generator.kind === 'increment') {
    if (type !== 'float' && type !== 'integer') throw generatorError(`${name} increment only supports numeric fields`)
    const start = assertFieldValue(type, generator.start, `${name} increment start`)
    const step = assertFieldValue(type, generator.step, `${name} increment step`)
    return { name, type, kind: 'increment', start, step }
  }
  if (generator.kind === 'string-list') {
    if (type !== 'string') throw generatorError(`${name} string-list only supports string fields`)
    if (!Array.isArray(generator.values) || generator.values.length === 0) throw generatorError(`${name} string-list requires values`)
    return { name, type, kind: 'string-list', values: generator.values.map(value => assertFieldValue(type, value, `${name} list value`)) }
  }
  if (generator.kind === 'random-boolean') {
    if (type !== 'boolean') throw generatorError(`${name} random-boolean only supports boolean fields`)
    const truePercent = requireFiniteNumber(generator.truePercent, `${name} true percent`)
    if (truePercent < 0 || truePercent > 100) throw generatorError(`${name} true percent must be between 0 and 100`)
    return { name, type, kind: 'random-boolean', truePercent }
  }
  throw generatorError(`${name} has an unsupported generator kind`)
}

function hashSeed(seed) {
  const input = String(seed)
  let hash = 2_166_136_261
  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index)
    hash = Math.imul(hash, 16_777_619)
  }
  return hash >>> 0
}

export function createSeededRandom(seed) {
  let state = hashSeed(seed)
  return () => {
    state = (state + 0x6D2B79F5) >>> 0
    let value = state
    value = Math.imul(value ^ (value >>> 15), value | 1)
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61)
    return ((value ^ (value >>> 14)) >>> 0) / 4_294_967_296
  }
}

function normalizeRight(right, fieldsByName, leftType) {
  if (right && typeof right === 'object' && right.kind === 'field') {
    const field = fieldsByName.get(right.field)
    if (!field) throw constraintError(`unknown right field ${right.field}`)
    if (field.type !== leftType) throw constraintError('constraint field types must match')
    return { kind: 'field', field: field.name }
  }
  const value = right && typeof right === 'object' && (right.kind === 'fixed' || right.kind === 'value') ? right.value : right
  try {
    return { kind: 'value', value: assertFieldValue(leftType, value, 'constraint value') }
  } catch (error) {
    if (error.code === 'GENERATOR_INVALID') throw constraintError(error.message)
    throw error
  }
}

function compare(left, operator, right) {
  if (operator === '>') return left > right
  if (operator === '>=') return left >= right
  if (operator === '<') return left < right
  if (operator === '<=') return left <= right
  if (operator === '=') return left === right
  if (operator === '!=') return left !== right
  throw constraintError(`unsupported constraint operator ${operator}`)
}

function validateOperator(type, operator) {
  const numeric = new Set(['>', '>=', '<', '<=', '=', '!='])
  const simple = new Set(['=', '!='])
  if (!(type === 'float' || type === 'integer' ? numeric : simple).has(operator)) {
    throw constraintError(`operator ${operator} is invalid for ${type}`)
  }
}

function topologicalOrder(fields, dependencies) {
  const indegree = new Map(fields.map(field => [field.name, 0]))
  for (const children of dependencies.values()) {
    for (const child of children) indegree.set(child, indegree.get(child) + 1)
  }
  const pending = fields.filter(field => indegree.get(field.name) === 0).map(field => field.name)
  const ordered = []
  while (pending.length) {
    const name = pending.shift()
    ordered.push(name)
    for (const child of dependencies.get(name) ?? []) {
      indegree.set(child, indegree.get(child) - 1)
      if (indegree.get(child) === 0) pending.push(child)
    }
  }
  if (ordered.length !== fields.length) throw constraintError('field constraints contain a dependency cycle', 'CONSTRAINT_UNSATISFIABLE')
  return ordered
}

function tightenLower(domain, value, inclusive) {
  if (value > domain.lower) {
    domain.lower = value
    domain.lowerInclusive = inclusive
  } else if (value === domain.lower) {
    domain.lowerInclusive = domain.lowerInclusive && inclusive
  }
}

function tightenUpper(domain, value, inclusive) {
  if (value < domain.upper) {
    domain.upper = value
    domain.upperInclusive = inclusive
  } else if (value === domain.upper) {
    domain.upperInclusive = domain.upperInclusive && inclusive
  }
}

function constraintsForDomain(field, rightValues, constraints) {
  const numeric = field.type === 'float' || field.type === 'integer'
  const domain = numeric
    ? { lower: -Infinity, lowerInclusive: true, upper: Infinity, upperInclusive: true, excluded: new Set() }
    : { candidates: null, excluded: new Set(), equality: undefined }
  for (const constraint of constraints) {
    const right = constraint.right.kind === 'field' ? rightValues[constraint.right.field] : constraint.right.value
    if (right === undefined) throw constraintError(`constraint dependency ${constraint.right.field} was not generated`)
    if (numeric) {
      if (constraint.operator === '>') {
        tightenLower(domain, right, false)
      } else if (constraint.operator === '>=') {
        tightenLower(domain, right, true)
      } else if (constraint.operator === '<') {
        tightenUpper(domain, right, false)
      } else if (constraint.operator === '<=') {
        tightenUpper(domain, right, true)
      } else if (constraint.operator === '=') {
        tightenLower(domain, right, true)
        tightenUpper(domain, right, true)
      } else {
        domain.excluded.add(right)
      }
    } else if (constraint.operator === '=') {
      if (domain.equality !== undefined && domain.equality !== right) return null
      domain.equality = right
    } else {
      domain.excluded.add(right)
    }
  }
  return domain
}

function numberBounds(field, domain, index) {
  let min
  let max
  let fixed
  if (field.kind === 'fixed') fixed = field.value
  else if (field.kind === 'increment') fixed = field.start + field.step * index
  else {
    min = field.min
    max = field.max
  }
  if (fixed !== undefined) {
    if (!isFiniteNumber(fixed) || (field.type === 'integer' && !Number.isSafeInteger(fixed))) throw constraintError(`${field.name} increment overflows its type`, 'CONSTRAINT_UNSATISFIABLE')
    return { fixed, min: fixed, max: fixed }
  }
  const lowerInclusive = min > domain.lower ? true : domain.lowerInclusive
  const upperInclusive = max < domain.upper ? true : domain.upperInclusive
  min = Math.max(min, domain.lower)
  max = Math.min(max, domain.upper)
  if (field.type === 'integer') {
    min = lowerInclusive ? Math.ceil(min) : Math.floor(min) + 1
    max = upperInclusive ? Math.floor(max) : Math.ceil(max) - 1
    return { min, max, lowerInclusive: true, upperInclusive: true }
  }
  return { min, max, lowerInclusive, upperInclusive }
}

function chooseInteger(min, max, excluded, random) {
  if (!Number.isSafeInteger(min) || !Number.isSafeInteger(max) || min > max) return undefined
  const blocked = [...excluded].filter(value => Number.isSafeInteger(value) && value >= min && value <= max).sort((a, b) => a - b)
  const start = BigInt(min)
  const count = BigInt(max) - start + 1n - BigInt(blocked.length)
  if (count <= 0n) return undefined
  const unit = random()
  if (!isFiniteNumber(unit) || unit < 0 || unit >= 1) throw generatorError('random must return a finite value from 0 (inclusive) to 1 (exclusive)')
  const scale = 1n << 53n
  let offset = (BigInt(Math.floor(unit * Number(scale))) * count) / scale
  for (const value of blocked) {
    if (offset >= BigInt(value) - start) offset += 1n
  }
  return Number(start + offset)
}

function nextUp(value) {
  if (!isFiniteNumber(value) || value === Infinity) return value
  if (Object.is(value, -0) || value === 0) return Number.MIN_VALUE
  const buffer = new ArrayBuffer(8)
  const view = new DataView(buffer)
  view.setFloat64(0, value)
  const bits = view.getBigUint64(0)
  view.setBigUint64(0, value > 0 ? bits + 1n : bits - 1n)
  return view.getFloat64(0)
}

function nextDown(value) {
  if (!isFiniteNumber(value) || value === -Infinity) return value
  if (Object.is(value, -0) || value === 0) return -Number.MIN_VALUE
  const buffer = new ArrayBuffer(8)
  const view = new DataView(buffer)
  view.setFloat64(0, value)
  const bits = view.getBigUint64(0)
  view.setBigUint64(0, value > 0 ? bits - 1n : bits + 1n)
  return view.getFloat64(0)
}

function chooseFloat(min, max, lowerInclusive, upperInclusive, excluded, random) {
  if (min > max || !isFiniteNumber(min) || !isFiniteNumber(max)) return undefined
  const first = lowerInclusive ? min : nextUp(min)
  const last = upperInclusive ? max : nextDown(max)
  if (first > last) return undefined
  if (first === last) return excluded.has(first) ? undefined : first
  const unit = random()
  if (!isFiniteNumber(unit) || unit < 0 || unit >= 1) throw generatorError('random must return a finite value from 0 (inclusive) to 1 (exclusive)')
  let value = first * (1 - unit) + last * unit
  if (value > last) value = last
  if (!excluded.has(value)) return value
  for (const candidate of [first, last, nextUp(first), nextDown(last)]) {
    if (candidate >= first && candidate <= last && !excluded.has(candidate)) return candidate
  }
  return undefined
}

function satisfiesNumericDomain(value, domain) {
  return value >= domain.lower && value <= domain.upper &&
    !(value === domain.lower && !domain.lowerInclusive) &&
    !(value === domain.upper && !domain.upperInclusive) &&
    !domain.excluded.has(value)
}

function generateNumeric(field, domain, random, index) {
  const bounds = numberBounds(field, domain, index)
  if (bounds.fixed !== undefined) {
    if (!satisfiesNumericDomain(bounds.fixed, domain)) {
      throw constraintError(`${field.name} has no feasible value`, 'CONSTRAINT_UNSATISFIABLE')
    }
    return bounds.fixed
  }
  const value = field.type === 'integer'
    ? chooseInteger(bounds.min, bounds.max, domain.excluded, random)
    : chooseFloat(bounds.min, bounds.max, bounds.lowerInclusive, bounds.upperInclusive, domain.excluded, random)
  if (value === undefined || !satisfiesNumericDomain(value, domain)) throw constraintError(`${field.name} has no feasible value`, 'CONSTRAINT_UNSATISFIABLE')
  return value
}

function generatorCandidates(field, index) {
  if (field.kind === 'fixed') return [field.value]
  if (field.kind === 'increment') return [field.start + field.step * index]
  if (field.kind === 'string-list') return [...field.values]
  if (field.kind === 'random-boolean') {
    if (field.truePercent === 0) return [false]
    if (field.truePercent === 100) return [true]
    return [false, true]
  }
  return null
}

function generateDiscrete(field, domain, random, index) {
  let candidates = generatorCandidates(field, index)
  if (!candidates) throw constraintError(`${field.name} has an invalid discrete generator`)
  if (domain.equality !== undefined) candidates = candidates.filter(value => value === domain.equality)
  candidates = candidates.filter(value => !domain.excluded.has(value))
  if (candidates.length === 0) throw constraintError(`${field.name} has no feasible value`, 'CONSTRAINT_UNSATISFIABLE')
  if (field.kind === 'random-boolean' && candidates.length === 2 && domain.equality === undefined && domain.excluded.size === 0) {
    return random() < field.truePercent / 100
  }
  if (field.kind === 'fixed' || field.kind === 'increment' || candidates.length === 1) return candidates[0]
  return candidates[Math.floor(random() * candidates.length)]
}

function validateStaticFeasibility(order, fieldsByName, byLeft) {
  const knownValues = {}
  for (const name of order) {
    const field = fieldsByName.get(name)
    if (field.kind === 'fixed') knownValues[name] = field.value
    const fieldConstraints = byLeft.get(name)
    if (!fieldConstraints.every(constraint => constraint.right.kind === 'value' || Object.hasOwn(knownValues, constraint.right.field))) continue
    const domain = constraintsForDomain(field, knownValues, fieldConstraints)
    if (field.type === 'float' || field.type === 'integer') {
      if (field.kind === 'increment') continue
      const bounds = numberBounds(field, domain, 0)
      const candidate = bounds.fixed !== undefined
        ? bounds.fixed
        : field.type === 'integer'
          ? chooseInteger(bounds.min, bounds.max, domain.excluded, () => 0)
          : chooseFloat(bounds.min, bounds.max, bounds.lowerInclusive, bounds.upperInclusive, domain.excluded, () => 0)
      if (candidate === undefined || candidate < domain.lower || candidate > domain.upper ||
        (candidate === domain.lower && !domain.lowerInclusive) ||
        (candidate === domain.upper && !domain.upperInclusive) || domain.excluded.has(candidate)) {
        throw constraintError(`${name} has no feasible value`, 'CONSTRAINT_UNSATISFIABLE')
      }
    } else {
      let candidates = generatorCandidates(field, 0)
      if (domain.equality !== undefined) candidates = candidates.filter(value => value === domain.equality)
      if (!candidates.some(value => !domain.excluded.has(value))) {
        throw constraintError(`${name} has no feasible value`, 'CONSTRAINT_UNSATISFIABLE')
      }
    }
  }
}

export function compileConstraints(fields, constraints = []) {
  if (!Array.isArray(fields) || fields.length === 0) throw generatorError('fields are required')
  if (!Array.isArray(constraints)) throw constraintError('constraints must be an array')
  const normalizedFields = fields.map(normalizeGenerator)
  const fieldsByName = new Map()
  for (const field of normalizedFields) {
    if (fieldsByName.has(field.name)) throw generatorError(`duplicate field ${field.name}`)
    fieldsByName.set(field.name, field)
  }
  const byLeft = new Map(normalizedFields.map(field => [field.name, []]))
  const dependencies = new Map(normalizedFields.map(field => [field.name, []]))
  const normalizedConstraints = constraints.map(raw => {
    const left = fieldsByName.get(raw?.left)
    if (!left) throw constraintError(`unknown left field ${raw?.left}`)
    validateOperator(left.type, raw.operator)
    const right = normalizeRight(raw.right, fieldsByName, left.type)
    if (right.kind === 'field') {
      if (right.field === left.name) throw constraintError('field cannot constrain itself', 'CONSTRAINT_UNSATISFIABLE')
      dependencies.get(right.field).push(left.name)
    }
    const constraint = { left: left.name, operator: raw.operator, right }
    byLeft.get(left.name).push(constraint)
    return constraint
  })
  const order = topologicalOrder(normalizedFields, dependencies)
  validateStaticFeasibility(order, fieldsByName, byLeft)

  return {
    fields: normalizedFields,
    constraints: normalizedConstraints,
    order,
    generate(random, index = 0) {
      if (typeof random !== 'function') throw generatorError('random must be a function')
      if (!Number.isSafeInteger(index) || index < 0) throw generatorError('generation index must be a non-negative safe integer')
      const values = {}
      for (const name of order) {
        const field = fieldsByName.get(name)
        const domain = constraintsForDomain(field, values, byLeft.get(name))
        if (!domain) throw constraintError(`${name} has no feasible value`, 'CONSTRAINT_UNSATISFIABLE')
        values[name] = field.type === 'float' || field.type === 'integer'
          ? generateNumeric(field, domain, random, index)
          : generateDiscrete(field, domain, random, index)
      }
      return values
    },
  }
}

function rejectLineBreaks(value, label) {
  const stringValue = String(value)
  if (/[\r\n]/.test(stringValue)) throw generatorError(`${label} cannot contain CR/LF`)
  return stringValue
}

function escapeIdentifier(value, label) {
  return rejectLineBreaks(value, label).replace(/([ ,=])/g, '\\$1')
}

function escapeString(value, label) {
  return rejectLineBreaks(value, label).replace(/([\\"])/g, '\\$1')
}

function normalizeObjectEntries(value, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw generatorError(`${label} must be an object`)
  return Object.entries(value)
}

export function encodeLineProtocol(point) {
  if (!point || typeof point !== 'object') throw generatorError('point is required')
  if (typeof point.measurement !== 'string' || !point.measurement) throw generatorError('measurement is required')
  requireSafeInteger(point.timestampMs, 'timestamp')
  const tags = normalizeObjectEntries(point.tags ?? {}, 'tags').map(([key, value]) => `${escapeIdentifier(key, 'tag key')}=${escapeIdentifier(value, 'tag value')}`)
  const fields = normalizeObjectEntries(point.fields, 'fields').map(([key, field]) => {
    if (!field || typeof field !== 'object') throw generatorError(`field ${key} is invalid`)
    const value = assertFieldValue(field.type, field.value, `field ${key}`)
    if (field.type === 'integer') return `${escapeIdentifier(key, 'field key')}=${value}i`
    if (field.type === 'boolean') return `${escapeIdentifier(key, 'field key')}=${value}`
    if (field.type === 'string') return `${escapeIdentifier(key, 'field key')}="${escapeString(value, 'string field value')}"`
    return `${escapeIdentifier(key, 'field key')}=${value}`
  })
  if (fields.length === 0) throw generatorError('point requires at least one field')
  return `${escapeIdentifier(point.measurement, 'measurement')}${tags.length ? `,${tags.join(',')}` : ''} ${fields.join(',')} ${point.timestampMs}`
}

function* cartesianTags(tags, index = 0, current = {}) {
  if (index === tags.length) {
    yield current
    return
  }
  const tag = tags[index]
  if (!tag || typeof tag.name !== 'string' || !Array.isArray(tag.values) || tag.values.length === 0) throw generatorError('tag values are required')
  for (const value of tag.values) {
    yield* cartesianTags(tags, index + 1, { ...current, [tag.name]: value })
  }
}

export function generatePoint(context) {
  if (!context || typeof context !== 'object') throw generatorError('point context is required')
  const compiled = context.compiled ?? compileConstraints(context.fields, context.constraints ?? [])
  const random = context.random ?? createSeededRandom(context.seed ?? '')
  const values = compiled.generate(random, context.index ?? 0)
  const fields = Object.fromEntries(compiled.fields.map(field => [field.name, { type: field.type, value: values[field.name] }]))
  return {
    measurement: context.measurement,
    tags: context.tags ?? {},
    fields,
    timestampMs: context.timestampMs,
  }
}

export function* iteratePlanLines(plan, seed) {
  if (!plan || typeof plan !== 'object' || !Array.isArray(plan.targets) || !Array.isArray(plan.tags) || !Array.isArray(plan.fields)) {
    throw generatorError('plan targets, tags, and fields are required')
  }
  const compiled = compileConstraints(plan.fields, plan.constraints ?? [])
  const random = createSeededRandom(seed)
  let index = 0
  for (const target of plan.targets) {
    if (!Array.isArray(target.timestamps)) throw generatorError('target timestamps are required')
    for (const timestampMs of target.timestamps) {
      for (const tags of cartesianTags(plan.tags)) {
        yield encodeLineProtocol(generatePoint({
          compiled,
          random,
          index,
          measurement: target.measurement,
          tags,
          timestampMs,
        }))
        index += 1
      }
    }
  }
}

export function* batchLines(lines, maxBatchSize) {
  if (!Number.isSafeInteger(maxBatchSize) || maxBatchSize <= 0 || maxBatchSize > 1_000) throw generatorError('batch size must be a positive integer no greater than 1000')
  if (!lines || typeof lines[Symbol.iterator] !== 'function') throw generatorError('lines must be iterable')
  const iterator = lines[Symbol.iterator]()
  while (true) {
    const batch = []
    while (batch.length < maxBatchSize) {
      const next = iterator.next()
      if (next.done) break
      batch.push(next.value)
    }
    if (batch.length) yield batch
    else return
  }
}
