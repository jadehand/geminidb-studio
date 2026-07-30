import test from 'node:test'
import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { randomUUID } from 'node:crypto'
import { createAgentApi } from './agent-api.mjs'

function fixture(options = {}) {
  const sessions = new Map()
  let sequence = 0
  const store = {
    async createSession(input) {
      const value = { id:randomUUID(), ...structuredClone(input), status:'planning', runs:[], events:[] }
      sessions.set(value.id, value)
      return structuredClone(value)
    },
    async listSessions() { return [...sessions.values()].map(({ runs, events, ...item }) => structuredClone(item)) },
    async getSession(id) { return sessions.has(id) ? structuredClone(sessions.get(id)) : undefined },
    async updateSession(id, patch) {
      Object.assign(sessions.get(id), structuredClone(patch))
      return structuredClone(sessions.get(id))
    },
    async deleteSession(id) { sessions.delete(id) },
    async eventsAfter(id, after) {
      return structuredClone(sessions.get(id).events.filter(event => event.sequence > after))
    },
  }
  const orchestrator = {
    active:false,
    hasActiveRun() { return this.active },
    async startBackground(id) {
      this.active = true
      const run = { id:randomUUID(), status:'planning' }
      sessions.get(id).runs.push(run)
      const completion = options.startError
        ? Promise.reject(options.startError)
        : new Promise(() => {})
      completion.catch(() => {})
      return { runId:run.id, status:run.status, completion }
    },
    async start(id) {
      const { completion } = await this.startBackground(id)
      try {
        return await completion
      } finally {
        this.active = false
      }
    },
    async stop() { this.active = false; return true },
  }
  const provider = { async probe(settings) { return { ready:true, provider:settings.provider } } }
  const resolved = []
  const api = createAgentApi({
    store, orchestrator, provider,
    resolveConnection:async (bridgeSession, requested) => {
      resolved.push({ bridgeSession, requested })
      if (bridgeSession?.bearer !== 'current') return undefined
      return options.connection ?? {
        connectionIdentity:'server-bound', environment:'test', readOnly:true,
      }
    },
    pollIntervalMs:5,
    keepaliveMs:20,
  })
  return { api, store, sessions, orchestrator, resolved, appendEvent(id, type, payload) {
    const event = { id:randomUUID(), sequence:++sequence, sessionId:id, type, payload }
    sessions.get(id).events.push(event)
    return event
  } }
}

async function create(api, payload = {}) {
  return api.handle({
    pathname:'/agent/sessions', method:'POST', session:{ bearer:'current' },
    payload:{ connectionId:'attacker-id', database:'metrics', retentionPolicy:'autogen', ...payload },
  })
}

test('session CRUD binds trusted connection context and only patches mutable context', async () => {
  const { api, resolved } = fixture()
  const made = await create(api, { title:'Task' })
  assert.equal(made.status, 201)
  assert.equal(made.body.connectionId, 'server-bound')
  assert.equal(made.body.environment, 'test')
  assert.equal(made.body.readOnly, true)
  assert.deepEqual(resolved[0], { bridgeSession:{ bearer:'current' }, requested:'attacker-id' })

  const listed = await api.handle({ pathname:'/agent/sessions', method:'GET', session:{ bearer:'current' } })
  assert.equal(listed.body.length, 1)
  const id = made.body.id
  const updated = await api.handle({
    pathname:`/agent/sessions/${id}`, method:'PATCH',
    session:{ bearer:'current' },
    payload:{ title:'Renamed' },
  })
  assert.equal(updated.body.title, 'Renamed')
  assert.equal(updated.body.connectionId, 'server-bound')
  assert.equal(updated.body.environment, 'test')
  assert.equal((await api.handle({
    pathname:`/agent/sessions/${id}`, method:'GET', session:{ bearer:'current' },
  })).body.id, id)
  assert.equal((await api.handle({
    pathname:`/agent/sessions/${id}`, method:'DELETE', session:{ bearer:'current' },
  })).status, 204)
})

test('rejects production connection and missing sessions', async () => {
  const { api } = fixture({ connection:{ connectionIdentity:'prod', environment:'prod', readOnly:false } })
  await assert.rejects(create(api), error => error.code === 'AGENT_POLICY_DENIED')
  await assert.rejects(
    api.handle({ pathname:`/agent/sessions/${randomUUID()}`, method:'GET', session:{ bearer:'current' } }),
    error => error.code === 'AGENT_SESSION_NOT_FOUND',
  )
})

test('message starts in background, returns planning run, and consumes rejection', async () => {
  const { api } = fixture({ startError:Object.assign(new Error('failed'), { code:'FAILED' }) })
  const session = (await create(api)).body
  const unhandled = []
  const listener = error => unhandled.push(error)
  process.on('unhandledRejection', listener)
  try {
    const response = await api.handle({
      pathname:`/agent/sessions/${session.id}/messages`,
      method:'POST', session:{ bearer:'current' },
      payload:{ message:'检查 metrics', settings:{ provider:'cli' } },
    })
    assert.equal(response.status, 202)
    assert.match(response.body.runId, /^[0-9a-f-]+$/)
    assert.equal(response.body.status, 'planning')
    await new Promise(resolve => setImmediate(resolve))
    assert.deepEqual(unhandled, [])
  } finally {
    process.off('unhandledRejection', listener)
  }
})

test('message response waits for persisted run but not background provider completion', async () => {
  const { api, orchestrator } = fixture()
  const session = (await create(api)).body
  let releaseStart
  let releaseCompletion
  orchestrator.startBackground = async id => {
    await new Promise(resolve => { releaseStart = resolve })
    const run = { id:randomUUID(), status:'planning' }
    const completion = new Promise(resolve => { releaseCompletion = resolve })
    return { runId:run.id, status:run.status, completion }
  }
  const pending = api.handle({
    pathname:`/agent/sessions/${session.id}/messages`,
    method:'POST', session:{ bearer:'current' },
    payload:{ message:'检查 metrics', settings:{ provider:'cli' } },
  })
  await new Promise(resolve => setImmediate(resolve))
  let returned = false
  pending.then(() => { returned = true })
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(returned, false)
  releaseStart()
  const response = await pending
  assert.equal(response.status, 202)
  assert.equal(response.body.status, 'planning')
  releaseCompletion({ status:'completed' })
})

test('stop delegates and active sessions cannot be deleted', async () => {
  const { api, orchestrator } = fixture()
  const session = (await create(api)).body
  orchestrator.active = true
  const stored = await api.handle({
    pathname:`/agent/sessions/${session.id}`, method:'GET', session:{ bearer:'current' },
  })
  stored.body.runs.push({ id:randomUUID(), status:'running' })
  // The fixture returns clones, so start a real run to persist the non-terminal state.
  orchestrator.start(session.id).catch(() => {})
  await assert.rejects(
    api.handle({
      pathname:`/agent/sessions/${session.id}`, method:'DELETE', session:{ bearer:'current' },
    }),
    error => error.status === 409 && error.code === 'AGENT_RUN_CONFLICT',
  )
  const stopped = await api.handle({
    pathname:`/agent/sessions/${session.id}/stop`, method:'POST', session:{ bearer:'current' },
  })
  assert.deepEqual(stopped, { status:200, body:{ stopped:true } })
})

test('an active run does not prevent deleting a different terminal session', async () => {
  const { api, orchestrator } = fixture()
  const first = (await create(api)).body
  const second = (await create(api)).body
  orchestrator.start(first.id).catch(() => {})
  const deleted = await api.handle({
    pathname:`/agent/sessions/${second.id}`, method:'DELETE', session:{ bearer:'current' },
  })
  assert.equal(deleted.status, 204)
})

test('provider probe delegates settings without returning credentials', async () => {
  const { api } = fixture()
  const response = await api.handle({
    pathname:'/agent/provider/probe', method:'POST',
    payload:{ settings:{ provider:'cli', cliPath:'/opt/claude', fallbackToApi:true } },
  })
  assert.deepEqual(response, { status:200, body:{ ready:true, provider:'cli' } })
})

class FakeResponse extends EventEmitter {
  chunks = []
  writeHead(status, headers) { this.status = status; this.headers = headers }
  write(chunk) { this.chunks.push(chunk); return true }
  end() { this.ended = true; this.emit('close') }
}

test('SSE sends persisted id/event/data, honors after, and cleans timers on close', async () => {
  const { api, appendEvent } = fixture()
  const session = (await create(api)).body
  appendEvent(session.id, 'run.status', { status:'planning' })
  appendEvent(session.id, 'run.status', { status:'running' })
  const request = new EventEmitter()
  const response = new FakeResponse()
  const streamed = await api.handle({
    request, response, pathname:`/agent/sessions/${session.id}/events`,
    method:'GET', session:{ bearer:'current' }, searchParams:new URLSearchParams('after=1'),
  })
  assert.equal(streamed.handled, true)
  assert.equal(response.status, 200)
  assert.equal(response.chunks.join('').includes('id: 1'), false)
  assert.match(response.chunks.join(''), /id: 2\nevent: run\.status\ndata: \{"status":"running"\}\n\n/)

  appendEvent(session.id, 'tool.completed', { rowCount:2 })
  await sleepFor(12)
  assert.match(response.chunks.join(''), /id: 3\nevent: tool\.completed/)
  request.emit('close')
  const count = response.chunks.length
  await sleepFor(30)
  assert.equal(response.chunks.length, count)
})

test('SSE pauses polling on backpressure and resumes on drain', async () => {
  const { api, appendEvent } = fixture()
  const session = (await create(api)).body
  appendEvent(session.id, 'run.status', { status:'running' })
  const request = new EventEmitter()
  const response = new FakeResponse()
  let first = true
  response.write = function (chunk) {
    this.chunks.push(chunk)
    if (first) { first = false; return false }
    return true
  }
  await api.handle({
    request, response, pathname:`/agent/sessions/${session.id}/events`,
    method:'GET', session:{ bearer:'current' }, searchParams:new URLSearchParams(),
  })
  appendEvent(session.id, 'run.status', { status:'completed' })
  response.emit('drain')
  await sleepFor(10)
  assert.match(response.chunks.join(''), /id: 2/)
  assert.equal(response.chunks.join('').match(/id: 1/g)?.length, 1)
  request.emit('close')
})

test('invalid SSE cursor is rejected before taking over response', async () => {
  const { api } = fixture()
  const session = (await create(api)).body
  await assert.rejects(api.handle({
    request:new EventEmitter(), response:new FakeResponse(),
    pathname:`/agent/sessions/${session.id}/events`,
    method:'GET', session:{ bearer:'current' }, searchParams:new URLSearchParams('after=-1'),
  }), error => error.code === 'AGENT_EVENT_SEQUENCE_INVALID')
})

test('hides sessions and rejects every operation for a foreign bearer before SSE headers', async () => {
  const { api } = fixture()
  const owned = (await create(api)).body
  const foreign = { bearer:'foreign' }
  const list = await api.handle({
    pathname:'/agent/sessions', method:'GET', session:foreign,
  })
  assert.deepEqual(list.body, [])

  const requests = [
    { pathname:`/agent/sessions/${owned.id}`, method:'GET' },
    { pathname:`/agent/sessions/${owned.id}`, method:'PATCH', payload:{ title:'stolen' } },
    { pathname:`/agent/sessions/${owned.id}`, method:'DELETE' },
    { pathname:`/agent/sessions/${owned.id}/messages`, method:'POST', payload:{ message:'run' } },
    { pathname:`/agent/sessions/${owned.id}/stop`, method:'POST' },
  ]
  for (const request of requests) {
    await assert.rejects(api.handle({ payload:{}, ...request, session:foreign }),
      error => error.status === 404 && error.code === 'AGENT_SESSION_NOT_FOUND')
  }

  const response = new FakeResponse()
  await assert.rejects(api.handle({
    request:new EventEmitter(), response, session:foreign,
    pathname:`/agent/sessions/${owned.id}/events`, method:'GET',
    searchParams:new URLSearchParams(),
  }), error => error.status === 404 && error.code === 'AGENT_SESSION_NOT_FOUND')
  assert.equal(response.status, undefined)
  assert.deepEqual(response.chunks, [])
})

test('rejects unknown, oversized, and credential-bearing API input', async () => {
  const { api } = fixture()
  const owned = (await create(api)).body
  await assert.rejects(create(api, { password:'secret' }),
    error => error.code === 'AGENT_CREDENTIALS_FORBIDDEN')
  await assert.rejects(api.handle({
    pathname:`/agent/sessions/${owned.id}`, method:'PATCH', session:{ bearer:'current' },
    payload:{ title:'x'.repeat(201) },
  }), error => error.code === 'AGENT_INPUT_INVALID')
  await assert.rejects(api.handle({
    pathname:`/agent/sessions/${owned.id}/messages`, method:'POST', session:{ bearer:'current' },
    payload:{ message:'run', settings:{ provider:'api', apiKey:'secret' } },
  }), error => error.code === 'AGENT_CREDENTIALS_FORBIDDEN')
  await assert.rejects(api.handle({
    pathname:'/agent/provider/probe', method:'POST',
    payload:{ provider:'api', authorization:'secret' },
  }), error => error.code === 'AGENT_CREDENTIALS_FORBIDDEN')
  await assert.rejects(api.handle({
    pathname:'/agent/provider/probe', method:'POST',
    payload:{ settings:{ provider:'api', metadata:{ nested:{ token:'secret' } } } },
  }), error => error.code === 'AGENT_CREDENTIALS_FORBIDDEN')
  await assert.rejects(api.handle({
    pathname:'/agent/provider/probe', method:'POST',
    payload:{ provider:'cli', fallbackToApi:'yes' },
  }), error => error.code === 'AGENT_INPUT_INVALID')
  await assert.rejects(api.handle({
    pathname:'/agent/provider/probe', method:'POST',
    payload:{ provider:'cli', cliPath:'x'.repeat(1_025) },
  }), error => error.code === 'AGENT_INPUT_INVALID')
})

function sleepFor(ms) {
  return new Promise(resolve => setTimeout(resolve, ms))
}
