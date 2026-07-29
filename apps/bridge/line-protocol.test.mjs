import assert from 'node:assert/strict'
import test from 'node:test'
import { encodeLineProtocolPoint } from './line-protocol.mjs'

function assertError(fn, message) {
  assert.throws(fn, error => {
    assert.equal(error.code, 'LINE_PROTOCOL_INVALID')
    assert.equal(error.message, `LINE_PROTOCOL_INVALID: ${message}`)
    return true
  })
}

test('preserves exact nanosecond timestamp strings', () => {
  assert.equal(
    encodeLineProtocolPoint({
      measurement: 'cpu load',
      tags: { host: 'node 1' },
      fields: {
        count: { type: 'integer', value: 2 },
        ok: { type: 'boolean', value: true },
        note: { type: 'string', value: 'a"b' },
      },
      timestamp: '1784995200123456789',
      precision: 'ns',
    }),
    'cpu\\ load,host=node\\ 1 count=2i,ok=true,note="a\\"b" 1784995200123456789',
  )
})

test('encodes safe millisecond timestamps with all field types and identifier escaping', () => {
  assert.equal(
    encodeLineProtocolPoint({
      measurement: 'cpu, load=x',
      tags: { 'host=name': 'node, 1' },
      fields: {
        'int key': { type: 'integer', value: -2 },
        float: { type: 'float', value: 1.5 },
        text: { type: 'string', value: 'a\\b"c' },
        ok: { type: 'boolean', value: false },
      },
      timestamp: 1_784_995_200_000,
      precision: 'ms',
    }),
    'cpu\\,\\ load\\=x,host\\=name=node\\,\\ 1 int\\ key=-2i,float=1.5,text="a\\\\b\\"c",ok=false 1784995200000',
  )
})

test('rejects line breaks in every Line Protocol component', () => {
  const point = {
    measurement: 'cpu',
    tags: { host: 'node-01' },
    fields: { value: { type: 'string', value: 'ok' } },
    timestamp: 1,
    precision: 'ms',
  }
  const invalidPoints = [
    { ...point, measurement: 'cpu\nother' },
    { ...point, tags: { 'host\r': 'node-01' } },
    { ...point, tags: { host: 'node\n01' } },
    { ...point, fields: { 'value\r': { type: 'string', value: 'ok' } } },
    { ...point, fields: { value: { type: 'string', value: 'bad\nvalue' } } },
  ]
  for (const invalidPoint of invalidPoints) assert.throws(() => encodeLineProtocolPoint(invalidPoint), /CR\/LF/)
})

test('rejects empty fields and invalid field values', () => {
  const point = {
    measurement: 'cpu',
    tags: {},
    fields: { value: { type: 'integer', value: 1 } },
    timestamp: 1,
    precision: 'ms',
  }
  assert.throws(() => encodeLineProtocolPoint({ ...point, fields: {} }), /at least one field/)
  assert.throws(() => encodeLineProtocolPoint({ ...point, fields: { value: { type: 'integer', value: 1.5 } } }), /safe integer/)
})

test('rejects unsafe millisecond timestamps and invalid nanosecond strings', () => {
  const point = {
    measurement: 'cpu',
    tags: {},
    fields: { value: { type: 'float', value: 1 } },
  }
  assert.throws(() => encodeLineProtocolPoint({ ...point, timestamp: Number.MAX_SAFE_INTEGER + 1, precision: 'ms' }), /safe integer/)
  for (const timestamp of ['', '1784995200123456789.0', '1784995200123456789n', 1784995200123456789]) {
    assert.throws(() => encodeLineProtocolPoint({ ...point, timestamp, precision: 'ns' }), /decimal string/)
  }
})

test('rejects invalid typed field values and precision with line protocol errors', () => {
  const point = {
    measurement: 'cpu',
    tags: {},
    fields: { value: { type: 'float', value: 1 } },
    timestamp: 1,
    precision: 'ms',
  }
  for (const value of [NaN, Infinity, -Infinity]) {
    assertError(
      () => encodeLineProtocolPoint({ ...point, fields: { value: { type: 'float', value } } }),
      'field value must be finite',
    )
  }
  assertError(
    () => encodeLineProtocolPoint({ ...point, fields: { value: { type: 'string', value: true } } }),
    'field value must be a string',
  )
  assertError(
    () => encodeLineProtocolPoint({ ...point, fields: { value: { type: 'boolean', value: 'true' } } }),
    'field value must be a boolean',
  )
  assertError(() => encodeLineProtocolPoint({ ...point, precision: 'us' }), 'precision must be ms or ns')
})
