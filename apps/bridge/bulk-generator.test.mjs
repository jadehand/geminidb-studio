import assert from 'node:assert/strict'
import test from 'node:test'
import {
  batchLines,
  compileConstraints,
  createSeededRandom,
  encodeLineProtocol,
  iteratePlanLines,
} from './bulk-generator.mjs'

test('same seed creates byte-for-byte identical Line Protocol', () => {
  const plan = {
    targets: [{ date: '2026-07-26', measurement: 'cpu_1784995200', timestamps: [1784995200000] }],
    tags: [{ name: 'host', values: ['node-01', 'node-02'] }],
    fields: [{ name: 'value', type: 'float', generator: { kind: 'random-number', min: 1, max: 2 } }],
    constraints: [],
  }
  const first = [...iteratePlanLines(plan, 'seed-1')]
  const second = [...iteratePlanLines(plan, 'seed-1')]
  assert.deepEqual(first, second)
  assert.notDeepEqual(first, [...iteratePlanLines(plan, 'seed-2')])
})

test('encodes Influx Line Protocol escaping and preserves field types', () => {
  assert.equal(
    encodeLineProtocol({
      measurement: 'cpu load',
      tags: { host: 'node, 01' },
      fields: {
        count: { type: 'integer', value: 2 },
        ok: { type: 'boolean', value: true },
        note: { type: 'string', value: 'a"b' },
      },
      timestampMs: 1784995200000,
    }),
    'cpu\\ load,host=node\\,\\ 01 count=2i,ok=true,note="a\\"b" 1784995200000',
  )
})

test('generates supported field kinds in stable field and tag order', () => {
  const lines = [...iteratePlanLines({
    targets: [{ date: '2026-07-26', measurement: 'm', timestamps: [1, 2] }],
    tags: [{ name: 'region', values: ['a', 'b'] }, { name: 'host', values: ['n1', 'n2'] }],
    fields: [
      { name: 'fixedFloat', type: 'float', generator: { kind: 'fixed', value: 1.5 } },
      { name: 'incrementing', type: 'integer', generator: { kind: 'increment', start: 2, step: 3 } },
      { name: 'text', type: 'string', generator: { kind: 'string-list', values: ['a', 'b'] } },
      { name: 'flag', type: 'boolean', generator: { kind: 'random-boolean', truePercent: 100 } },
    ],
    constraints: [],
  }, 'stable')]

  assert.equal(lines.length, 8)
  assert.equal(lines[0], 'm,region=a,host=n1 fixedFloat=1.5,incrementing=2i,text="a",flag=true 1')
  assert.equal(lines[1], 'm,region=a,host=n2 fixedFloat=1.5,incrementing=5i,text="a",flag=true 1')
  assert.equal(lines[4], 'm,region=a,host=n1 fixedFloat=1.5,incrementing=14i,text="a",flag=true 2')
})

test('rejects invalid generator values before generation', () => {
  assert.throws(() => compileConstraints([
    { name: 'count', type: 'integer', generator: { kind: 'fixed', value: 1.5 } },
  ], []), /GENERATOR_INVALID/)
  assert.throws(() => compileConstraints([
    { name: 'value', type: 'float', generator: { kind: 'random-number', min: 0, max: Infinity } },
  ], []), /GENERATOR_INVALID/)
  assert.throws(() => compileConstraints([
    { name: 'ok', type: 'boolean', generator: { kind: 'random-boolean', truePercent: 101 } },
  ], []), /GENERATOR_INVALID/)
})

test('AND constraints generate in dependency order and satisfy each point', () => {
  const compiled = compileConstraints(
    [
      { name: 'ttft_avg', type: 'float', generator: { kind: 'random-number', min: 20, max: 60 } },
      { name: 'latency_avg', type: 'float', generator: { kind: 'random-number', min: 50, max: 120 } },
    ],
    [{ left: 'latency_avg', operator: '>', right: { kind: 'field', field: 'ttft_avg' } }],
  )
  for (let index = 0; index < 100; index += 1) {
    const values = compiled.generate(createSeededRandom(`seed-${index}`), index)
    assert.ok(values.latency_avg > values.ttft_avg)
  }
})

test('supports every numeric operator with integer strict-bound rounding', () => {
  const fields = [
    { name: 'source', type: 'integer', generator: { kind: 'fixed', value: 2 } },
    { name: 'target', type: 'integer', generator: { kind: 'random-number', min: 0, max: 4 } },
  ]
  for (const [operator, predicate] of [
    ['>', value => value > 2],
    ['>=', value => value >= 2],
    ['<', value => value < 2],
    ['<=', value => value <= 2],
    ['=', value => value === 2],
    ['!=', value => value !== 2],
  ]) {
    const compiled = compileConstraints(fields, [{ left: 'target', operator, right: { kind: 'field', field: 'source' } }])
    assert.ok(predicate(compiled.generate(createSeededRandom(operator), 0).target), operator)
  }
})

test('intersects numeric equality constraints independently of their order', () => {
  const fields = [{ name: 'x', type: 'integer', generator: { kind: 'random-number', min: 0, max: 10 } }]
  const first = [
    { left: 'x', operator: '=', right: { kind: 'fixed', value: 1 } },
    { left: 'x', operator: '=', right: { kind: 'fixed', value: 2 } },
  ]
  const second = [...first].reverse()
  for (const constraints of [first, second]) {
    assert.throws(() => compileConstraints(fields, constraints), /CONSTRAINT_UNSATISFIABLE/)
  }
  assert.throws(() => compileConstraints(fields, [
    { left: 'x', operator: '>', right: { kind: 'fixed', value: 1 } },
    { left: 'x', operator: '=', right: { kind: 'fixed', value: 1 } },
  ]), /CONSTRAINT_UNSATISFIABLE/)
})

test('fails closed when a float strict boundary leaves no representable value', () => {
  assert.throws(() => compileConstraints([
    { name: 'source', type: 'float', generator: { kind: 'fixed', value: 1 } },
    { name: 'target', type: 'float', generator: { kind: 'random-number', min: 1, max: 1 } },
  ], [{ left: 'target', operator: '>', right: { kind: 'field', field: 'source' } }]), /CONSTRAINT_UNSATISFIABLE/)
})

test('honors boolean probability and uses constrained singleton candidates deterministically', () => {
  const fields = [{ name: 'ok', type: 'boolean', generator: { kind: 'random-boolean', truePercent: 25 } }]
  const compiled = compileConstraints(fields, [])
  assert.equal(compiled.generate(() => 0.24, 0).ok, true)
  assert.equal(compiled.generate(() => 0.25, 0).ok, false)
  const constrained = compileConstraints(fields, [{ left: 'ok', operator: '=', right: { kind: 'fixed', value: true } }])
  assert.equal(constrained.generate(() => 0.99, 0).ok, true)
})

test('float uniform generation spans the entire feasible range', () => {
  const compiled = compileConstraints([
    { name: 'value', type: 'float', generator: { kind: 'random-number', min: 0, max: 100 } },
  ], [])
  assert.equal(compiled.generate(() => 0, 0).value, 0)
  assert.ok(compiled.generate(() => 0.999, 0).value > 99)
})

test('supports string and boolean equality / inequality constraints', () => {
  const stringFields = [
    { name: 'left', type: 'string', generator: { kind: 'fixed', value: 'a' } },
    { name: 'right', type: 'string', generator: { kind: 'string-list', values: ['a', 'b'] } },
  ]
  assert.equal(compileConstraints(stringFields, [{ left: 'right', operator: '=', right: { kind: 'field', field: 'left' } }])
    .generate(createSeededRandom('eq'), 0).right, 'a')
  assert.equal(compileConstraints(stringFields, [{ left: 'right', operator: '!=', right: { kind: 'field', field: 'left' } }])
    .generate(createSeededRandom('ne'), 0).right, 'b')

  const booleanFields = [
    { name: 'left', type: 'boolean', generator: { kind: 'fixed', value: true } },
    { name: 'right', type: 'boolean', generator: { kind: 'random-boolean', truePercent: 50 } },
  ]
  assert.equal(compileConstraints(booleanFields, [{ left: 'right', operator: '!=', right: { kind: 'field', field: 'left' } }])
    .generate(createSeededRandom('bool'), 0).right, false)
})

test('rejects cycles, self references, type mismatches, and empty feasible domains', () => {
  const numericFields = [
    { name: 'a', type: 'float', generator: { kind: 'random-number', min: 0, max: 10 } },
    { name: 'b', type: 'float', generator: { kind: 'random-number', min: 0, max: 10 } },
  ]
  assert.throws(() => compileConstraints(numericFields, [
    { left: 'a', operator: '>', right: { kind: 'field', field: 'b' } },
    { left: 'b', operator: '>=', right: { kind: 'field', field: 'a' } },
  ]), /CONSTRAINT_UNSATISFIABLE/)
  assert.throws(() => compileConstraints(numericFields, [
    { left: 'a', operator: '>', right: { kind: 'field', field: 'a' } },
  ]), /CONSTRAINT_UNSATISFIABLE/)
  assert.throws(() => compileConstraints([
    { name: 'a', type: 'string', generator: { kind: 'fixed', value: 'x' } },
    { name: 'b', type: 'boolean', generator: { kind: 'fixed', value: true } },
  ], [{ left: 'a', operator: '=', right: { kind: 'field', field: 'b' } }]), /CONSTRAINT_INVALID/)
  assert.throws(() => compileConstraints([
    { name: 'a', type: 'string', generator: { kind: 'fixed', value: 'x' } },
    { name: 'b', type: 'string', generator: { kind: 'string-list', values: ['x'] } },
  ], [{ left: 'b', operator: '!=', right: { kind: 'field', field: 'a' } }]), /CONSTRAINT_UNSATISFIABLE/)
})

test('batches lazily and enforces a positive batch size', () => {
  let produced = 0
  function* lines() {
    for (let index = 0; index < 2_005; index += 1) {
      produced += 1
      yield String(index)
    }
  }
  const batches = batchLines(lines(), 1_000)
  assert.equal(produced, 0)
  assert.equal(batches.next().value.length, 1_000)
  assert.equal(produced, 1_000)
  assert.equal(batches.next().value.length, 1_000)
  assert.equal(batches.next().value.length, 5)
  assert.throws(() => [...batchLines([], 0)], /positive integer/)
  assert.throws(() => [...batchLines([], 1_001)], /1000/)
})

test('rejects CR/LF in every user-controlled Line Protocol component', () => {
  const point = {
    measurement: 'cpu',
    tags: { host: 'node-01' },
    fields: { value: { type: 'string', value: 'ok' } },
    timestampMs: 1,
  }
  const invalidPoints = [
    { ...point, measurement: 'cpu\nother' },
    { ...point, tags: { 'host\r': 'node-01' } },
    { ...point, tags: { host: 'node\n01' } },
    { ...point, fields: { 'value\r': { type: 'string', value: 'ok' } } },
    { ...point, fields: { value: { type: 'string', value: 'bad\nvalue' } } },
  ]
  for (const invalidPoint of invalidPoints) assert.throws(() => encodeLineProtocol(invalidPoint), /CR\/LF/)
})
