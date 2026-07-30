import { BridgeError, bridgeApiBase, bridgeRequest, currentBridgeSessionId } from './api.ts'
import type {
  AgentEvent, AgentProviderProbe, AgentProviderSettings,
  AgentSessionDetail, AgentSessionSummary,
} from './agent-types.ts'

type Fetch = typeof fetch
type Timer = ReturnType<typeof setTimeout>
type Timers = {
  setTimeout: (callback: () => void, delay: number) => Timer
  clearTimeout: (timer: Timer) => void
}

export interface AgentEventHandlers {
  event: (event: AgentEvent) => void
  error?: (error: unknown) => void
}

export interface AgentBridgeClientOptions {
  fetchImpl?: Fetch
  timers?: Timers
  apiBase?: () => string
  sessionId?: () => string
}

const delays = [500, 1000, 2000, 5000] as const

function redactToken(value: unknown, token: string, seen = new WeakSet<object>()): unknown {
  if (typeof value === 'string') return token ? value.split(token).join('[REDACTED]') : value
  if (!value || typeof value !== 'object' || seen.has(value)) return value
  seen.add(value)
  if (Array.isArray(value)) return value.map(item => redactToken(item, token, seen))
  const result: Record<string, unknown> = {}
  for (const [key, descriptor] of Object.entries(Object.getOwnPropertyDescriptors(value))) {
    if ('value' in descriptor) result[key] = redactToken(descriptor.value, token, seen)
  }
  return result
}

async function responseBody<T>(response: Response, token = ''): Promise<T> {
  if (!response.ok) {
    const body = await response.json().catch(() => ({ message: response.statusText })) as {
      message?: string
      code?: string
      details?: unknown
    }
    const message = redactToken(body.message || `HTTP ${response.status}`, token) as string
    throw new BridgeError(
      message,
      body.code || 'HTTP_ERROR',
      response.status,
      redactToken(body.details, token),
    )
  }
  if (response.status === 204) return undefined as T
  return response.json() as Promise<T>
}

function dispatchFrame(
  lines: string[],
  handlers: AgentEventHandlers,
  lastSequence: number,
): number | undefined {
  let id: string | undefined
  let type = 'message'
  const data: string[] = []
  for (const line of lines) {
    if (!line || line.startsWith(':')) continue
    const separator = line.indexOf(':')
    const field = separator < 0 ? line : line.slice(0, separator)
    let value = separator < 0 ? '' : line.slice(separator + 1)
    if (value.startsWith(' ')) value = value.slice(1)
    if (field === 'id') id = value
    else if (field === 'event') type = value
    else if (field === 'data') data.push(value)
  }
  if (!data.length) return undefined
  try {
    const payload = JSON.parse(data.join('\n')) as Record<string, unknown>
    const sequence = Number(id)
    if (!Number.isSafeInteger(sequence) || sequence <= lastSequence) return undefined
    handlers.event({ sequence, type, payload })
    return sequence
  } catch (error) {
    handlers.error?.(error)
    return undefined
  }
}

export function createAgentBridgeClient(options: AgentBridgeClientOptions = {}) {
  const fetchImpl = options.fetchImpl ?? fetch
  const timers = options.timers ?? { setTimeout, clearTimeout }
  const getBase = options.apiBase ?? bridgeApiBase
  const getSession = options.sessionId ?? currentBridgeSessionId

  async function request<T>(path: string, init?: RequestInit): Promise<T> {
    if (!options.fetchImpl && !options.apiBase && !options.sessionId) {
      return bridgeRequest<T>(path, init)
    }
    const token = getSession()
    const response = await fetchImpl(`${getBase()}${path}`, {
      ...init,
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...init?.headers,
      },
    })
    return responseBody<T>(response, token)
  }

  return {
    listSessions: () => request<AgentSessionSummary[]>('/agent/sessions'),
    createSession: (input: {
      connectionId?: string
      title?: string
      database?: string
      retentionPolicy?: string
    }) => request<AgentSessionDetail>('/agent/sessions', {
      method: 'POST', body: JSON.stringify(input),
    }),
    getSession: (id: string) =>
      request<AgentSessionDetail>(`/agent/sessions/${encodeURIComponent(id)}`),
    updateSession: (id: string, patch: {
      title?: string
      database?: string
      retentionPolicy?: string
    }) => request<AgentSessionDetail>(`/agent/sessions/${encodeURIComponent(id)}`, {
      method: 'PATCH', body: JSON.stringify(patch),
    }),
    deleteSession: (id: string) =>
      request<void>(`/agent/sessions/${encodeURIComponent(id)}`, { method: 'DELETE' }),
    sendMessage: (id: string, message: string, settings?: AgentProviderSettings) =>
      request<{ runId: string; status: string }>(
        `/agent/sessions/${encodeURIComponent(id)}/messages`,
        { method: 'POST', body: JSON.stringify({ message, ...(settings ? { settings } : {}) }) },
      ),
    stop: (id: string) =>
      request<{ stopped: boolean }>(`/agent/sessions/${encodeURIComponent(id)}/stop`, {
        method: 'POST', body: JSON.stringify({}),
      }),
    probeProvider: (settings: AgentProviderSettings) =>
      request<AgentProviderProbe>('/agent/provider/probe', {
        method: 'POST', body: JSON.stringify({ settings }),
      }),
    subscribe(id: string, after: number, handlers: AgentEventHandlers) {
      const controller = new AbortController()
      let retry: Timer | undefined
      let retryIndex = 0
      let lastSequence = after
      let activeReader: ReadableStreamDefaultReader<Uint8Array> | undefined

      const connect = async () => {
        if (controller.signal.aborted) return
        let shouldReconnect = true
        try {
          const token = getSession()
          const response = await fetchImpl(
            `${getBase()}/agent/sessions/${encodeURIComponent(id)}/events?after=${lastSequence}`,
            {
              headers: {
                Accept: 'text/event-stream',
                ...(token ? { Authorization: `Bearer ${token}` } : {}),
              },
              signal: controller.signal,
            },
          )
          if (!response.ok) {
            shouldReconnect = response.status === 408 || response.status === 429 || response.status >= 500
            await responseBody(response, token)
          }
          if (!response.body) throw new BridgeError('SSE response has no body', 'AGENT_STREAM_INVALID', 502)

          const reader = response.body.getReader()
          activeReader = reader
          const decoder = new TextDecoder()
          let buffer = ''
          let frame: string[] = []
          try {
            while (!controller.signal.aborted) {
              const { value, done } = await reader.read()
              buffer += decoder.decode(value, { stream: !done })
              const lines: string[] = []
              while (true) {
                const separator = buffer.search(/[\r\n]/)
                if (separator < 0 || (!done && buffer[separator] === '\r' && separator === buffer.length - 1)) break
                lines.push(buffer.slice(0, separator))
                const width = buffer[separator] === '\r' && buffer[separator + 1] === '\n' ? 2 : 1
                buffer = buffer.slice(separator + width)
              }
              if (done && buffer) {
                lines.push(buffer)
                buffer = ''
              }
              for (const line of lines) {
                if (line === '') {
                  const sequence = dispatchFrame(frame, handlers, lastSequence)
                  frame = []
                  if (sequence !== undefined) {
                    lastSequence = sequence
                    retryIndex = 0
                  }
                } else {
                  frame.push(line)
                }
              }
              if (done) {
                const sequence = dispatchFrame(frame, handlers, lastSequence)
                if (sequence !== undefined) {
                  lastSequence = sequence
                  retryIndex = 0
                }
                break
              }
            }
          } finally {
            try { await reader.cancel() } catch {}
            try { reader.releaseLock() } catch {}
            if (activeReader === reader) activeReader = undefined
          }
        } catch (error) {
          if (!controller.signal.aborted) handlers.error?.(error)
        }
        if (!controller.signal.aborted && shouldReconnect) {
          const delay = delays[Math.min(retryIndex, delays.length - 1)]
          retryIndex += 1
          retry = timers.setTimeout(connect, delay)
        }
      }

      void connect()
      return () => {
        controller.abort()
        void activeReader?.cancel().catch(() => {})
        if (retry !== undefined) timers.clearTimeout(retry)
      }
    },
  }
}

export const agentBridge = createAgentBridgeClient()
