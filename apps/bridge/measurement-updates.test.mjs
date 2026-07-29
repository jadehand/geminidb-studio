import assert from 'node:assert/strict'
import test from 'node:test'
import { executeMeasurementUpdates, normalizePointUpdate } from './measurement-updates.mjs'

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
