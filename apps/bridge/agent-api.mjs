import { AgentError, isTerminalRunStatus } from './agent-types.mjs'

const SESSION_PATH = /^\/agent\/sessions\/([^/]+)$/
const MESSAGE_PATH = /^\/agent\/sessions\/([^/]+)\/messages$/
const STOP_PATH = /^\/agent\/sessions\/([^/]+)\/stop$/
const EVENTS_PATH = /^\/agent\/sessions\/([^/]+)\/events$/

const result = (status, body) => ({ status, body })
const badRequest = (code, message) => new AgentError(400, code, message)
const sensitiveKey = /api[-_]?key|password|token|authorization|cookie|secret/i
const limits = Object.freeze({
  title:200, database:256, retentionPolicy:256, message:32_000,
  connectionId:512, model:200, endpoint:2_048, cliPath:1_024,
})
const isPlainObject = value => value !== null && typeof value === 'object' &&
  !Array.isArray(value) && Object.getPrototypeOf(value) === Object.prototype

function object(value, name) {
  if (!isPlainObject(value)) throw badRequest('AGENT_INPUT_INVALID', `${name} must be an object`)
  return value
}

function fields(value, allowed, name) {
  object(value, name)
  for (const key of Object.keys(value)) {
    if (!allowed.includes(key)) throw badRequest('AGENT_INPUT_INVALID', `Unknown ${name} field: ${key}`)
  }
  return value
}

function rejectCredentials(value, seen = new Set()) {
  if (value === null || typeof value !== 'object' || seen.has(value)) return
  seen.add(value)
  for (const key of Object.keys(value)) {
    if (sensitiveKey.test(key)) {
      throw badRequest('AGENT_CREDENTIALS_FORBIDDEN', 'Credentials are not accepted')
    }
    rejectCredentials(value[key], seen)
  }
}

function text(value, name, { required = false } = {}) {
  if (value === undefined && !required) return undefined
  if (typeof value !== 'string' || (required && !value.trim()) || value.length > limits[name]) {
    throw badRequest('AGENT_INPUT_INVALID', `Invalid ${name}`)
  }
  return value
}

function providerSettings(value = {}) {
  fields(value, ['provider', 'model', 'endpoint', 'cliPath', 'fallbackToApi'], 'settings')
  if (value.provider !== 'cli' && value.provider !== 'api') {
    throw badRequest('AGENT_INPUT_INVALID', 'provider must be cli or api')
  }
  if (value.fallbackToApi !== undefined && typeof value.fallbackToApi !== 'boolean') {
    throw badRequest('AGENT_INPUT_INVALID', 'fallbackToApi must be a boolean')
  }
  return {
    provider:value.provider,
    ...(value.model === undefined ? {} : { model:text(value.model, 'model') }),
    ...(value.endpoint === undefined ? {} : { endpoint:text(value.endpoint, 'endpoint') }),
    ...(value.cliPath === undefined ? {} : { cliPath:text(value.cliPath, 'cliPath') }),
    ...(value.fallbackToApi === undefined ? {} : { fallbackToApi:value.fallbackToApi }),
  }
}

function sessionId(pathname, pattern) {
  const value = pattern.exec(pathname)?.[1]
  if (!value) return undefined
  try {
    return decodeURIComponent(value)
  } catch {
    throw badRequest('AGENT_SESSION_INVALID', 'Invalid Agent session id')
  }
}

function sequence(searchParams) {
  const raw = searchParams?.get?.('after') ?? '0'
  if (!/^\d+$/.test(raw)) throw badRequest('AGENT_EVENT_SEQUENCE_INVALID', 'after must be a non-negative integer')
  const value = Number(raw)
  if (!Number.isSafeInteger(value)) throw badRequest('AGENT_EVENT_SEQUENCE_INVALID', 'after is too large')
  return value
}

function sseFrame(event) {
  return `id: ${event.sequence}\nevent: ${event.type}\ndata: ${JSON.stringify(event.payload ?? {})}\n\n`
}

async function requireSession(store, id) {
  const session = await store.getSession(id)
  if (!session) throw new AgentError(404, 'AGENT_SESSION_NOT_FOUND', 'Agent session not found')
  return session
}

function connectionIdentity(connection) {
  return connection?.connectionIdentity ?? connection?.bulkIdentity ?? connection?.id
}

function writeSse(response, chunk, state) {
  if (state.closed || state.waitingDrain) return false
  if (response.write(chunk) === false) {
    state.waitingDrain = true
    response.once('drain', () => {
      state.waitingDrain = false
      state.poll?.()
    })
    return false
  }
  return true
}

export function createAgentApi({
  store,
  orchestrator,
  provider,
  resolveConnection,
  pollIntervalMs = 250,
  keepaliveMs = 15_000,
} = {}) {
  if (!store || !orchestrator || !provider || typeof resolveConnection !== 'function') {
    throw new TypeError('store, orchestrator, provider and resolveConnection are required')
  }

  async function requireOwnedSession(bridgeSession, id) {
    const stored = await requireSession(store, id)
    try {
      const connection = await resolveConnection(bridgeSession, stored.connectionId)
      if (!connection || connectionIdentity(connection) !== stored.connectionId) throw new Error('not owned')
    } catch {
      throw new AgentError(404, 'AGENT_SESSION_NOT_FOUND', 'Agent session not found')
    }
    return stored
  }

  async function streamEvents({ request, response, bridgeSession, id, after }) {
    await requireOwnedSession(bridgeSession, id)
    response.writeHead(200, {
      'Content-Type':'text/event-stream; charset=utf-8',
      'Cache-Control':'no-cache, no-transform',
      Connection:'keep-alive',
      'X-Accel-Buffering':'no',
    })
    response.flushHeaders?.()

    const state = { closed:false, waitingDrain:false, last:after, polling:false }
    let pollTimer
    let keepaliveTimer

    const cleanup = () => {
      if (state.closed) return
      state.closed = true
      clearTimeout(pollTimer)
      clearInterval(keepaliveTimer)
      request?.off?.('close', cleanup)
      response?.off?.('close', cleanup)
      response?.off?.('error', cleanup)
    }
    state.poll = async () => {
      if (state.closed || state.polling || state.waitingDrain) return
      state.polling = true
      try {
        const events = await store.eventsAfter(id, state.last)
        for (const event of events) {
          const writable = writeSse(response, sseFrame(event), state)
          state.last = event.sequence
          if (!writable) break
        }
      } catch (error) {
        if (!state.closed) {
          writeSse(response, `event: error\ndata: ${JSON.stringify({
            code:error?.code || 'AGENT_EVENT_STREAM_FAILED',
            message:'Agent event stream failed',
          })}\n\n`, state)
          response.end()
          cleanup()
        }
      } finally {
        state.polling = false
        if (!state.closed && !state.waitingDrain) {
          pollTimer = setTimeout(state.poll, pollIntervalMs)
          pollTimer.unref?.()
        }
      }
    }

    request?.once?.('close', cleanup)
    response?.once?.('close', cleanup)
    response?.once?.('error', cleanup)
    keepaliveTimer = setInterval(() => writeSse(response, ': keepalive\n\n', state), keepaliveMs)
    keepaliveTimer.unref?.()
    await state.poll()
    return { handled:true, cleanup }
  }

  async function handle({
    request,
    response,
    pathname,
    method,
    session,
    payload = {},
    searchParams,
  }) {
    rejectCredentials(payload)
    payload = object(payload, 'payload')
    if (pathname === '/agent/sessions' && method === 'GET') {
      fields(payload, [], 'payload')
      const visible = []
      for (const item of await store.listSessions()) {
        try {
          const connection = await resolveConnection(session, item.connectionId)
          if (connection && connectionIdentity(connection) === item.connectionId) visible.push(item)
        } catch {
          // Missing and foreign connections are intentionally indistinguishable.
        }
      }
      return result(200, visible)
    }
    if (pathname === '/agent/sessions' && method === 'POST') {
      fields(payload, ['connectionId', 'title', 'database', 'retentionPolicy'], 'payload')
      text(payload.connectionId, 'connectionId')
      text(payload.title, 'title')
      text(payload.database, 'database')
      text(payload.retentionPolicy, 'retentionPolicy')
      const connection = await resolveConnection(session, payload.connectionId)
      if (!connection) throw new AgentError(404, 'AGENT_CONNECTION_NOT_FOUND', 'Connection not found')
      if (!['dev', 'test'].includes(connection.environment)) {
        throw new AgentError(403, 'AGENT_POLICY_DENIED', 'Agent requires a development or test connection')
      }
      const identity = connectionIdentity(connection)
      if (typeof identity !== 'string' || !identity) {
        throw new AgentError(400, 'AGENT_CONNECTION_INVALID', 'Connection identity is unavailable')
      }
      const created = await store.createSession({
        title:typeof payload.title === 'string' ? payload.title : '',
        connectionId:identity,
        environment:connection.environment,
        database:typeof payload.database === 'string' ? payload.database : '',
        retentionPolicy:typeof payload.retentionPolicy === 'string' ? payload.retentionPolicy : '',
      })
      return result(201, { ...created, readOnly:connection.readOnly === true })
    }
    if (pathname === '/agent/provider/probe' && method === 'POST') {
      fields(payload, ['settings', 'provider', 'model', 'endpoint', 'cliPath', 'fallbackToApi'], 'payload')
      if (payload.settings !== undefined && Object.keys(payload).length !== 1) {
        throw badRequest('AGENT_INPUT_INVALID', 'Use settings or direct provider fields, not both')
      }
      return result(200, await provider.probe(providerSettings(payload.settings ?? payload)))
    }

    const messageId = sessionId(pathname, MESSAGE_PATH)
    if (messageId && method === 'POST') {
      fields(payload, ['message', 'settings'], 'payload')
      const message = text(payload.message, 'message', { required:true })
      const settings = providerSettings(payload.settings ?? { provider:'cli' })
      await requireOwnedSession(session, messageId)
      const { runId, status, completion } =
        await orchestrator.startBackground(messageId, message, settings)
      completion.catch(() => {}) // The orchestrator persists terminal failures.
      return result(202, { runId, status })
    }

    const stopId = sessionId(pathname, STOP_PATH)
    if (stopId && method === 'POST') {
      fields(payload, [], 'payload')
      await requireOwnedSession(session, stopId)
      const stopped = await orchestrator.stop(stopId)
      return result(200, { stopped })
    }

    const eventsId = sessionId(pathname, EVENTS_PATH)
    if (eventsId && method === 'GET') {
      if (!request || !response) throw new TypeError('request and response are required for SSE')
      return streamEvents({
        request, response, bridgeSession:session, id:eventsId, after:sequence(searchParams),
      })
    }

    const id = sessionId(pathname, SESSION_PATH)
    if (id && method === 'GET') {
      fields(payload, [], 'payload')
      return result(200, await requireOwnedSession(session, id))
    }
    if (id && method === 'PATCH') {
      fields(payload, ['title', 'database', 'retentionPolicy'], 'payload')
      await requireOwnedSession(session, id)
      const patch = {}
      if (payload.title !== undefined) patch.title = text(payload.title, 'title')
      if (payload.database !== undefined) patch.database = text(payload.database, 'database')
      if (payload.retentionPolicy !== undefined) {
        patch.retentionPolicy = text(payload.retentionPolicy, 'retentionPolicy')
      }
      return result(200, await store.updateSession(id, patch))
    }
    if (id && method === 'DELETE') {
      fields(payload, [], 'payload')
      const current = await requireOwnedSession(session, id)
      const latest = current.runs?.at(-1)
      if (latest && !isTerminalRunStatus(latest.status)) {
        throw new AgentError(409, 'AGENT_RUN_CONFLICT', 'Cannot delete an active Agent session')
      }
      await store.deleteSession(id)
      return result(204, undefined)
    }
    return undefined
  }

  return { handle }
}
