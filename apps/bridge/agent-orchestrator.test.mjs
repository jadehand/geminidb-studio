import test from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { createAgentOrchestrator } from './agent-orchestrator.mjs'
import { AgentError } from './agent-types.mjs'

function fixture() {
  const session = {
    id:randomUUID(), connectionIdentity:'connection-1', environment:'test',
    database:'metrics', retentionPolicy:'autogen', messages:[], runs:[], events:[],
  }
  const store = {
    async getSession(id) { return id === session.id ? structuredClone(session) : undefined },
    async appendMessage(_id, input) {
      const value = { id:randomUUID(), ...structuredClone(input) }
      session.messages.push(value)
      return value
    },
    async createRun(_id, input) {
      const run = {
        id:randomUUID(), status:'planning', provider:input.provider, model:input.model,
        budget:structuredClone(input.budget),
      }
      session.runs.push(run)
      return structuredClone(run)
    },
    async updateRun(_sid, id, patch) {
      const run = session.runs.find(item => item.id === id)
      Object.assign(run, structuredClone(patch))
      return structuredClone(run)
    },
    async appendEvent(_sid, runId, event) {
      session.events.push({ runId, ...structuredClone(event) })
    },
  }
  return { session, store }
}

function queued(initial, fallback) {
  const responses = [...initial]
  return {
    requests:[],
    async complete(request, signal) {
      this.requests.push({ request:structuredClone(request), signal })
      return responses.shift() ?? fallback?.()
    },
  }
}

function recording(results = {}) {
  return {
    schemas:[{ name:'get_schema' }],
    calls:[],
    async execute(name, input, context) {
      this.calls.push({ name, input, context })
      const value = results[name]
      if (value instanceof Error) throw value
      if (typeof value === 'function') return value()
      return value ?? {}
    },
  }
}

test('completes chat and persists assistant message without tools', async () => {
  const { session, store } = fixture()
  const provider = queued([{ kind:'final', content:'InfluxQL 使用类 SQL 语法。' }])
  const tools = recording()
  const orchestrator = createAgentOrchestrator({ store, provider, tools, now:() => 100 })
  const result = await orchestrator.start(session.id, 'InfluxQL 是什么？', { provider:'cli' })
  assert.equal(result.status, 'completed')
  assert.equal(tools.calls.length, 0)
  assert.equal(session.messages.at(-1).content, 'InfluxQL 使用类 SQL 语法。')
})

test('CLI failure falls back once to API and fixes the provider for the run', async () => {
  const { session, store } = fixture()
  const requests = []
  const provider = {
    async complete(request) {
      requests.push(request.provider)
      if (request.provider === 'cli') {
        throw new AgentError(503, 'AGENT_PROVIDER_UNAVAILABLE', 'CLI unavailable')
      }
      return { kind:'final', content:'API completed' }
    },
  }
  const orchestrator = createAgentOrchestrator({ store, provider, tools:recording(), now:() => 100 })
  const result = await orchestrator.start(session.id, 'inspect', {
    provider:'cli', fallbackToApi:true, endpoint:'https://api.anthropic.com',
  })
  assert.equal(result.status, 'completed')
  assert.deepEqual(requests, ['cli','api'])
  assert.equal(session.runs[0].provider, 'api')
})

test('startBackground returns after planning persistence without waiting for provider', async () => {
  const { session, store } = fixture()
  let releaseRunning
  const updateRun = store.updateRun
  store.updateRun = async (sessionId, runId, patch) => {
    if (patch.status === 'running') {
      await new Promise(resolve => { releaseRunning = resolve })
    }
    return updateRun(sessionId, runId, patch)
  }
  let releaseProvider
  let providerStarted = false
  const provider = {
    async complete() {
      providerStarted = true
      return new Promise(resolve => {
        releaseProvider = () => resolve({ kind:'final', content:'完成' })
      })
    },
  }
  const orchestrator = createAgentOrchestrator({ store, provider, tools:recording(), now:() => 100 })
  const started = await orchestrator.startBackground(session.id, '后台执行', { provider:'cli' })
  assert.equal(started.status, 'planning')
  assert.equal(session.runs[0].id, started.runId)
  assert.equal(session.messages[0].content, '后台执行')
  assert.equal(providerStarted, false)
  releaseRunning()
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(providerStarted, true)
  releaseProvider()
  assert.equal((await started.completion).status, 'completed')
})

test('persists assistant_message and executes a tool loop', async () => {
  const { session, store } = fixture()
  const provider = queued([
    { kind:'assistant_message', content:'先检查结构。' },
    { kind:'tool_call', callId:'c1', tool:'get_schema', input:{ measurement:'cpu' }, content:'读取结构' },
    { kind:'final', content:'存在 usage 字段。' },
  ])
  const tools = recording({ get_schema:{ fields:[{ name:'usage' }] } })
  const orchestrator = createAgentOrchestrator({ store, provider, tools, now:() => 100 })
  const result = await orchestrator.start(session.id, '检查 cpu', { provider:'cli' })
  assert.equal(result.status, 'completed')
  assert.equal(tools.calls.length, 1)
  assert.equal(tools.calls[0].context.agentSession.database, 'metrics')
  assert.match(provider.requests[2].request.messages.at(-1).content, /usage/)
  assert.equal(session.runs[0].budget.toolCalls, 1)
})

test('persists each tool count before execution and stops before a thirteenth call', async () => {
  const { session, store } = fixture()
  let call = 0
  const provider = queued([], () => ({
    kind:'tool_call', callId:`c${++call}`, tool:'get_schema', input:{ measurement:'cpu' }, content:'',
  }))
  const seen = []
  const tools = recording({ get_schema:() => {
    seen.push(session.runs[0].budget.toolCalls)
    return {}
  } })
  const orchestrator = createAgentOrchestrator({ store, provider, tools, now:() => 100 })
  const result = await orchestrator.start(session.id, '循环', { provider:'cli' })
  assert.equal(result.status, 'budget_exceeded')
  assert.equal(tools.calls.length, 12)
  assert.deepEqual(seen, [1,2,3,4,5,6,7,8,9,10,11,12])
})

test('enforces five minute deadline', async () => {
  const { session, store } = fixture()
  let time = 0
  const provider = queued([{ kind:'assistant_message', content:'继续' }])
  const orchestrator = createAgentOrchestrator({
    store, provider, tools:recording(), now:() => {
      time += 300_001
      return time
    },
  })
  const result = await orchestrator.start(session.id, '超时', { provider:'cli' })
  assert.equal(result.status, 'budget_exceeded')
})

test('deadline actively aborts an in-flight provider call', async () => {
  const { session, store } = fixture()
  let observedSignal
  const provider = {
    complete(_request, signal) {
      observedSignal = signal
      return new Promise((_resolve, reject) => {
        signal.addEventListener('abort', () => reject(new AgentError(499, 'AGENT_CANCELLED', 'cancelled')))
      })
    },
  }
  const result = await createAgentOrchestrator({
    store, provider, tools:recording(), maxRunMs:10,
  }).start(session.id, '等待超时', { provider:'cli' })
  assert.equal(observedSignal.aborted, true)
  assert.equal(result.status, 'budget_exceeded')
  assert.equal(result.stopReason, 'deadline')
})

test('stop wins when provider ignores abort and later returns final', async () => {
  const { session, store } = fixture()
  let release
  const provider = {
    complete() {
      return new Promise(resolve => { release = () => resolve({ kind:'final', content:'late' }) })
    },
  }
  const orchestrator = createAgentOrchestrator({ store, provider, tools:recording(), maxRunMs:1_000 })
  const running = orchestrator.start(session.id, '停止', { provider:'cli' })
  await new Promise(resolve => setImmediate(resolve))
  const stopping = orchestrator.stop(session.id)
  release()
  assert.equal(await stopping, true)
  assert.equal((await running).status, 'stopped')
  assert.equal(session.runs[0].status, 'stopped')
  assert.equal(session.messages.some(message => message.content === 'late'), false)
})

test('stop and deadline race persists exactly one terminal status', async () => {
  const { session, store } = fixture()
  let release
  const provider = {
    complete() {
      return new Promise(resolve => { release = () => resolve({ kind:'final', content:'late' }) })
    },
  }
  const orchestrator = createAgentOrchestrator({ store, provider, tools:recording(), maxRunMs:15 })
  const running = orchestrator.start(session.id, '竞争', { provider:'cli' })
  await new Promise(resolve => setImmediate(resolve))
  await orchestrator.stop(session.id)
  await new Promise(resolve => setTimeout(resolve, 25))
  release()
  const result = await running
  assert.equal(result.status, 'stopped')
  const terminal = session.events.filter(event =>
    event.type === 'run.status' && ['completed', 'stopped', 'failed', 'blocked', 'budget_exceeded']
      .includes(event.payload.status))
  assert.deepEqual(terminal.map(event => event.payload.status), ['stopped'])
})

test('redacts rejected tool input and tool errors before persistence', async () => {
  const { session, store } = fixture()
  const provider = queued([{
    kind:'tool_call', callId:'c1', tool:'get_schema', content:'读取',
    input:{ apiKey:'key-secret', password:'pass-secret', token:'token-secret' },
  }])
  const tools = recording({
    get_schema:new AgentError(400, 'AGENT_TOOL_INPUT_INVALID', 'password=pass-secret token-secret'),
  })
  const result = await createAgentOrchestrator({ store, provider, tools, now:() => 1 })
    .start(session.id, '执行', { provider:'cli' })
  assert.equal(result.status, 'blocked')
  const persisted = JSON.stringify({ messages:session.messages, events:session.events })
  assert.doesNotMatch(persisted, /key-secret|pass-secret|token-secret/)
  assert.match(persisted, /\[REDACTED\]/)
})

test('redacts successful tool result in events messages and subsequent provider request', async () => {
  const { session, store } = fixture()
  const provider = queued([
    { kind:'tool_call', callId:'c1', tool:'get_schema', input:{}, content:'读取' },
    { kind:'final', content:'done' },
  ])
  const tools = recording({
    get_schema:{ apiKey:'key-secret', password:'pass-secret', nested:{ token:'token-secret' } },
  })
  const result = await createAgentOrchestrator({ store, provider, tools, now:() => 1 })
    .start(session.id, '执行', { provider:'cli' })
  assert.equal(result.status, 'completed')
  const persisted = JSON.stringify({ messages:session.messages, events:session.events })
  const nextRequest = JSON.stringify(provider.requests[1].request)
  assert.doesNotMatch(`${persisted}${nextRequest}`, /key-secret|pass-secret|token-secret/)
  assert.match(`${persisted}${nextRequest}`, /\[REDACTED\]/)
})

test('immediate stop waits until a delayed run is persisted as stopped', async () => {
  const { session, store } = fixture()
  let release
  const originalGetSession = store.getSession
  store.getSession = async id => {
    await new Promise(resolve => { release = resolve })
    return originalGetSession(id)
  }
  const provider = queued([{ kind:'final', content:'不应执行' }])
  const orchestrator = createAgentOrchestrator({ store, provider, tools:recording(), now:() => 1 })
  const running = orchestrator.start(session.id, '立即停止', { provider:'cli' })
  await new Promise(resolve => setImmediate(resolve))
  const stopping = orchestrator.stop(session.id)
  let stopReturned = false
  stopping.then(() => { stopReturned = true })
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(stopReturned, false)
  release()
  assert.equal(await stopping, true)
  assert.equal(session.runs[0].status, 'stopped')
  assert.equal((await running).status, 'stopped')
  assert.equal(provider.requests.length, 0)
})

test('immediate stop does not hang when setup fails before run creation', async () => {
  const { session, store } = fixture()
  let release
  store.getSession = async () => new Promise((resolve, reject) => {
    release = () => reject(new Error('store unavailable'))
  })
  const orchestrator = createAgentOrchestrator({ store, provider:queued([]), tools:recording() })
  const running = orchestrator.start(session.id, '立即停止', { provider:'cli' })
  await new Promise(resolve => setImmediate(resolve))
  const stopping = orchestrator.stop(session.id)
  release()
  await assert.rejects(running, /store unavailable/)
  assert.equal(await stopping, true)
})

test('persists tool-call assistant context with redacted input', async () => {
  const { session, store } = fixture()
  const provider = queued([
    {
      kind:'tool_call', callId:'c1', tool:'get_schema', content:'读取结构',
      input:{ measurement:'cpu', token:'hidden' },
    },
    { kind:'final', content:'done' },
  ])
  await createAgentOrchestrator({
    store, provider, tools:recording({ get_schema:{} }), now:() => 1,
  }).start(session.id, '执行', { provider:'cli' })
  const callMessage = session.messages.find(message => message.toolCallId === 'c1' && message.role === 'assistant')
  const persistedCall = JSON.parse(callMessage.content)
  assert.equal(persistedCall.toolCall.tool, 'get_schema')
  assert.equal(persistedCall.toolCall.input.measurement, 'cpu')
  assert.equal(persistedCall.toolCall.input.token, '[REDACTED]')
})

test('blocks unknown and policy-denied tools', async () => {
  for (const code of ['AGENT_TOOL_UNKNOWN', 'AGENT_POLICY_DENIED']) {
    const { session, store } = fixture()
    const provider = queued([{ kind:'tool_call', callId:'c1', tool:'bad', input:{}, content:'' }])
    const tools = recording({ bad:new AgentError(403, code, 'blocked') })
    const result = await createAgentOrchestrator({ store, provider, tools, now:() => 1 })
      .start(session.id, '执行', { provider:'cli' })
    assert.equal(result.status, 'blocked')
    assert.equal(tools.calls.length, 1)
  }
})

test('retries the same tool failure once and no more', async () => {
  const { session, store } = fixture()
  let attempts = 0
  const tools = recording({ get_schema:() => {
    attempts += 1
    throw new Error('temporary')
  } })
  const provider = queued([{ kind:'tool_call', callId:'c1', tool:'get_schema', input:{}, content:'' }])
  await assert.rejects(
    createAgentOrchestrator({ store, provider, tools, now:() => 1 })
      .start(session.id, '执行', { provider:'cli' }),
    /temporary/,
  )
  assert.equal(attempts, 2)
  assert.equal(session.runs[0].status, 'failed')
})

test('rejects a concurrent run globally', async () => {
  const first = fixture()
  const second = fixture()
  first.store.getSession = async id => id === first.session.id
    ? structuredClone(first.session)
    : id === second.session.id ? structuredClone(second.session) : undefined
  const pending = {}
  const provider = {
    complete(_request, signal) {
      return new Promise((resolve, reject) => {
        pending.resolve = resolve
        signal.addEventListener('abort', () => reject(new AgentError(499, 'AGENT_CANCELLED', 'cancelled')))
      })
    },
  }
  const orchestrator = createAgentOrchestrator({ store:first.store, provider, tools:recording(), now:() => 1 })
  const running = orchestrator.start(first.session.id, '等待', { provider:'cli' })
  await new Promise(resolve => setImmediate(resolve))
  await assert.rejects(orchestrator.start(second.session.id, '冲突', { provider:'cli' }), {
    code:'AGENT_RUN_CONFLICT',
  })
  assert.equal(orchestrator.hasActiveRun(), true)
  await orchestrator.stop(first.session.id)
  assert.equal(first.session.runs[0].status, 'stopped')
  assert.equal((await running).status, 'stopped')
  assert.equal(orchestrator.hasActiveRun(), false)
})

test('propagates the same AbortSignal to provider and tool', async () => {
  const { session, store } = fixture()
  const provider = queued([
    { kind:'tool_call', callId:'c1', tool:'get_schema', input:{}, content:'' },
    { kind:'final', content:'done' },
  ])
  const tools = recording({ get_schema:{} })
  await createAgentOrchestrator({ store, provider, tools, now:() => 1 })
    .start(session.id, '执行', { provider:'cli' })
  assert.equal(provider.requests[0].signal, tools.calls[0].context.signal)
  assert.equal(provider.requests[1].signal, tools.calls[0].context.signal)
})
