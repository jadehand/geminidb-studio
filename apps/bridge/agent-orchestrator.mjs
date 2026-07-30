import { AGENT_LIMITS, AgentError } from './agent-types.mjs'
import { redactSensitive } from './agent-policy.mjs'

const BLOCKED_CODES = new Set([
  'AGENT_TOOL_UNKNOWN',
  'AGENT_POLICY_DENIED',
  'AGENT_TOOL_INPUT_INVALID',
])

function conflict() {
  return new AgentError(409, 'AGENT_RUN_CONFLICT', 'Another Agent run is already active')
}

function errorDetails(error) {
  return {
    code:error?.code || 'AGENT_RUN_FAILED',
    message:'Agent tool execution failed',
  }
}

function deferred() {
  let resolve
  let reject
  const promise = new Promise((done, fail) => {
    resolve = done
    reject = fail
  })
  return { promise, resolve, reject }
}

export function createAgentOrchestrator({
  store, provider, tools, now = Date.now, maxRunMs = AGENT_LIMITS.maxRunMs,
}) {
  if (!store || !provider || !tools) throw new TypeError('store, provider and tools are required')
  let active

  async function status(sessionId, runId, value, stopReason) {
    const patch = { status:value }
    if (stopReason) patch.stopReason = stopReason
    const run = await store.updateRun(sessionId, runId, patch)
    await store.appendEvent(sessionId, runId, {
      type:'run.status',
      payload:{ status:value, ...(stopReason ? { stopReason } : {}) },
    })
    return run
  }

  function terminal(entry, sessionId, runId, value, stopReason) {
    if (!entry.terminalSaved) {
      entry.terminalValue = value
      entry.terminalSaved = status(sessionId, runId, value, stopReason)
    }
    return entry.terminalSaved
  }

  function termination(entry, sessionId, runId) {
    if (entry.terminalSaved) return entry.terminalSaved
    if (entry.deadlineExceeded) {
      return terminal(entry, sessionId, runId, 'budget_exceeded', 'deadline')
    }
    if (entry.stopping || entry.controller.signal.aborted) {
      return terminal(entry, sessionId, runId, 'stopped', 'user_requested')
    }
  }

  async function startBackground(sessionId, message, settings = {}) {
    if (active) throw conflict()
    if (typeof message !== 'string' || !message.trim()) {
      throw new AgentError(400, 'AGENT_MESSAGE_INVALID', 'Agent message is required')
    }

    const controller = new AbortController()
    const token = {}
    const runReady = deferred()
    const entry = {
      token, sessionId, controller, runId:null, stopping:false,
      deadlineExceeded:false, runReady:runReady.promise,
    }
    active = entry
    const started = deferred()
    const completion = (async () => {
      let run
      let deadlineTimer
      try {
      const session = await store.getSession(sessionId)
      if (!session) throw new AgentError(404, 'AGENT_SESSION_NOT_FOUND', 'Agent session not found')
      const startedAt = now()
      const deadlineAt = startedAt + maxRunMs
      const selectedProvider = settings.provider || 'cli'
      let activeProvider = selectedProvider
      const model = settings.model || ''
      await store.appendMessage(sessionId, { role:'user', content:message })
      run = await store.createRun(sessionId, {
        provider:selectedProvider,
        model,
        status:'planning',
        deadlineAt,
        budget:{
          toolCalls:0,
          maxToolCalls:AGENT_LIMITS.maxToolCalls,
          startedAt,
          deadlineAt,
        },
      })
      entry.runId = run.id
      deadlineTimer = setTimeout(() => {
        entry.deadlineExceeded = true
        controller.abort()
        terminal(entry, sessionId, run.id, 'budget_exceeded', 'deadline')
      }, Math.max(0, deadlineAt - now()))
      await store.appendEvent(sessionId, run.id, {
        type:'run.status',
        payload:redactSensitive({ status:'planning' }),
      })
      runReady.resolve(run.id)
      started.resolve({ runId:run.id, status:'planning' })
      run = await status(sessionId, run.id, 'running')

      const messages = [...(session.messages ?? []).map(({ role, content, toolCallId, result }) => ({
        role, content, ...(toolCallId ? { toolCallId } : {}), ...(result !== undefined ? { result } : {}),
      })), { role:'user', content:message }]

      while (true) {
        if (entry.deadlineExceeded || now() > run.budget.deadlineAt) {
          entry.deadlineExceeded = true
          return terminal(entry, sessionId, run.id, 'budget_exceeded', 'deadline')
        }
        if (active?.token !== token || entry.stopping || controller.signal.aborted) {
          return terminal(entry, sessionId, run.id, 'stopped', 'user_requested')
        }

        let response
        try {
          response = await provider.complete({
            provider:activeProvider,
            settings,
            messages,
            tools:tools.schemas ?? [],
          }, controller.signal)
        } catch (error) {
          if (
            activeProvider === 'cli'
            && settings.fallbackToApi === true
            && ['AGENT_PROVIDER_UNAVAILABLE', 'AGENT_PROVIDER_MISCONFIGURED'].includes(error?.code)
          ) {
            activeProvider = 'api'
            run = await store.updateRun(sessionId, run.id, { provider:activeProvider })
            response = await provider.complete({
              provider:activeProvider,
              settings,
              messages,
              tools:tools.schemas ?? [],
            }, controller.signal)
          } else {
            throw error
          }
        }
        const providerTermination = termination(entry, sessionId, run.id)
        if (providerTermination) return providerTermination

        if (response.kind === 'assistant_message') {
          const assistant = { role:'assistant', content:response.content, runId:run.id }
          if (response.usage) assistant.usage = response.usage
          await store.appendMessage(sessionId, assistant)
          messages.push({ role:'assistant', content:response.content })
          await store.appendEvent(sessionId, run.id, {
            type:'assistant.message',
            payload:redactSensitive({ content:response.content }),
          })
          continue
        }
        if (response.kind === 'final') {
          const assistant = { role:'assistant', content:response.content, runId:run.id }
          if (response.usage) assistant.usage = response.usage
          await store.appendMessage(sessionId, assistant)
          await store.appendEvent(sessionId, run.id, {
            type:'assistant.message',
            payload:redactSensitive({ content:response.content }),
          })
          return terminal(entry, sessionId, run.id, 'completed')
        }
        if (response.kind !== 'tool_call') {
          throw new AgentError(502, 'AGENT_MODEL_INVALID_RESPONSE', 'Agent model returned an invalid response')
        }
        if (run.budget.toolCalls >= AGENT_LIMITS.maxToolCalls) {
          return status(sessionId, run.id, 'budget_exceeded', 'tool_calls')
        }

        const budget = { ...run.budget, toolCalls:run.budget.toolCalls + 1 }
        run = await store.updateRun(sessionId, run.id, { budget })
        const safeInput = redactSensitive(response.input)
        const toolCallContent = JSON.stringify({
          content:response.content || '',
          toolCall:{ id:response.callId, tool:response.tool, input:safeInput },
        })
        await store.appendMessage(sessionId, {
          role:'assistant',
          content:toolCallContent,
          runId:run.id,
          toolCallId:response.callId,
        })
        await store.appendEvent(sessionId, run.id, {
          type:'tool.requested',
          tool:response.tool,
          payload:redactSensitive({ callId:response.callId, input:safeInput }),
        })

        let result
        let toolError
        for (let attempt = 0; attempt < 2; attempt += 1) {
          try {
            result = await tools.execute(response.tool, response.input, {
              agentSession:session,
              run,
              signal:controller.signal,
            })
            const toolTermination = termination(entry, sessionId, run.id)
            if (toolTermination) return toolTermination
            toolError = undefined
            break
          } catch (error) {
            toolError = error
            if (BLOCKED_CODES.has(error?.code) || controller.signal.aborted) break
          }
        }
        if (toolError) {
          const details = errorDetails(toolError)
          await store.appendEvent(sessionId, run.id, {
            type:'tool.failed',
            tool:response.tool,
            errorCode:details.code,
            payload:redactSensitive(details),
          })
          if (BLOCKED_CODES.has(toolError?.code)) {
            return terminal(entry, sessionId, run.id, 'blocked', details.code)
          }
          if (entry.deadlineExceeded) {
            return terminal(entry, sessionId, run.id, 'budget_exceeded', 'deadline')
          }
          if (controller.signal.aborted || entry.stopping) {
            return terminal(entry, sessionId, run.id, 'stopped', 'user_requested')
          }
          throw toolError
        }

        const safeResult = redactSensitive(result)
        await store.appendEvent(sessionId, run.id, {
          type:'tool.completed',
          tool:response.tool,
          payload:{ callId:response.callId, result:safeResult },
        })
        const toolMessage = {
          role:'tool',
          content:JSON.stringify(safeResult),
          runId:run.id,
          toolCallId:response.callId,
          result:safeResult,
        }
        await store.appendMessage(sessionId, toolMessage)
        messages.push({
          role:'assistant', content:toolCallContent, toolCallId:response.callId,
        }, {
          role:'tool',
          content:toolMessage.content,
          toolCallId:response.callId,
          result:safeResult,
        })
      }
      } catch (error) {
        started.reject(error)
        if (run) {
          const ended = termination(entry, sessionId, run.id)
          if (ended) return ended
          if (error?.code === 'AGENT_CANCELLED') {
            return terminal(entry, sessionId, run.id, 'stopped', 'user_requested')
          }
          const blocked = BLOCKED_CODES.has(error?.code)
          await terminal(
            entry, sessionId, run.id,
            blocked ? 'blocked' : 'failed',
            error?.code || 'AGENT_RUN_FAILED',
          )
        }
        throw error
      } finally {
        clearTimeout(deadlineTimer)
        runReady.resolve(run?.id ?? null)
        if (active?.token === token) active = undefined
      }
    })()
    completion.catch(() => {})
    const initial = await started.promise
    return { ...initial, completion }
  }

  async function start(sessionId, message, settings = {}) {
    const { completion } = await startBackground(sessionId, message, settings)
    return completion
  }

  async function stop(sessionId) {
    if (!active || active.sessionId !== sessionId) return false
    const entry = active
    entry.stopping = true
    entry.controller.abort()
    const runId = await entry.runReady
    if (runId) await terminal(entry, sessionId, runId, 'stopped', 'user_requested')
    return true
  }

  return {
    start,
    startBackground,
    stop,
    hasActiveRun:() => Boolean(active),
  }
}
