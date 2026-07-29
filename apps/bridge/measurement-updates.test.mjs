import assert from 'node:assert/strict'
import test from 'node:test'
import { executeMeasurementUpdates, handleMeasurementUpdatesRequest, normalizePointUpdate } from './measurement-updates.mjs'

const schema = {
  tags:['host', 'region'],
  fields:[
    { name:'temperature', type:'float' },
    { name:'count', type:'integer' },
    { name:'status', type:'string' },
    { name:'active', type:'boolean' },
  ],
}

const point = {
  id:'point-1',
  timestampNs:'1784995200123456789',
  tags:{ host:'node1', region:'cn-east' },
  fields:{ temperature:27.5 },
}

function assertInvalid(update, message) {
  assert.throws(
    () => normalizePointUpdate(update, schema),
    error => error.code === 'MEASUREMENT_UPDATE_INVALID' && error.status === 400 && error.message === message,
  )
}

test('accepts a missing schema-defined field and keeps exact point identity', () => {
  assert.deepEqual(normalizePointUpdate(point, schema), {
    timestampNs:'1784995200123456789',
    tags:{ host:'node1', region:'cn-east' },
    fields:{ temperature:{ type:'float', value:27.5 } },
  })
})

test('preserves own __proto__ tag and field properties without changing object prototypes', () => {
  const specialSchema = {
    tags:['__proto__'],
    fields:[{ name:'__proto__', type:'string' }],
  }
  const specialUpdate = JSON.parse('{"id":"special-point","timestampNs":"1784995200123456789","tags":{"__proto__":"tag-value"},"fields":{"__proto__":"field-value"}}')

  const normalized = normalizePointUpdate(specialUpdate, specialSchema)

  assert.equal(Object.getPrototypeOf(normalized.tags), Object.prototype)
  assert.equal(Object.getPrototypeOf(normalized.fields), Object.prototype)
  assert.equal(Object.hasOwn(normalized.tags, '__proto__'), true)
  assert.equal(Object.hasOwn(normalized.fields, '__proto__'), true)
  assert.equal(normalized.tags.__proto__, 'tag-value')
  assert.deepEqual(normalized.fields.__proto__, { type:'string', value:'field-value' })
})

test('writes own __proto__ tag and field keys in Line Protocol', async () => {
  const writes = []
  const specialSchema = {
    tags:['__proto__'],
    fields:[{ name:'__proto__', type:'string' }],
  }
  const specialUpdate = Object.fromEntries([
    ['id', 'special-point'],
    ['timestampNs', '1784995200123456789'],
    ['tags', Object.fromEntries([['__proto__', 'tag-value']])],
    ['fields', Object.fromEntries([['__proto__', 'field-value']])],
  ])

  await executeMeasurementUpdates({
    session:{ environment:'dev' },
    database:'metrics',
    measurement:'cpu',
    updates:[specialUpdate],
    loadSchema:async () => specialSchema,
    writePoint:async line => writes.push(line),
  })

  assert.deepEqual(writes, ['cpu,__proto__=tag-value __proto__="field-value" 1784995200123456789'])
})

test('rejects point updates that do not preserve the complete tag identity', () => {
  assertInvalid({ ...point, tags:{ host:'node1' } }, 'tags must include every schema tag exactly once')
  assertInvalid({ ...point, tags:{ host:'node1', region:'cn-east', zone:'a' } }, 'tags must include every schema tag exactly once')
  assertInvalid({ ...point, tags:{ host:1, region:'cn-east' } }, 'tag host must be a string')
})

test('rejects timestamps that are not exact decimal strings', () => {
  for (const timestampNs of ['', '1784995200123456789.0', '1784995200123456789n', 1784995200123456789]) {
    assertInvalid({ ...point, timestampNs }, 'timestampNs must be a decimal string')
  }
})

test('rejects updates that change the route-level measurement', () => {
  assertInvalid({ ...point, measurement:'other_measurement' }, 'measurement must be specified by the request')
})

test('rejects unknown, empty, null, and incorrectly typed fields', () => {
  assertInvalid({ ...point, fields:{} }, 'fields must contain at least one changed field')
  assertInvalid({ ...point, fields:{ unknown:1 } }, 'field unknown is not defined by the measurement schema')
  assertInvalid({ ...point, fields:{ temperature:null } }, 'field temperature cannot be null')
  assertInvalid({ ...point, fields:{ temperature:'27.5' } }, 'field temperature must be a finite number')
  assertInvalid({ ...point, fields:{ count:1.5 } }, 'field count must be a safe integer')
  assertInvalid({ ...point, fields:{ status:true } }, 'field status must be a string')
  assertInvalid({ ...point, fields:{ active:'true' } }, 'field active must be a boolean')
})

test('rejects production sessions before loading schema or writing', async () => {
  let loaded = false
  await assert.rejects(
    executeMeasurementUpdates({
      session:{ environment:'prod' },
      database:'metrics',
      measurement:'cpu',
      updates:[point],
      loadSchema:async () => { loaded = true; return schema },
      writePoint:async () => assert.fail('writePoint must not be called'),
    }),
    error => error.code === 'PRODUCTION_READ_ONLY' && error.status === 403,
  )
  assert.equal(loaded, false)
})

test('normalizes every update before the first write', async () => {
  let writes = 0
  await assert.rejects(
    executeMeasurementUpdates({
      session:{ environment:'dev' },
      database:'metrics',
      measurement:'cpu',
      updates:[point, { ...point, id:'point-2', fields:{ count:1.5 } }],
      loadSchema:async () => schema,
      writePoint:async () => { writes++ },
    }),
    error => error.code === 'MEASUREMENT_UPDATE_INVALID' && error.message === 'field count must be a safe integer',
  )
  assert.equal(writes, 0)
})

test('rejects malformed update bodies before any write', async () => {
  let writes = 0
  await assert.rejects(
    executeMeasurementUpdates({
      session:{ environment:'dev' },
      database:'metrics',
      measurement:'cpu',
      updates:[point, null],
      loadSchema:async () => schema,
      writePoint:async () => { writes++ },
    }),
    error => error.code === 'MEASUREMENT_UPDATE_INVALID' && error.status === 400 && error.message === 'update must be an object',
  )
  assert.equal(writes, 0)
})

test('writes changed fields together and stops after the first write failure', async () => {
  const writes = []
  let schemaLoads = 0
  const result = await executeMeasurementUpdates({
    session:{ environment:'dev' },
    database:'metrics',
    measurement:'cpu',
    updates:[
      { ...point, id:'point-1', fields:{ temperature:27.5, active:true } },
      { ...point, id:'point-2', fields:{ count:2 } },
      { ...point, id:'point-3', fields:{ status:'skipped' } },
    ],
    loadSchema:async () => { schemaLoads++; return schema },
    writePoint:async line => {
      writes.push(line)
      if (writes.length === 2) throw new Error('write failed')
    },
  })

  assert.equal(schemaLoads, 1)
  assert.deepEqual(writes, [
    'cpu,host=node1,region=cn-east temperature=27.5,active=true 1784995200123456789',
    'cpu,host=node1,region=cn-east count=2i 1784995200123456789',
  ])
  assert.deepEqual(result, {
    summary:{ total:3, succeeded:1, failed:1, skipped:1 },
    succeededIds:['point-1'],
    failed:{ id:'point-2', index:1, message:'point write failed' },
  })
})

test('route handler blocks production before loading schema or writing', async () => {
  let schemaCalls = 0
  let writeCalls = 0
  await assert.rejects(
    handleMeasurementUpdatesRequest({
      session:{ environment:'prod' },
      body:{ database:'metrics', measurement:'cpu', updates:[point] },
      getMeasurementSchema:async () => { schemaCalls++; return schema },
      influxWrite:async () => { writeCalls++ },
    }),
    error => error.code === 'PRODUCTION_READ_ONLY' && error.status === 403,
  )
  assert.equal(schemaCalls, 0)
  assert.equal(writeCalls, 0)
})

test('route handler passes route-level target and nanosecond write precision', async () => {
  const session = { environment:'dev' }
  const schemaCalls = []
  const writes = []
  const result = await handleMeasurementUpdatesRequest({
    session,
    body:{ database:'metrics', measurement:'cpu', updates:[{ ...point, id:'route-point' }] },
    getMeasurementSchema:async (...args) => { schemaCalls.push(args); return schema },
    influxWrite:async (...args) => writes.push(args),
  })

  assert.deepEqual(schemaCalls, [[session, 'metrics', 'cpu']])
  assert.deepEqual(writes, [[
    session,
    'metrics',
    'cpu,host=node1,region=cn-east temperature=27.5 1784995200123456789',
    { precision:'ns' },
  ]])
  assert.deepEqual(result, {
    summary:{ total:1, succeeded:1, failed:0, skipped:0 },
    succeededIds:['route-point'],
    failed:null,
  })
})

test('route handler rejects an update-level measurement without writing', async () => {
  let writes = 0
  await assert.rejects(
    handleMeasurementUpdatesRequest({
      session:{ environment:'dev' },
      body:{ database:'metrics', measurement:'cpu', updates:[{ ...point, measurement:'other' }] },
      getMeasurementSchema:async () => schema,
      influxWrite:async () => { writes++ },
    }),
    error => error.code === 'MEASUREMENT_UPDATE_INVALID' && error.status === 400 && error.message === 'measurement must be specified by the request',
  )
  assert.equal(writes, 0)
})

test('route handler rejects missing or empty update ids without writing', async () => {
  for (const id of [undefined, '']) {
    let writes = 0
    await assert.rejects(
      handleMeasurementUpdatesRequest({
        session:{ environment:'dev' },
        body:{ database:'metrics', measurement:'cpu', updates:[{ ...point, id }] },
        getMeasurementSchema:async () => schema,
        influxWrite:async () => { writes++ },
      }),
      error => error.code === 'MEASUREMENT_UPDATE_INVALID' && error.status === 400 && error.message === 'update id must be a non-empty string',
    )
    assert.equal(writes, 0)
  }
})

test('route handler maps an invalid measurement schema to a stable upstream error', async () => {
  await assert.rejects(
    handleMeasurementUpdatesRequest({
      session:{ environment:'dev' },
      body:{ database:'metrics', measurement:'cpu', updates:[point] },
      getMeasurementSchema:async () => ({ tags:['host'], fields:[{ name:'temperature', type:'unsupported' }] }),
      influxWrite:async () => assert.fail('unexpected write'),
    }),
    error => error.code === 'MEASUREMENT_SCHEMA_INVALID' && error.status === 502 && error.message === 'measurement schema is invalid',
  )
})

test('route handler maps CR/LF Line Protocol values to stable update errors', async () => {
  const invalidBodies = [
    { database:'metrics', measurement:'cpu\nunsafe', updates:[point] },
    { database:'metrics', measurement:'cpu', updates:[{ ...point, tags:{ host:'node1\runsafe', region:'cn-east' } }] },
    { database:'metrics', measurement:'cpu', updates:[{ ...point, fields:{ status:'unsafe\nvalue' } }] },
  ]

  for (const body of invalidBodies) {
    let writes = 0
    await assert.rejects(
      handleMeasurementUpdatesRequest({
        session:{ environment:'dev' },
        body,
        getMeasurementSchema:async () => schema,
        influxWrite:async () => { writes++ },
      }),
      error => error.code === 'MEASUREMENT_UPDATE_INVALID' && error.status === 400 && error.message === 'point contains an invalid line protocol value',
    )
    assert.equal(writes, 0)
  }
})
