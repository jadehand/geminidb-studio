import assert from 'node:assert/strict'
import test from 'node:test'
import {
  beijingDateToUnixSeconds,
  buildTimeSlots,
  compareTargetSchema,
  estimatePlan,
  measurementForDate,
  normalizePlanInput,
  validateRetentionPolicy,
} from './bulk-plan.mjs'

const schema = {
  tags: ['host', 'region'],
  fields: [
    { name: 'usage', type: 'float' },
    { name: 'count', type: 'integer' },
  ],
}

function planInput(overrides = {}) {
  return {
    prefix: 'cpu',
    dates: ['2026-07-25', '2026-07-26'],
    startTime: '00:00:00',
    endTime: '00:01:00',
    intervalSeconds: 60,
    schema,
    tags: [
      { name: 'host', values: [' n1 ', 'n2'] },
      { name: 'region', values: ['a', 'b'] },
    ],
    fields: [
      { name: 'usage', generator: { kind: 'random-number', min: 0, max: 100 } },
      { name: 'count', generator: { kind: 'increment', start: 0, step: 1 } },
    ],
    ...overrides,
  }
}

test('Beijing dates produce ten-digit day-table suffixes', () => {
  assert.equal(beijingDateToUnixSeconds('2026-07-26'), 1784995200)
  assert.equal(measurementForDate('cpu', '2026-07-26'), 'cpu_1784995200')
})

test('time slots include the end time and reject a cross-day range', () => {
  assert.deepEqual(
    buildTimeSlots('2026-07-26', '00:00:00', '00:02:00', 60),
    [1784995200000, 1784995260000, 1784995320000],
  )
  assert.throws(
    () => buildTimeSlots('2026-07-26', '23:00:00', '01:00:00', 60),
    /start time cannot be later than end time/,
  )
})

test('normalization sorts dates, trims tag values, and uses schema order', () => {
  const result = normalizePlanInput(planInput({
    dates: ['2026-07-26', '2026-07-25'],
    tags: [
      { name: 'region', values: [' a ', 'b'] },
      { name: 'host', values: [' n1 ', 'n2'] },
    ],
    fields: [
      { name: 'count', generator: { kind: 'increment', start: 0, step: 1 } },
      { name: 'usage', generator: { kind: 'random-number', min: 0, max: 100 } },
    ],
  }))

  assert.deepEqual(result.dates, ['2026-07-25', '2026-07-26'])
  assert.deepEqual(result.tags, [
    { name: 'host', values: ['n1', 'n2'] },
    { name: 'region', values: ['a', 'b'] },
  ])
  assert.deepEqual(result.fields.map(field => field.name), ['usage', 'count'])
})

test('normalization rejects duplicate dates and incomplete schema generators', () => {
  assert.throws(() => normalizePlanInput(planInput({ dates: ['2026-07-25', '2026-07-25'] })), /duplicate date/)
  assert.throws(() => normalizePlanInput(planInput({ prefix: '   ' })), /prefix is required/)
  assert.throws(() => normalizePlanInput(planInput({ tags: [{ name: 'host', values: ['n1'] }] })), /missing generator for schema tag region/)
  assert.throws(() => normalizePlanInput(planInput({ fields: [{ name: 'usage', generator: { kind: 'fixed', value: 1 } }] })), /missing generator for schema field count/)
  assert.throws(() => normalizePlanInput(planInput({ tags: [{ name: 'host', values: [' '] }, { name: 'region', values: ['a'] }] })), /tag value cannot be empty/)
})

test('estimates points and worst-case new series across dates', () => {
  const result = estimatePlan(planInput())

  assert.equal(result.tagCombinationCount, 4)
  assert.equal(result.pointCount, 16)
  assert.equal(result.maxNewSeries, 8)
  assert.equal(result.targets[0].measurement, 'cpu_1784908800')
})

test('planning rejects too many dates, an invalid interval, point and series overflows', () => {
  assert.throws(() => estimatePlan(planInput({ dates: Array.from({ length: 8 }, (_, index) => `2026-07-${String(index + 1).padStart(2, '0')}`) })), /at most 7 dates/)
  assert.throws(() => estimatePlan(planInput({ intervalSeconds: 1.5 })), /interval seconds must be an integer/)
  assert.throws(() => estimatePlan(planInput({ endTime: '23:59:59', intervalSeconds: 1 })), /point limit exceeded/)
  assert.throws(() => estimatePlan(planInput({
    tags: [
      { name: 'host', values: Array.from({ length: 101 }, (_, index) => `n${index}`) },
      { name: 'region', values: Array.from({ length: 100 }, (_, index) => `r${index}`) },
    ],
  })), /series limit exceeded/)
  const overflowTags = Array.from({ length: 5 }, (_, index) => `tag${index}`)
  assert.throws(() => estimatePlan(planInput({
    schema: { tags: overflowTags, fields: schema.fields },
    tags: overflowTags.map(name => ({ name, values: Array.from({ length: 10_000 }, (_, index) => `${name}-${index}`) })),
  })), /safe integer/)
})

test('retention policy allows infinity and rejects timestamps older than its window', () => {
  assert.doesNotThrow(() => validateRetentionPolicy({ durationMs: 0 }, [0], 1_000))
  assert.throws(
    () => validateRetentionPolicy({ durationMs: 1_000 }, [8_999], 10_000),
    error => error.code === 'RP_RETENTION_EXCEEDED',
  )
  assert.doesNotThrow(() => validateRetentionPolicy({ durationMs: 1_000 }, [9_000], 10_000))
})

test('schema comparison reports drift as warnings and field type conflicts', () => {
  const result = compareTargetSchema(
    { tags: ['host', 'region'], fields: [{ name: 'usage', type: 'float' }, { name: 'count', type: 'integer' }] },
    { tags: ['host', 'zone'], fields: [{ name: 'usage', type: 'integer' }, { name: 'status', type: 'string' }] },
  )

  assert.deepEqual(result, {
    warnings: [
      { kind: 'missing-tag', name: 'region' },
      { kind: 'extra-tag', name: 'zone' },
      { kind: 'missing-field', name: 'count' },
      { kind: 'extra-field', name: 'status' },
    ],
    conflicts: [{ name: 'usage', sourceType: 'float', targetType: 'integer' }],
  })
})
