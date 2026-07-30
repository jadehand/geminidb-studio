import test from 'node:test'
import assert from 'node:assert/strict'
import { createAgentTools } from './agent-tools.mjs'

const bridgeSession = Object.freeze({ environment:'test', readOnly:true, bulkIdentity:'bridge-1' })
const context = Object.freeze({
  agentSession:{ id:'agent-1', connectionId:'connection-1', database:'bound-db', retentionPolicy:'bound-rp' },
  run:{ id:'run-1' },
  signal:new AbortController().signal,
})

function fixture(overrides = {}) {
  const calls = []
  const influx = {
    async listDatabases(...args) { calls.push(['listDatabases', ...args]); return ['bound-db'] },
    async listMeasurements(...args) { calls.push(['listMeasurements', ...args]); return ['cpu', 'Memory'] },
    async getMeasurementSchema(...args) { calls.push(['getMeasurementSchema', ...args]); return { fields:[{ name:'usage' }], secret:'x' } },
    async influxQuery(...args) { calls.push(['influxQuery', ...args]); return { rows:[{ value:1 }], rowCount:1, durationMs:3 } },
    ...overrides,
  }
  return { calls, tools:createAgentTools({ influx, resolveSession:() => bridgeSession }) }
}

const jsonValue = value => JSON.parse(JSON.stringify(value))

test('publishes deeply frozen schemas backed by private validation rules', async () => {
  const { tools } = fixture()
  assert.deepEqual(tools.schemas.map(schema => schema.name), [
    'list_databases', 'list_measurements', 'get_schema', 'query_influxql', 'verify_data',
    'write_points', 'preview_bulk_data', 'create_bulk_job', 'get_bulk_job',
  ])
  for (const schema of tools.schemas) assert.equal(schema.input_schema.additionalProperties, false)
  assert.deepEqual(tools.schemas[0].input_schema.properties, {})
  assert.deepEqual(tools.schemas[1].input_schema.required, undefined)
  assert.deepEqual(tools.schemas[2].input_schema.required, ['measurement'])
  assert.deepEqual(tools.schemas[3].input_schema.required, ['sql'])
  assert.deepEqual(tools.schemas[4].input_schema.required, ['sql'])
  assert.equal(Object.isFrozen(tools.schemas), true)
  assert.equal(Object.isFrozen(tools.schemas[2].input_schema.required), true)
  assert.equal(Object.isFrozen(tools.schemas[3].input_schema.properties.sql), true)
  assert.throws(() => { tools.schemas[3].input_schema.properties.sql.maxLength = 1 }, TypeError)
  assert.throws(() => { tools.schemas[3].input_schema.properties.extra = { type:'string' } }, TypeError)
  await assert.doesNotReject(tools.execute('query_influxql', { sql:'SELECT 1' }, context))
})

test('writes at most 1000 non-empty points to the bound database and retention policy', async () => {
  const calls = []
  const tools = createAgentTools({
    influx:{
      async influxWrite(...args) {
        calls.push(args)
        return { affectedRows:args[2].split('\n').length, durationMs:7, message:'secret body' }
      },
    },
    resolveSession:() => ({ ...bridgeSession, readOnly:false }),
  })
  const lines = ['cpu,host=a usage=1 1', 'cpu,host=b usage=2 2']
  assert.deepEqual(jsonValue(await tools.execute('write_points', { lines }, context)), {
    pointCount:2, durationMs:7,
  })
  assert.equal(calls[0][1], 'bound-db')
  assert.equal(calls[0][2], lines.join('\n'))
  assert.deepEqual(calls[0][3], {
    retentionPolicy:'bound-rp', precision:'ms', signal:context.signal,
  })
  assert.equal(JSON.stringify(await tools.execute('write_points', { lines:['cpu value=1 1'] }, context)).includes('cpu value'), false)
})

test('rejects excessive, empty, oversized, or context-overriding direct writes', async () => {
  const tools = createAgentTools({
    influx:{ influxWrite:async () => ({ affectedRows:1, durationMs:1 }) },
    resolveSession:() => ({ ...bridgeSession, readOnly:false }),
  })
  for (const input of [
    { lines:Array.from({ length:1_001 }, () => 'cpu value=1 1') },
    { lines:['cpu value=1 1', ' '] },
    { lines:['x'.repeat(2 * 1024 * 1024 + 1)] },
    { lines:['cpu value=1 1'], database:'evil' },
    { lines:['cpu value=1 1'], retentionPolicy:'evil' },
  ]) {
    await assert.rejects(tools.execute('write_points', input, context),
      error => error.code === 'AGENT_TOOL_INPUT_INVALID')
  }
})

test('write tools deny read-only, production, and unknown environments', async () => {
  for (const session of [
    bridgeSession,
    { ...bridgeSession, readOnly:false, environment:'prod' },
    { ...bridgeSession, readOnly:false, environment:'staging' },
  ]) {
    const tools = createAgentTools({ influx:{}, resolveSession:() => session })
    await assert.rejects(tools.execute('write_points', { lines:['cpu value=1 1'] }, context),
      error => error.code === 'AGENT_POLICY_DENIED')
  }
})

test('bulk tools reuse the bulk API and bind previews to the current session and run', async () => {
  const calls = []
  const bulkApi = {
    async handle(request) {
      calls.push(request)
      if (request.pathname === '/bulk-jobs/preview') {
        return {
          status:200,
          body:{
            previewId:'preview-1', expiresAt:99_000,
            requiredAcknowledgements:['acknowledgeCreate', 'acknowledgeOverwrite'],
            pointCount:20, samples:[],
          },
        }
      }
      if (request.method === 'POST') return { status:200, body:{ id:'job-1', status:'running' } }
      return { status:200, body:{ id:'job-1', status:'succeeded' } }
    },
  }
  const tools = createAgentTools({
    influx:{},
    bulkApi,
    now:() => 1_000,
    resolveSession:() => ({ ...bridgeSession, readOnly:false }),
  })
  const preview = await tools.execute('preview_bulk_data', {
    prefix:'cpu', sourceMeasurement:'cpu_source', dates:['2026-07-26'],
    startTime:'00:00:00', endTime:'00:00:19', intervalSeconds:1,
    tags:[{ name:'host', values:['node-01'] }],
    fields:[{ name:'usage', generator:{ kind:'random-number', min:0, max:100 } }],
    constraints:[],
  }, context)
  assert.equal(preview.previewId, 'preview-1')
  assert.equal(calls[0].payload.database, 'bound-db')
  assert.equal(calls[0].payload.retentionPolicy, 'bound-rp')

  await assert.rejects(
    tools.execute('create_bulk_job', { previewId:'preview-1', acknowledgeCreate:true }, context),
    error => error.code === 'AGENT_TOOL_INPUT_INVALID',
  )
  await assert.rejects(
    tools.execute('create_bulk_job', { previewId:'preview-1' }, { ...context, run:{ id:'run-2' } }),
    error => error.code === 'AGENT_POLICY_DENIED',
  )
  assert.deepEqual(jsonValue(await tools.execute('create_bulk_job', { previewId:'preview-1' }, context)), {
    id:'job-1', status:'running',
  })
  assert.deepEqual(calls[1].payload, {
    previewId:'preview-1', database:'bound-db',
    acknowledgeCreate:true, acknowledgeOverwrite:true,
  })
  assert.deepEqual(jsonValue(await tools.execute('get_bulk_job', { jobId:'job-1' }, context)), {
    id:'job-1', status:'succeeded',
  })
  assert.equal(calls[2].pathname, '/bulk-jobs/job-1')
})

test('bulk preview preserves existing bulk authorization failures', async () => {
  for (const [session, code] of [
    [{ ...bridgeSession, environment:'dev' }, 'BULK_TEST_CONNECTION_REQUIRED'],
    [{ ...bridgeSession, environment:'test', readOnly:true }, 'BULK_WRITE_CONNECTION_REQUIRED'],
  ]) {
    const tools = createAgentTools({
      influx:{},
      resolveSession:() => session,
      bulkApi:{ handle:async () => ({ status:403, body:{ code, message:'denied' } }) },
    })
    await assert.rejects(tools.execute('preview_bulk_data', {
      prefix:'cpu', sourceMeasurement:'cpu_source', dates:['2026-07-26'],
      startTime:'00:00:00', endTime:'00:00:19', intervalSeconds:1,
      tags:[], fields:[], constraints:[],
    }, context), error => error.code === code)
  }
})

test('maps list and schema tools to the bound database', async () => {
  const { tools, calls } = fixture()
  assert.deepEqual(jsonValue(await tools.execute('list_databases', {}, context)), { items:['bound-db'], truncated:false, totalCount:1 })
  assert.deepEqual(jsonValue(await tools.execute('list_measurements', { filter:'mem' }, context)), { items:['Memory'], truncated:false, totalCount:1 })
  assert.deepEqual(jsonValue(await tools.execute('get_schema', { measurement:'cpu' }, context)), {
    fields:[{ name:'usage' }], tags:[], secret:'[REDACTED]', truncated:{ fields:false, tags:false },
  })
  assert.deepEqual(calls, [
    ['listDatabases', bridgeSession],
    ['listMeasurements', bridgeSession, 'bound-db'],
    ['getMeasurementSchema', bridgeSession, 'bound-db', 'cpu'],
  ])
})

test('resolves the persisted connectionId field', async () => {
  let identity
  const tools = createAgentTools({
    influx:{ listDatabases:async () => [] },
    resolveSession:value => { identity = value; return bridgeSession },
  })
  await tools.execute('list_databases', {}, context)
  assert.equal(identity, 'connection-1')
})

test('query and verify use read-only SQL, signal, and normalized result', async () => {
  const { tools, calls } = fixture()
  for (const name of ['query_influxql', 'verify_data']) {
    assert.deepEqual(jsonValue(await tools.execute(name, { sql:'SELECT * FROM cpu' }, context)), {
      database:'bound-db', rows:[{ value:1 }], rowCount:1, durationMs:3, truncated:false,
    })
  }
  assert.deepEqual(calls[0].slice(0, 4), ['influxQuery', bridgeSession, 'bound-db', 'SELECT * FROM cpu'])
  assert.equal(calls[0][4].signal, context.signal)
})

test('caps query rows and recursively redacts sensitive keys', async () => {
  const rows = Array.from({ length:1_050 }, (_, index) => ({ index, nested:{ token:`t-${index}` } }))
  const { tools } = fixture({ influxQuery:async () => ({ rows, rowCount:1_050, durationMs:12 }) })
  const result = await tools.execute('query_influxql', { sql:'SHOW MEASUREMENTS' }, context)
  assert.equal(result.rows.length, 1_000)
  assert.equal(result.rowCount, 1_050)
  assert.equal(result.truncated, true)
  assert.equal(result.rows[0].nested.token, '[REDACTED]')
})

test('strictly rejects malformed and malicious model input', async () => {
  const { tools } = fixture()
  for (const input of [null, [], { sql:'SELECT 1', database:'evil' }, { endpoint:'evil' }, { filter:1 }]) {
    await assert.rejects(tools.execute('query_influxql', input, context), error => error.code === 'AGENT_TOOL_INPUT_INVALID')
  }
  await assert.rejects(tools.execute('get_schema', {}, context), error => error.code === 'AGENT_TOOL_INPUT_INVALID')

  let getterCalled = false
  const accessor = {}
  Object.defineProperty(accessor, 'sql', { enumerable:true, get() { getterCalled = true; return 'SELECT 1' } })
  await assert.rejects(tools.execute('query_influxql', accessor, context), error => error.code === 'AGENT_TOOL_INPUT_INVALID')
  assert.equal(getterCalled, false)

  const hidden = {}
  Object.defineProperty(hidden, 'sql', { enumerable:false, value:'SELECT 1' })
  await assert.rejects(tools.execute('query_influxql', hidden, context), error => error.code === 'AGENT_TOOL_INPUT_INVALID')
  await assert.rejects(tools.execute('list_databases', { [Symbol('field')]:1 }, context), error => error.code === 'AGENT_TOOL_INPUT_INVALID')
  await assert.rejects(tools.execute('list_databases', Object.create({ inherited:true }), context), error => error.code === 'AGENT_TOOL_INPUT_INVALID')
})

test('rejects unsafe, excessive, and non-JSON Influx output without invoking getters', async () => {
  let deep = {}
  for (let index = 0; index < 21; index++) deep = { child:deep }
  let getterCalled = false
  const accessor = {}
  Object.defineProperty(accessor, 'value', { enumerable:true, get() { getterCalled = true; return 1 } })
  class Result { constructor() { this.value = 1 } }

  for (const row of [deep, new Result(), accessor]) {
    const { tools } = fixture({ influxQuery:async () => ({ rows:[row] }) })
    await assert.rejects(tools.execute('query_influxql', { sql:'SELECT 1' }, context),
      error => error.status === 502 && error.code === 'AGENT_TOOL_OUTPUT_INVALID')
  }
  assert.equal(getterCalled, false)

  for (const key of ['__proto__', 'constructor', 'prototype']) {
    const row = JSON.parse(`{"${key}":{"token":"secret"}}`)
    const { tools } = fixture({ influxQuery:async () => ({ rows:[row] }) })
    const result = await tools.execute('query_influxql', { sql:'SELECT 1' }, context)
    assert.equal(Object.getPrototypeOf(result.rows[0]), null)
    assert.equal(Object.hasOwn(result.rows[0], key), true)
    assert.equal(result.rows[0][key].token, '[REDACTED]')
  }

  for (const output of ['rows', 'list']) {
    let indexGetterCalled = false
    const accessorArray = []
    Object.defineProperty(accessorArray, '0', {
      enumerable:true,
      get() { indexGetterCalled = true; return output === 'rows' ? {} : 'cpu' },
    })
    const { tools } = output === 'rows'
      ? fixture({ influxQuery:async () => ({ rows:accessorArray }) })
      : fixture({ listMeasurements:async () => accessorArray })
    const execution = output === 'rows'
      ? tools.execute('query_influxql', { sql:'SELECT 1' }, context)
      : tools.execute('list_measurements', { filter:'cpu' }, context)
    await assert.rejects(execution, error => error.code === 'AGENT_TOOL_OUTPUT_INVALID')
    assert.equal(indexGetterCalled, false)
  }

  const rows = Array.from({ length:1_000 }, () => Array.from({ length:51 }, () => 1))
  const { tools } = fixture({ influxQuery:async () => ({ rows }) })
  await assert.rejects(tools.execute('query_influxql', { sql:'SELECT 1' }, context),
    error => error.code === 'AGENT_TOOL_OUTPUT_INVALID')
})

test('validates and caps list and schema output', async () => {
  const tooMany = Array.from({ length:10_005 }, (_, index) => `item-${index}`)
  const { tools } = fixture({
    listDatabases:async () => tooMany,
    getMeasurementSchema:async () => ({ fields:tooMany, tags:tooMany, password:'secret' }),
  })
  assert.deepEqual(await tools.execute('list_databases', {}, context).then(({ items, truncated, totalCount }) => ({
    length:items.length, truncated, totalCount,
  })), { length:10_000, truncated:true, totalCount:10_005 })
  const schema = await tools.execute('get_schema', { measurement:'cpu' }, context)
  assert.equal(schema.fields.length, 10_000)
  assert.equal(schema.tags.length, 10_000)
  assert.deepEqual(jsonValue(schema.truncated), { fields:true, tags:true })
  assert.equal(schema.password, '[REDACTED]')

  const nonArray = fixture({ listMeasurements:async () => ({ cpu:true }) }).tools
  await assert.rejects(nonArray.execute('list_measurements', {}, context),
    error => error.code === 'AGENT_TOOL_OUTPUT_INVALID')

  let getterCalled = false
  const accessorList = []
  Object.defineProperty(accessorList, '0', { enumerable:true, get() { getterCalled = true; return 'cpu' } })
  const unsafe = fixture({ listDatabases:async () => accessorList }).tools
  await assert.rejects(unsafe.execute('list_databases', {}, context),
    error => error.code === 'AGENT_TOOL_OUTPUT_INVALID')
  assert.equal(getterCalled, false)
})

test('rejects unknown tools, unsafe environments, SQL mutations, and expired sessions', async () => {
  const { tools } = fixture()
  await assert.rejects(tools.execute('nope', {}, context), error => error.code === 'AGENT_TOOL_UNKNOWN')
  await assert.rejects(tools.execute('query_influxql', { sql:'SELECT * FROM cpu; DROP MEASUREMENT cpu' }, context), error => error.code === 'AGENT_POLICY_DENIED')
  const prod = createAgentTools({ influx:{}, resolveSession:() => ({ environment:'prod', readOnly:true }) })
  await assert.rejects(prod.execute('list_databases', {}, context), error => error.code === 'AGENT_POLICY_DENIED')
  const unknown = createAgentTools({ influx:{}, resolveSession:() => ({ environment:'staging', readOnly:true }) })
  await assert.rejects(unknown.execute('list_databases', {}, context), error => error.code === 'AGENT_POLICY_DENIED')
  const expired = createAgentTools({ influx:{}, resolveSession:() => undefined })
  await assert.rejects(expired.execute('list_databases', {}, context), error => error.code === 'SESSION_REQUIRED')
})
