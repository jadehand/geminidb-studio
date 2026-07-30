import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, readdir, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { AgentError } from './agent-types.mjs'
import { createAgentStore } from './agent-store.mjs'

const temporaryDataDir = () => mkdtemp(join(tmpdir(), 'gdb-agent-store-'))

test('persists sessions, messages, runs and ordered events across instances', async () => {
  const dataDir = await temporaryDataDir()
  const first = createAgentStore({ dataDir, now: () => 100 })
  await first.init()
  const session = await first.createSession({ connectionId: 'c1', environment: 'test', database: 'db1', retentionPolicy: 'autogen' })
  const run = await first.createRun(session.id, { provider: 'cli', model: 'claude', deadlineAt: 300_100 })
  await first.appendMessage(session.id, { role: 'user', content: 'query cpu' })
  await first.appendEvent(session.id, run.id, { type: 'run.status', payload: { status: 'planning' } })
  await first.appendEvent(session.id, run.id, { type: 'tool.status', payload: { status: 'running' } })

  const second = createAgentStore({ dataDir, now: () => 200 })
  await second.init()
  const restored = await second.getSession(session.id)
  assert.equal(restored.messages[0].content, 'query cpu')
  assert.equal(restored.runs[0].model, 'claude')
  assert.deepEqual(restored.runs[0].budget, {
    toolCalls: 0, maxToolCalls: 12, startedAt: 100, deadlineAt: 300_100,
  })
  assert.deepEqual((await second.eventsAfter(session.id, 1)).map(({ sequence }) => sequence), [2, 3])
  assert.equal((await second.listSessions())[0].messages, undefined)
  assert.deepEqual(await readdir(join(dataDir, 'agent', 'v1')), ['index.json', 'sessions'])
})

test('marks non-terminal runs interrupted during initialization', async () => {
  const dataDir = await temporaryDataDir()
  const store = createAgentStore({ dataDir, now: () => 500 })
  await store.init()
  const session = await store.createSession({ connectionId: 'c1', environment: 'dev', database: 'db1', retentionPolicy: 'autogen' })
  await store.createRun(session.id, { provider: 'api', model: 'claude', deadlineAt: 5_000 })
  const reopened = createAgentStore({ dataDir, now: () => 900 })
  await reopened.init()
  const restored = await reopened.getSession(session.id)
  assert.equal(restored.runs[0].status, 'interrupted')
  assert.equal(restored.status, 'interrupted')
  assert.equal((await reopened.listSessions())[0].status, 'interrupted')
  assert.equal(restored.events.at(-1).type, 'run.status')
  assert.equal(restored.events.at(-1).payload.status, 'interrupted')
})

test('whitelists inputs, protects server fields, and removes sensitive keys', async () => {
  const dataDir = await temporaryDataDir()
  const store = createAgentStore({ dataDir, now: () => 42 })
  await store.init()
  const session = await store.createSession({
    id: 'evil', createdAt: 1, password: 'nope', title: 'safe',
    connectionId: 'c1', environment: 'test', database: 'db', retentionPolicy: 'r',
  })
  assert.notEqual(session.id, 'evil')
  assert.equal(session.password, undefined)
  await store.updateSession(session.id, { id: 'evil2', secret: 'nope', title: 'updated' })
  const run = await store.createRun(session.id, {
    id: 'evil', sessionId: 'evil', provider: 'api', model: 'm',
    plan: [{ query: 'ok', password: 'nope' }], secret: 'nope',
  })
  const message = await store.appendMessage(session.id, {
    id: 'evil', sessionId: 'evil', role: 'user', content: 'hi',
    result: { value: 1, apiKey: 'nope' }, password: 'nope',
  })
  const event = await store.appendEvent(session.id, run.id, {
    id: 'evil', sequence: 999, sessionId: 'evil', runId: 'evil',
    type: 'tool.status', payload: { ok: true, secret: 'nope' }, password: 'nope',
  })
  assert.notEqual(message.id, 'evil')
  assert.equal(event.sequence, 1)
  assert.equal(event.sessionId, session.id)
  assert.equal(event.runId, run.id)
  const disk = JSON.parse(await readFile(join(dataDir, 'agent', 'v1', 'sessions', `${session.id}.json`), 'utf8'))
  assert.equal(JSON.stringify(disk).includes('nope'), false)
})

test('coordinates interleaved writes across store instances', async () => {
  const dataDir = await temporaryDataDir()
  const first = createAgentStore({ dataDir })
  const second = createAgentStore({ dataDir })
  await Promise.all([first.init(), second.init()])
  const [a, b] = await Promise.all([
    first.createSession({ title: 'a' }),
    second.createSession({ title: 'b' }),
  ])
  await Promise.all([
    first.updateSession(a.id, { title: 'a2' }),
    second.updateSession(b.id, { title: 'b2' }),
  ])
  assert.deepEqual((await first.listSessions()).map(({ title }) => title).sort(), ['a2', 'b2'])
  await Promise.all([
    first.deleteSession(a.id),
    second.createSession({ title: 'c' }),
  ])
  assert.deepEqual((await second.listSessions()).map(({ title }) => title).sort(), ['b2', 'c'])
})

test('isolates malformed and structurally corrupt index and sessions without overwriting quarantines', async () => {
  const dataDir = await temporaryDataDir()
  const store = createAgentStore({ dataDir, now: () => 10 })
  await store.init()
  const session = await store.createSession({ connectionId: 'c1', environment: 'test', database: 'db1', retentionPolicy: 'r' })
  const path = join(dataDir, 'agent', 'v1', 'sessions', `${session.id}.json`)
  await writeFile(path, '{bad')
  await writeFile(`${path}.corrupt-20`, 'keep')
  await createAgentStore({ dataDir, now: () => 20 }).init()
  const names = await readdir(join(dataDir, 'agent', 'v1', 'sessions'))
  assert.ok(names.includes(`${session.id}.json.corrupt-20-1`))
  assert.equal(await readFile(`${path}.corrupt-20`, 'utf8'), 'keep')

  const indexPath = join(dataDir, 'agent', 'v1', 'index.json')
  await writeFile(indexPath, JSON.stringify([{ id: session.id, title: 42 }]))
  await writeFile(`${indexPath}.corrupt-30`, 'keep-index')
  await createAgentStore({ dataDir, now: () => 30 }).init()
  assert.equal(await readFile(`${indexPath}.corrupt-30`, 'utf8'), 'keep-index')
  assert.ok((await readdir(join(dataDir, 'agent', 'v1'))).includes('index.json.corrupt-30-1'))

  const structureDir = await temporaryDataDir()
  const structureStore = createAgentStore({ dataDir: structureDir, now: () => 40 })
  await structureStore.init()
  const structured = await structureStore.createSession({})
  const structuredPath = join(structureDir, 'agent', 'v1', 'sessions', `${structured.id}.json`)
  const disk = JSON.parse(await readFile(structuredPath, 'utf8'))
  disk.events = [
    { sequence: 2, sessionId: structured.id },
    { sequence: 2, sessionId: structured.id },
  ]
  await writeFile(structuredPath, JSON.stringify(disk))
  const reopened = createAgentStore({ dataDir: structureDir, now: () => 50 })
  await reopened.init()
  assert.equal(await reopened.getSession(structured.id), undefined)
  assert.ok((await readdir(join(structureDir, 'agent', 'v1', 'sessions')))
    .includes(`${structured.id}.json.corrupt-50`))
})

test('deletes the session file and index entry without temporary files', async () => {
  const dataDir = await temporaryDataDir()
  const store = createAgentStore({ dataDir, now: () => 10 })
  await store.init()
  const session = await store.createSession({ connectionId: 'c1', environment: 'test', database: 'db1', retentionPolicy: 'r' })
  await store.deleteSession(session.id)
  assert.equal(await store.getSession(session.id), undefined)
  assert.deepEqual(await store.listSessions(), [])
  const files = await readdir(join(dataDir, 'agent', 'v1', 'sessions'))
  assert.deepEqual(files, [])
  assert.equal((await readdir(join(dataDir, 'agent', 'v1'))).some((name) => name.endsWith('.tmp')), false)
})

test('rejects a missing dataDir', async () => {
  const store = createAgentStore({})
  await assert.rejects(store.init(), (error) =>
    error instanceof AgentError && error.status === 503 && error.code === 'AGENT_STORE_UNAVAILABLE')
})

test('rejects traversal IDs for reads, updates, deletes and events without touching the index', async () => {
  const dataDir = await temporaryDataDir()
  const store = createAgentStore({ dataDir })
  await store.init()
  const session = await store.createSession({ title: 'kept' })
  const indexPath = join(dataDir, 'agent', 'v1', 'index.json')
  const before = await readFile(indexPath, 'utf8')
  const invalidInput = (error) =>
    error instanceof AgentError && error.status === 400 && error.code === 'AGENT_STORE_INVALID_INPUT'

  await assert.rejects(store.getSession('../index'), invalidInput)
  await assert.rejects(store.updateSession('../index', { title: 'bad' }), invalidInput)
  await assert.rejects(store.deleteSession('../index'), invalidInput)
  await assert.rejects(store.eventsAfter('../index', 0), invalidInput)
  await assert.rejects(store.appendEvent('../index', undefined, { type: 'bad' }), invalidInput)
  assert.equal(await readFile(indexPath, 'utf8'), before)
  assert.equal((await store.getSession(session.id)).title, 'kept')
})

test('rejects invalid UUIDs, statuses, times and tool call counts', async () => {
  const dataDir = await temporaryDataDir()
  const store = createAgentStore({ dataDir })
  await store.init()
  const session = await store.createSession({ status: 'idle' })
  const invalidInput = (error) =>
    error instanceof AgentError && error.status === 400 && error.code === 'AGENT_STORE_INVALID_INPUT'

  await assert.rejects(store.getSession('not-a-uuid'), invalidInput)
  assert.equal((await store.getSession(session.id.toUpperCase())).id, session.id)
  await assert.rejects(store.appendMessage(session.id, { runId: 'not-a-uuid' }), invalidInput)
  await assert.rejects(store.createSession({ status: 'queued' }), invalidInput)
  await assert.rejects(store.updateSession(session.id, { status: 'queued' }), invalidInput)
  await assert.rejects(store.createRun(session.id, { status: 'queued' }), invalidInput)
  await assert.rejects(store.createRun(session.id, { deadlineAt: Infinity }), invalidInput)
  await assert.rejects(store.createRun(session.id, { deadlineAt: -1 }), invalidInput)
  await assert.rejects(store.createRun(session.id, { budget: { startedAt: NaN } }), invalidInput)
  await assert.rejects(store.createRun(session.id, { budget: { toolCalls: 1.5 } }), invalidInput)
  await assert.rejects(store.createRun(session.id, { budget: { toolCalls: -1 } }), invalidInput)
})

test('rejects invalid session fields and invalid server times before writing', async () => {
  const dataDir = await temporaryDataDir()
  const store = createAgentStore({ dataDir })
  await store.init()
  const invalidInput = (error) =>
    error instanceof AgentError && error.status === 400 && error.code === 'AGENT_STORE_INVALID_INPUT'

  for (const input of [
    { title: 1 }, { connectionId: null }, { database: [] },
    { retentionPolicy: {} }, { environment: 'prod' },
  ]) {
    await assert.rejects(store.createSession(input), invalidInput)
  }
  const session = await store.createSession({})
  await assert.rejects(store.updateSession(session.id, { title: false }), invalidInput)
  await assert.rejects(store.updateSession(session.id, { environment: 'stage' }), invalidInput)

  const badClockDir = await temporaryDataDir()
  const badClock = createAgentStore({ dataDir: badClockDir, now: () => Infinity })
  await badClock.init()
  await assert.rejects(badClock.createSession({}), invalidInput)
  assert.deepEqual(await readdir(join(badClockDir, 'agent', 'v1', 'sessions')), [])
})

test('quarantines valid JSON with malformed message, run, or event structures', async () => {
  for (const collection of ['messages', 'runs', 'events']) {
    const dataDir = await temporaryDataDir()
    const store = createAgentStore({ dataDir, now: () => 10 })
    await store.init()
    const session = await store.createSession({})
    const path = join(dataDir, 'agent', 'v1', 'sessions', `${session.id}.json`)
    const disk = JSON.parse(await readFile(path, 'utf8'))
    disk[collection] = [{}]
    await writeFile(path, JSON.stringify(disk))

    const reopened = createAgentStore({ dataDir, now: () => 20 })
    await reopened.init()
    assert.equal(await reopened.getSession(session.id), undefined)
    assert.ok((await readdir(join(dataDir, 'agent', 'v1', 'sessions')))
      .includes(`${session.id}.json.corrupt-20`))
  }
})

test('rejects run IDs associated with another session', async () => {
  const dataDir = await temporaryDataDir()
  const store = createAgentStore({ dataDir })
  await store.init()
  const first = await store.createSession({ title: 'first' })
  const second = await store.createSession({ title: 'second' })
  const run = await store.createRun(first.id, {})
  const missingRun = (error) =>
    error instanceof AgentError && error.status === 404 && error.code === 'AGENT_RUN_NOT_FOUND'

  await assert.rejects(store.updateRun(second.id, run.id, { status: 'running' }), missingRun)
  await assert.rejects(store.appendEvent(second.id, run.id, { type: 'run.status' }), missingRun)
  await assert.rejects(store.appendMessage(second.id, {
    runId: run.id, role: 'user', content: 'cross-session',
  }), missingRun)
  assert.equal((await store.getSession(second.id)).runs.length, 0)
  assert.equal((await store.getSession(second.id)).messages.length, 0)
  assert.equal((await store.getSession(second.id)).events.length, 0)
})
