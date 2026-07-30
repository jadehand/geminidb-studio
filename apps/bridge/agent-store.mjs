import { randomUUID } from 'node:crypto'
import { access, mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { dirname, join, resolve, sep } from 'node:path'
import { AgentError, isTerminalRunStatus } from './agent-types.mjs'

const summary = ({ messages, runs, events, ...session }) => session
const queues = new Map()
const sensitiveKey = /password|secret|token|credential|authorization|api[-_]?key/i
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const statuses = new Set([
  'idle', 'planning', 'running', 'verifying', 'completed', 'stopped',
  'budget_exceeded', 'blocked', 'failed', 'interrupted',
])
const isPlainObject = (value) => value !== null && typeof value === 'object' &&
  !Array.isArray(value) && Object.getPrototypeOf(value) === Object.prototype
const validTime = (value) => Number.isFinite(value) && value >= 0
const validUuid = (value) => typeof value === 'string' && uuidPattern.test(value)
const validStatus = (value) => statuses.has(value)

function validSummary(item) {
  return isPlainObject(item) && validUuid(item.id) && typeof item.title === 'string' &&
    typeof item.connectionId === 'string' && (item.environment === 'dev' || item.environment === 'test') &&
    typeof item.database === 'string' && typeof item.retentionPolicy === 'string' &&
    validStatus(item.status) && validTime(item.createdAt) && validTime(item.updatedAt)
}

function validBudget(budget) {
  if (!isPlainObject(budget)) return false
  return ['startedAt', 'deadlineAt'].every((key) => budget[key] === undefined || validTime(budget[key])) &&
    ['toolCalls', 'maxToolCalls'].every((key) =>
      budget[key] === undefined || (Number.isSafeInteger(budget[key]) && budget[key] >= 0))
}

function validSession(session, expectedId) {
  if (!isPlainObject(session) || session.id !== expectedId ||
      !validSummary(summary(session)) ||
      !Array.isArray(session.messages) || !Array.isArray(session.runs) || !Array.isArray(session.events)) {
    return false
  }
  const runIds = new Set()
  for (const run of session.runs) {
    if (!isPlainObject(run) || !validUuid(run.id) || run.sessionId !== expectedId ||
        typeof run.provider !== 'string' || typeof run.model !== 'string' ||
        !validStatus(run.status) || !Array.isArray(run.plan) || !validBudget(run.budget) ||
        !validTime(run.createdAt) || !validTime(run.updatedAt) || runIds.has(run.id)) return false
    runIds.add(run.id)
  }
  const messageIds = new Set()
  for (const message of session.messages) {
    if (!isPlainObject(message) || !validUuid(message.id) || message.sessionId !== expectedId ||
        typeof message.role !== 'string' || typeof message.content !== 'string' ||
        !validTime(message.createdAt) || messageIds.has(message.id) ||
        (message.runId != null && (!validUuid(message.runId) || !runIds.has(message.runId)))) return false
    messageIds.add(message.id)
  }
  const eventIds = new Set()
  let previous = 0
  for (const event of session.events) {
    if (!isPlainObject(event) || !validUuid(event.id) || eventIds.has(event.id) ||
        !Number.isSafeInteger(event.sequence) || event.sequence <= previous ||
        event.sequence <= 0 || event.sessionId !== expectedId || typeof event.type !== 'string' ||
        !validTime(event.createdAt) ||
        (event.runId != null && (!validUuid(event.runId) || !runIds.has(event.runId)))) return false
    eventIds.add(event.id)
    previous = event.sequence
  }
  return true
}

function safe(value) {
  if (Array.isArray(value)) return value.map(safe)
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value)
      .filter(([key]) => !sensitiveKey.test(key))
      .map(([key, item]) => [key, safe(item)]))
  }
  return value
}

const pick = (input = {}, fields) => Object.fromEntries(fields
  .filter((field) => input[field] !== undefined)
  .map((field) => [field, safe(input[field])]))
const sessionFields = ['title', 'connectionId', 'environment', 'database', 'retentionPolicy', 'status']
const messageFields = ['role', 'content', 'runId', 'toolCallId', 'result', 'usage']
const runFields = ['provider', 'model', 'status', 'plan', 'budget', 'stopReason']
const eventFields = ['type', 'payload', 'status', 'tool', 'inputSummary', 'durationMs', 'rowCount', 'errorCode']

export function createAgentStore({ dataDir, now = Date.now } = {}) {
  const root = dataDir && join(dataDir, 'agent', 'v1')
  const sessionsDir = root && join(root, 'sessions')
  const resolvedSessionsDir = sessionsDir && resolve(sessionsDir)
  const indexPath = root && join(root, 'index.json')
  let index = []
  if (root && !queues.has(root)) queues.set(root, Promise.resolve())

  const unavailable = () => new AgentError(503, 'AGENT_STORE_UNAVAILABLE', 'Agent store data directory is unavailable')
  const invalid = (message) => new AgentError(400, 'AGENT_STORE_INVALID_INPUT', message)
  const assertId = (id, name) => {
    if (typeof id !== 'string' || !uuidPattern.test(id)) throw invalid(`Invalid ${name}`)
    return id.toLowerCase()
  }
  const assertStatus = (status) => {
    if (status !== undefined && !statuses.has(status)) throw invalid('Invalid status')
  }
  const assertFiniteNonNegative = (value, name) => {
    if (value !== undefined && (!Number.isFinite(value) || value < 0)) throw invalid(`Invalid ${name}`)
  }
  const assertSafeCount = (value, name) => {
    if (value !== undefined && (!Number.isSafeInteger(value) || value < 0)) throw invalid(`Invalid ${name}`)
  }
  const validateSessionInput = (input = {}) => {
    if (!isPlainObject(input)) throw invalid('Invalid session')
    for (const field of ['title', 'connectionId', 'database', 'retentionPolicy']) {
      if (input[field] !== undefined && typeof input[field] !== 'string') throw invalid(`Invalid ${field}`)
    }
    if (input.environment !== undefined && input.environment !== 'dev' && input.environment !== 'test') {
      throw invalid('Invalid environment')
    }
    assertStatus(input.status)
  }
  const validateRunInput = (input = {}) => {
    assertStatus(input.status)
    assertFiniteNonNegative(input.deadlineAt, 'deadlineAt')
    if (input.budget !== undefined) {
      if (!input.budget || typeof input.budget !== 'object' || Array.isArray(input.budget)) {
        throw invalid('Invalid budget')
      }
      assertFiniteNonNegative(input.budget.startedAt, 'startedAt')
      assertFiniteNonNegative(input.budget.deadlineAt, 'deadlineAt')
      assertSafeCount(input.budget.toolCalls, 'toolCalls')
      assertSafeCount(input.budget.maxToolCalls, 'maxToolCalls')
    }
  }
  const sessionPath = (id) => {
    id = assertId(id, 'sessionId')
    const path = resolve(resolvedSessionsDir, `${id}.json`)
    if (dirname(path) !== resolvedSessionsDir || !path.startsWith(`${resolvedSessionsDir}${sep}`)) {
      throw invalid('Invalid sessionId')
    }
    return path
  }
  const clone = (value) => value === undefined ? undefined : structuredClone(value)

  async function atomicWrite(target, value) {
    const temporary = `${target}.${randomUUID()}.tmp`
    try {
      await writeFile(temporary, JSON.stringify(value), { encoding: 'utf8', mode: 0o600 })
      await rename(temporary, target)
    } finally {
      await rm(temporary, { force: true })
    }
  }

  async function quarantine(path) {
    const base = `${path}.corrupt-${now()}`
    let target = base
    for (let suffix = 1; ; suffix += 1) {
      try {
        await access(target)
        target = `${base}-${suffix}`
        continue
      } catch (error) {
        if (error.code !== 'ENOENT') throw error
      }
      try {
        await rename(path, target)
        return
      } catch (error) {
        if (error.code === 'ENOENT') return
        throw error
      }
    }
  }

  async function readJson(path) {
    try {
      return JSON.parse(await readFile(path, 'utf8'))
    } catch (error) {
      if (error.code === 'ENOENT') return undefined
      if (error instanceof SyntaxError) {
        await quarantine(path)
        return undefined
      }
      throw error
    }
  }

  async function loadSession(id) {
    const path = sessionPath(id)
    const session = await readJson(path)
    if (session === undefined) return undefined
    if (!validSession(session, id)) {
      await quarantine(path)
      return undefined
    }
    return session
  }

  async function loadIndex() {
    const stored = await readJson(indexPath)
    if (stored === undefined) return []
    if (!Array.isArray(stored) || !stored.every(validSummary)) {
      await quarantine(indexPath)
      return []
    }
    return stored
  }

  async function saveSession(session) {
    session.updatedAt = now()
    if (!validSession(session, session.id)) throw invalid('Invalid session')
    await atomicWrite(sessionPath(session.id), session)
    index = await loadIndex()
    const position = index.findIndex(({ id }) => id === session.id)
    const item = summary(session)
    if (position < 0) index.push(item)
    else index[position] = item
    await atomicWrite(indexPath, index)
    return clone(session)
  }

  function exclusive(operation) {
    if (!root) return operation()
    const result = queues.get(root).then(operation)
    queues.set(root, result.catch(() => {}))
    return result
  }

  async function requireSession(id) {
    const session = await loadSession(id)
    if (!session) throw new AgentError(404, 'AGENT_SESSION_NOT_FOUND', `Agent session not found: ${id}`)
    return session
  }

  return {
    init: () => exclusive(async () => {
      if (!root) throw unavailable()
      await mkdir(sessionsDir, { recursive: true, mode: 0o700 })
      index = await loadIndex()
      const valid = []
      for (const item of index) {
        const session = await loadSession(item.id)
        if (!session) continue
        let changed = false
        for (const run of session.runs ?? []) {
          if (isTerminalRunStatus(run.status)) continue
          run.status = 'interrupted'
          run.updatedAt = now()
          session.events ??= []
          session.events.push({
            id: randomUUID(), sequence: (session.events.at(-1)?.sequence ?? 0) + 1,
            sessionId: session.id, runId: run.id, type: 'run.status',
            payload: { status: 'interrupted' }, createdAt: now(),
          })
          changed = true
        }
        if (changed) {
          session.status = 'interrupted'
          session.updatedAt = now()
          await atomicWrite(sessionPath(session.id), session)
        }
        valid.push(summary(session))
      }
      index = valid
      await atomicWrite(indexPath, index)
    }),

    createSession: (input) => exclusive(async () => {
      input ??= {}
      validateSessionInput(input)
      const timestamp = now()
      const session = {
        title: input.title ?? '', connectionId: input.connectionId ?? '',
        environment: input.environment ?? 'dev', database: input.database ?? '',
        retentionPolicy: input.retentionPolicy ?? '', ...pick(input, sessionFields),
        status: input.status ?? 'planning', id: randomUUID(), createdAt: timestamp, updatedAt: timestamp,
        messages: [], runs: [], events: [],
      }
      return saveSession(session)
    }),

    listSessions: async () => {
      index = await loadIndex()
      return clone(index)
    },
    getSession: async (id) => {
      id = assertId(id, 'sessionId')
      return clone(await loadSession(id))
    },

    updateSession: (id, patch) => exclusive(async () => {
      id = assertId(id, 'sessionId')
      patch ??= {}
      validateSessionInput(patch)
      const session = await requireSession(id)
      Object.assign(session, pick(patch, sessionFields))
      return saveSession(session)
    }),

    appendMessage: (id, input) => exclusive(async () => {
      id = assertId(id, 'sessionId')
      if (input?.runId !== undefined) {
        input = { ...input, runId: assertId(input.runId, 'runId') }
      }
      const session = await requireSession(id)
      if (input?.runId !== undefined && !session.runs.some(({ id: runId }) => runId === input.runId)) {
        throw new AgentError(404, 'AGENT_RUN_NOT_FOUND', `Agent run not found: ${input.runId}`)
      }
      const message = { ...pick(input, messageFields), id: randomUUID(), sessionId: id, createdAt: now() }
      session.messages.push(message)
      await saveSession(session)
      return clone(message)
    }),

    createRun: (id, input) => exclusive(async () => {
      id = assertId(id, 'sessionId')
      input ??= {}
      validateRunInput(input)
      const session = await requireSession(id)
      const timestamp = now()
      const run = {
        provider: input.provider ?? '', model: input.model ?? '', ...pick(input, runFields),
        status: input.status ?? 'planning', plan: safe(input.plan ?? []),
        budget: safe(input.budget ?? {
          toolCalls: 0, maxToolCalls: 12, startedAt: timestamp, deadlineAt: input.deadlineAt,
        }),
        id: randomUUID(), sessionId: id, createdAt: timestamp, updatedAt: timestamp,
      }
      session.runs.push(run)
      session.status = run.status
      await saveSession(session)
      return clone(run)
    }),

    updateRun: (sessionId, runId, patch) => exclusive(async () => {
      sessionId = assertId(sessionId, 'sessionId')
      runId = assertId(runId, 'runId')
      validateRunInput(patch)
      const session = await requireSession(sessionId)
      const run = session.runs.find(({ id }) => id === runId)
      if (!run) throw new AgentError(404, 'AGENT_RUN_NOT_FOUND', `Agent run not found: ${runId}`)
      Object.assign(run, pick(patch, runFields), { updatedAt: now() })
      session.status = run.status
      await saveSession(session)
      return clone(run)
    }),

    appendEvent: (sessionId, runId, input) => exclusive(async () => {
      sessionId = assertId(sessionId, 'sessionId')
      if (runId !== undefined && runId !== null) runId = assertId(runId, 'runId')
      assertFiniteNonNegative(input?.durationMs, 'durationMs')
      const session = await requireSession(sessionId)
      if (runId != null && !session.runs.some(({ id }) => id === runId)) {
        throw new AgentError(404, 'AGENT_RUN_NOT_FOUND', `Agent run not found: ${runId}`)
      }
      const event = {
        ...pick(input, eventFields), id: randomUUID(),
        sequence: (session.events.at(-1)?.sequence ?? 0) + 1,
        sessionId, runId, createdAt: now(),
      }
      session.events.push(event)
      await saveSession(session)
      return clone(event)
    }),

    eventsAfter: async (sessionId, sequence) => {
      sessionId = assertId(sessionId, 'sessionId')
      const session = await requireSession(sessionId)
      return clone(session.events.filter((event) => event.sequence > sequence))
    },

    deleteSession: (id) => exclusive(async () => {
      id = assertId(id, 'sessionId')
      await rm(sessionPath(id), { force: true })
      index = await loadIndex()
      index = index.filter((item) => item.id !== id)
      await atomicWrite(indexPath, index)
    }),
  }
}
