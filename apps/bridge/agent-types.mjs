export const AGENT_LIMITS = Object.freeze({
  maxToolCalls: 12,
  maxRunMs: 300_000,
  maxQueryRows: 1_000,
  maxDirectWritePoints: 1_000,
})

export const TERMINAL_RUN_STATUSES = Object.freeze([
  'completed',
  'stopped',
  'budget_exceeded',
  'blocked',
  'failed',
  'interrupted',
])

export function isTerminalRunStatus(value) {
  return TERMINAL_RUN_STATUSES.includes(value)
}

export class AgentError extends Error {
  constructor(status, code, message, details) {
    super(message)
    this.name = 'AgentError'
    this.status = status
    this.code = code
    this.details = details
  }
}
