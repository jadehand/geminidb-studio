import assert from 'node:assert/strict'
import test from 'node:test'
import { createBulkApi } from './bulk-api.mjs'

const session = Object.freeze({ endpoint:'http://127.0.0.1:8635', username:'rwuser', environment:'test', readOnly:false })

function planInput(overrides = {}) {
  return {
    database:'monitoring', prefix:'cpu', sourceMeasurement:'cpu_source', retentionPolicy:'autogen',
    dates:['2026-07-26'], startTime:'00:00:00', endTime:'00:00:19', intervalSeconds:1,
    tags:[{ name:'host', values:['node-01'] }],
    fields:[{ name:'usage', generator:{ kind:'random-number', min:0, max:100 } }],
    constraints:[], ...overrides,
  }
}

function fixture({ now = () => 1_000, tables = ['cpu_source'], policies = [{ name:'autogen', durationMs:0, isDefault:true }], schemas = {} } = {}) {
  const jobs = new Map()
  const jobManager = {
    start(input) { const job = { id:input.id, connectionIdentity:input.connectionIdentity, status:'running' }; jobs.set(job.id, job); return job },
    active() { return [...jobs.values()].find(job => job.status === 'running') ?? null },
    get(id) { return jobs.get(id) ?? null },
    resume(id) { const job = jobs.get(id); if (!job) throw Object.assign(new Error('missing'), { code:'BULK_JOB_NOT_PAUSED' }); job.status = 'running'; return job },
    async cancel(id) { const job = jobs.get(id); if (!job) return null; job.status = 'cancelled'; return job },
  }
  const sourceSchema = { tags:['host'], fields:[{ name:'usage', type:'float' }] }
  const influx = {
    async listMeasurements() { return tables },
    async listRetentionPolicies() { return policies },
    async getMeasurementSchema(_session, _database, measurement) { return schemas[measurement] ?? sourceSchema },
  }
  let id = 0
  return { api:createBulkApi({ jobManager, influx, now, randomUUID:() => `id-${++id}` }), jobManager, influx }
}

async function request(api, method, pathname, payload, current = session) {
  return api.handle({ method, pathname, searchParams:new URLSearchParams(), session:current, payload })
}

test('preview blocks non-test and read-only sessions with stable codes', async () => {
  const { api } = fixture()
  for (const [current, code] of [
    [{ ...session, environment:'prod' }, 'BULK_TEST_CONNECTION_REQUIRED'],
    [{ ...session, environment:'dev' }, 'BULK_TEST_CONNECTION_REQUIRED'],
    [{ ...session, environment:undefined }, 'BULK_TEST_CONNECTION_REQUIRED'],
    [{ ...session, readOnly:true }, 'BULK_WRITE_CONNECTION_REQUIRED'],
  ]) {
    const result = await request(api, 'POST', '/bulk-jobs/preview', planInput(), current)
    assert.equal(result.status, 403)
    assert.equal(result.body.code, code)
  }
})

test('preview returns only twenty stable samples, estimate, warnings, and opaque expiry', async () => {
  const { api } = fixture()
  const first = await request(api, 'POST', '/bulk-jobs/preview', planInput())
  assert.equal(first.status, 200)
  assert.equal(first.body.samples.length, 20)
  assert.equal(first.body.samples[0].lineProtocol.includes('cpu_1784995200'), true)
  assert.equal(first.body.pointCount, 20)
  assert.equal(first.body.previewId, 'id-1')
  assert.equal(first.body.expiresAt, 901_000)
  assert.equal('seed' in first.body, false)
  assert.equal('lineProtocol' in first.body, false)
  assert.equal(first.body.samples.some(sample => sample.lineProtocol.includes('id-1')), false)
})

test('preview maps plan, RP and schema blockers to BULK_PLAN_INVALID', async () => {
  const tooManyPoints = fixture({ schemas:{ cpu_source:{ tags:['host', 'region'], fields:[{ name:'usage', type:'float' }] } } })
  const invalid = await request(tooManyPoints.api, 'POST', '/bulk-jobs/preview', planInput({
    endTime:'23:59:59',
    schema:{ tags:['host', 'region'], fields:[{ name:'usage', type:'float' }] },
    tags:[{ name:'host', values:['n1', 'n2'] }, { name:'region', values:['r1', 'r2'] }],
  }))
  assert.equal(invalid.status, 422)
  assert.equal(invalid.body.code, 'BULK_PLAN_INVALID')
  const noRp = fixture({ policies:[] })
  const rp = await request(noRp.api, 'POST', '/bulk-jobs/preview', planInput())
  assert.equal(rp.status, 422)
  assert.equal(rp.body.code, 'BULK_PLAN_INVALID')
  const typeConflict = fixture({ tables:['cpu_source', 'cpu_1784995200'], schemas:{ cpu_1784995200:{ tags:['host'], fields:[{ name:'usage', type:'integer' }] } } })
  const schema = await request(typeConflict.api, 'POST', '/bulk-jobs/preview', planInput())
  assert.equal(schema.status, 422)
  assert.equal(schema.body.code, 'BULK_PLAN_INVALID')
})

test('creation revalidates preview and control routes enforce connection identity', async () => {
  let clock = 1_000
  const { api, influx } = fixture({ now:() => clock })
  const preview = await request(api, 'POST', '/bulk-jobs/preview', planInput())
  assert.equal((await request(api, 'POST', '/bulk-jobs', { previewId:preview.body.previewId })).status, 409)
  assert.equal((await request(api, 'POST', '/bulk-jobs', { previewId:preview.body.previewId, acknowledgeCreate:true })).status, 200)
  const started = await request(api, 'POST', '/bulk-jobs', { previewId:preview.body.previewId, acknowledgeCreate:true })
  assert.equal(started.body.code, 'BULK_PREVIEW_REQUIRED')

  const fresh = await request(api, 'POST', '/bulk-jobs/preview', planInput())
  const oldSession = { ...session, username:'other' }
  assert.equal((await request(api, 'GET', '/bulk-jobs/active', undefined, oldSession)).body.code, 'BULK_JOB_NOT_FOUND')
  const created = await request(api, 'POST', '/bulk-jobs', { previewId:fresh.body.previewId, acknowledgeCreate:true })
  assert.equal(created.status, 200)
  assert.equal((await request(api, 'GET', `/bulk-jobs/${created.body.id}`, undefined, oldSession)).body.code, 'BULK_JOB_NOT_FOUND')
  assert.equal((await request(api, 'POST', `/bulk-jobs/${created.body.id}/cancel`, {}, oldSession)).body.code, 'BULK_JOB_NOT_FOUND')

  const wrongPrefix = await request(api, 'POST', '/bulk-jobs/preview', planInput({ prefix:'memory' }))
  assert.equal(wrongPrefix.status, 422)
  assert.equal(wrongPrefix.body.details.issues[0].code, 'PREFIX_MISMATCH')

  const stale = await request(api, 'POST', '/bulk-jobs/preview', planInput())
  influx.listRetentionPolicies = async () => []
  const staleResult = await request(api, 'POST', '/bulk-jobs', { previewId:stale.body.previewId, acknowledgeCreate:true })
  assert.equal(staleResult.status, 409)
  assert.equal(staleResult.body.code, 'STALE_BULK_PREVIEW')
  clock += 900_001
  assert.equal((await request(api, 'POST', '/bulk-jobs', { previewId:fresh.body.previewId, acknowledgeCreate:true })).body.code, 'BULK_PREVIEW_REQUIRED')
  assert.equal(await api.handle({ method:'GET', pathname:'/unrelated', searchParams:new URLSearchParams(), session, payload:{} }), null)
  assert.equal(await api.handle({ method:'GET', pathname:'/bulk-jobsfoo', searchParams:new URLSearchParams(), session, payload:{} }), null)
})

test('execution rejects previews when source schema, target existence, or RP changes', async () => {
  for (const mutate of [
    ({ schemas }) => { schemas.cpu_source = { tags:['host'], fields:[{ name:'usage', type:'integer' }] } },
    ({ tables }) => { tables.push('cpu_1784995200') },
    ({ policies }) => { policies[0] = { name:'autogen', durationMs:60_000, isDefault:true } },
  ]) {
    const tables = ['cpu_source']
    const policies = [{ name:'autogen', durationMs:0, isDefault:true }]
    const schemas = {}
    const { api } = fixture({ tables, policies, schemas })
    const preview = await request(api, 'POST', '/bulk-jobs/preview', planInput())
    mutate({ tables, policies, schemas })
    const result = await request(api, 'POST', '/bulk-jobs', { previewId:preview.body.previewId, acknowledgeCreate:true })
    assert.equal(result.status, 409)
    assert.equal(result.body.code, 'STALE_BULK_PREVIEW')
  }
})

test('mixed existing and future targets require both acknowledgements', async () => {
  const { api } = fixture({
    tables:['cpu_source', 'cpu_1784995200'],
  })
  const preview = await request(api, 'POST', '/bulk-jobs/preview', planInput({
    dates:['2026-07-26', '2026-07-27'],
  }))
  assert.equal(preview.status, 200)

  const createOnly = await request(api, 'POST', '/bulk-jobs', {
    previewId:preview.body.previewId,
    acknowledgeCreate:true,
  })
  assert.equal(createOnly.status, 409)
  assert.deepEqual(createOnly.body.details.acknowledgements, ['acknowledgeOverwrite'])

  const created = await request(api, 'POST', '/bulk-jobs', {
    previewId:preview.body.previewId,
    acknowledgeCreate:true,
    acknowledgeOverwrite:true,
  })
  assert.equal(created.status, 200)
})
