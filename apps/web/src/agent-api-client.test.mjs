import test from 'node:test'
import assert from 'node:assert/strict'
import { createAgentBridgeClient } from './agent-api.ts'
import { BridgeError } from './api.ts'

const json = (body, init = {}) => new Response(JSON.stringify(body), {
  status: 200, headers: { 'Content-Type': 'application/json' }, ...init,
})

function stream(chunks) {
  return new Response(new ReadableStream({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(new TextEncoder().encode(chunk))
      controller.close()
    },
  }), { headers: { 'Content-Type': 'text/event-stream' } })
}

test('REST sends Bearer and sendMessage returns runId', async () => {
  const calls = []
  const client = createAgentBridgeClient({
    apiBase: () => '/api',
    sessionId: () => 'bridge-secret',
    fetchImpl: async (url, init) => {
      calls.push({ url, init })
      return json({ runId: 'run-1', status: 'planning' })
    },
  })
  const result = await client.sendMessage('session/1', 'inspect', { provider: 'cli' })
  assert.equal(result.runId, 'run-1')
  assert.equal(calls[0].url, '/api/agent/sessions/session%2F1/messages')
  assert.equal(calls[0].init.headers.Authorization, 'Bearer bridge-secret')
  assert.doesNotMatch(calls[0].url, /bridge-secret/)
})

test('SSE parses arbitrary chunks, CRLF, multiline data and sequence', async () => {
  const events = []
  let unsubscribed = false
  const client = createAgentBridgeClient({
    apiBase: () => '/api',
    sessionId: () => 'token',
    fetchImpl: async () => stream([
      'id: 4\r', '\nevent: run.',
      'status\r\ndata: {"status":\r', '\n',
      'data: "running"}\r\n\r\n',
    ]),
    timers: {
      setTimeout: () => { unsubscribed = true; return 1 },
      clearTimeout: () => {},
    },
  })
  await new Promise(resolve => {
    const unsubscribe = client.subscribe('s1', 3, {
      event: event => { events.push(event); unsubscribe(); resolve() },
    })
  })
  assert.equal(unsubscribed, false)
  assert.deepEqual(events, [{
    sequence: 4, type: 'run.status', payload: { status: 'running' },
  }])
})

test('SSE reconnects with last sequence and resets backoff after an event', async () => {
  const urls = []
  const delays = []
  const scheduled = []
  let call = 0
  const client = createAgentBridgeClient({
    apiBase: () => '/api',
    sessionId: () => 'token',
    fetchImpl: async url => {
      urls.push(url)
      call += 1
      if (call === 1) return stream([])
      if (call === 2) return stream(['id: 8\ndata: {"ok":true}\n\n'])
      return new Promise(() => {})
    },
    timers: {
      setTimeout: (callback, delay) => {
        delays.push(delay)
        scheduled.push(callback)
        return scheduled.length
      },
      clearTimeout: () => {},
    },
  })
  const unsubscribe = client.subscribe('s1', 5, { event: () => {} })
  await new Promise(resolve => setTimeout(resolve, 0))
  scheduled.shift()()
  await new Promise(resolve => setTimeout(resolve, 0))
  scheduled.shift()()
  await new Promise(resolve => setTimeout(resolve, 0))
  unsubscribe()
  assert.deepEqual(delays, [500, 500])
  assert.match(urls[0], /after=5$/)
  assert.match(urls[1], /after=5$/)
  assert.match(urls[2], /after=8$/)
})

test('SSE ignores duplicate and regressing sequences without resetting backoff', async () => {
  const events = []
  const scheduled = []
  const delays = []
  const urls = []
  let call = 0
  const client = createAgentBridgeClient({
    apiBase: () => '/api',
    sessionId: () => 'token',
    fetchImpl: async url => {
      urls.push(url)
      call += 1
      if (call === 1) return stream([])
      if (call === 2) return stream([
        'id: 5\ndata: {"duplicate":true}\n\n',
        'id: 4\ndata: {"regressing":true}\n\n',
      ])
      return new Promise(() => {})
    },
    timers: {
      setTimeout: (callback, delay) => {
        scheduled.push(callback)
        delays.push(delay)
        return scheduled.length
      },
      clearTimeout: () => {},
    },
  })
  const unsubscribe = client.subscribe('s1', 5, { event: event => events.push(event) })
  await new Promise(resolve => setTimeout(resolve, 0))
  scheduled.shift()()
  await new Promise(resolve => setTimeout(resolve, 0))
  scheduled.shift()()
  await new Promise(resolve => setTimeout(resolve, 0))
  unsubscribe()
  assert.deepEqual(events, [])
  assert.deepEqual(delays, [500, 1000])
  assert.match(urls[2], /after=5$/)
})

test('SSE stops on permanent 4xx and reports the error once', async () => {
  let calls = 0
  let reconnects = 0
  const errors = []
  const client = createAgentBridgeClient({
    apiBase: () => '/api',
    sessionId: () => 'token',
    fetchImpl: async () => {
      calls += 1
      return json({ code: 'NOT_FOUND', message: 'Gone' }, { status: 404 })
    },
    timers: {
      setTimeout: () => { reconnects += 1; return 1 },
      clearTimeout: () => {},
    },
  })
  client.subscribe('s1', 0, { event: () => {}, error: error => errors.push(error) })
  await new Promise(resolve => setTimeout(resolve, 0))
  assert.equal(calls, 1)
  assert.equal(reconnects, 0)
  assert.equal(errors.length, 1)
})

test('SSE reconnects for 408, 429 and 5xx responses', async () => {
  for (const status of [408, 429, 503]) {
    let reconnects = 0
    const client = createAgentBridgeClient({
      fetchImpl: async () => json({ message: 'retry' }, { status }),
      timers: {
        setTimeout: () => { reconnects += 1; return 1 },
        clearTimeout: () => {},
      },
    })
    const unsubscribe = client.subscribe('s1', 0, { event: () => {} })
    await new Promise(resolve => setTimeout(resolve, 0))
    unsubscribe()
    assert.equal(reconnects, 1)
  }
})

test('SSE dispatches a final frame at EOF without a blank line', async () => {
  const events = []
  const client = createAgentBridgeClient({
    fetchImpl: async () => stream(['id: 2\nevent: final\ndata: {"ok":true}']),
    timers: { setTimeout: () => 1, clearTimeout: () => {} },
  })
  await new Promise(resolve => {
    const unsubscribe = client.subscribe('s1', 1, {
      event: event => {
        events.push(event)
        unsubscribe()
        resolve()
      },
    })
  })
  assert.deepEqual(events, [{ sequence: 2, type: 'final', payload: { ok: true } }])
})

test('unsubscribe aborts active stream and prevents reconnect', async () => {
  let signal
  let reconnects = 0
  const client = createAgentBridgeClient({
    apiBase: () => '/api',
    sessionId: () => 'token',
    fetchImpl: async (_url, init) => {
      signal = init.signal
      return new Promise((_resolve, reject) => {
        init.signal.addEventListener('abort', () => reject(init.signal.reason))
      })
    },
    timers: {
      setTimeout: () => { reconnects += 1; return 1 },
      clearTimeout: () => {},
    },
  })
  const unsubscribe = client.subscribe('s1', 0, { event: () => {} })
  await new Promise(resolve => setTimeout(resolve, 0))
  unsubscribe()
  await new Promise(resolve => setTimeout(resolve, 0))
  assert.equal(signal.aborted, true)
  assert.equal(reconnects, 0)
})

test('structured errors become BridgeError without leaking token', async () => {
  const client = createAgentBridgeClient({
    apiBase: () => '/api',
    sessionId: () => 'do-not-leak',
    fetchImpl: async () => json(
      { code: 'AGENT_DENIED', message: 'Denied', details: { reason: 'policy' } },
      { status: 403 },
    ),
  })
  await assert.rejects(client.listSessions(), error => {
    assert.ok(error instanceof BridgeError)
    assert.equal(error.code, 'AGENT_DENIED')
    assert.equal(error.status, 403)
    assert.doesNotMatch(String(error), /do-not-leak/)
    return true
  })
})

test('structured errors recursively redact token without invoking getters', async () => {
  let getterCalled = false
  const details = { nested: ['token-value', { safe: 'ok' }] }
  Object.defineProperty(details, 'danger', {
    enumerable: true,
    get() { getterCalled = true; throw new Error('getter invoked') },
  })
  const client = createAgentBridgeClient({
    sessionId: () => 'token-value',
    fetchImpl: async () => ({
      ok: false,
      status: 400,
      statusText: 'Bad Request',
      json: async () => ({
        code: 'BAD',
        message: 'Rejected token-value',
        details,
      }),
    }),
  })
  await assert.rejects(client.listSessions(), error => {
    assert.equal(error.message, 'Rejected [REDACTED]')
    assert.deepEqual(error.details, { nested: ['[REDACTED]', { safe: 'ok' }] })
    return true
  })
  assert.equal(getterCalled, false)
})

test('204 delete does not parse JSON', async () => {
  const client = createAgentBridgeClient({
    apiBase: () => '/api',
    sessionId: () => 'token',
    fetchImpl: async () => new Response(null, { status: 204 }),
  })
  assert.equal(await client.deleteSession('s1'), undefined)
})
