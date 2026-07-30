import { AGENT_LIMITS, AgentError } from './agent-types.mjs'

const READ_TOOLS = new Set([
  'list_databases',
  'list_measurements',
  'get_schema',
  'query_influxql',
  'verify_data',
  'get_bulk_job',
  'preview_bulk_data',
])
const WRITE_TOOLS = new Set([
  'write_points',
  'create_bulk_job',
])
const ALLOWED_SQL_STARTS = new Set(['SELECT', 'SHOW', 'DESCRIBE', 'EXPLAIN'])
const FORBIDDEN_SQL_WORDS = /\b(?:DROP|DELETE|ALTER|CREATE|GRANT|REVOKE)\b/i
const SENSITIVE_KEY = /^(?:password|apiKey|authorization|cookie|token|secret|sessionId)$/i

function policyDenied(message, details) {
  throw new AgentError(403, 'AGENT_POLICY_DENIED', message, details)
}

export function assertToolEnvironment(session, tool) {
  if (!session || !['dev', 'test'].includes(session.environment)) {
    policyDenied('Agent tools require a development or test connection')
  }
  if (!READ_TOOLS.has(tool) && !WRITE_TOOLS.has(tool)) {
    policyDenied('Agent tool is not allowed', { tool })
  }
  if (WRITE_TOOLS.has(tool) && session.readOnly !== false) {
    policyDenied('Agent write tools require a writable connection', { tool })
  }
}

function maskSqlLiteralsAndComments(sql) {
  let result = ''
  let state = 'code'
  let quote

  for (let index = 0; index < sql.length; index += 1) {
    const char = sql[index]
    const next = sql[index + 1]

    if (state === 'line-comment') {
      if (char === '\n' || char === '\r') {
        state = 'code'
        result += char
      } else {
        result += ' '
      }
      continue
    }
    if (state === 'block-comment') {
      if (char === '*' && next === '/') {
        result += '  '
        index += 1
        state = 'code'
      } else {
        result += ' '
      }
      continue
    }
    if (state === 'string') {
      result += ' '
      if (char === quote) {
        if (next === quote) {
          result += ' '
          index += 1
        } else {
          state = 'code'
          quote = undefined
        }
      } else if (char === '\\' && next !== undefined) {
        result += ' '
        index += 1
      }
      continue
    }
    if (state === 'regex') {
      result += ' '
      if (char === '\\' && next !== undefined) {
        result += ' '
        index += 1
      } else if (char === '/') {
        state = 'code'
      }
      continue
    }
    if (char === '-' && next === '-') {
      result += '  '
      index += 1
      state = 'line-comment'
    } else if (char === '/' && next === '*') {
      result += '  '
      index += 1
      state = 'block-comment'
    } else if (char === "'" || char === '"') {
      result += ' '
      state = 'string'
      quote = char
    } else if (
      char === '/'
      && /(?:=~|!~|\bFROM|,)\s*$/i.test(result)
    ) {
      result += ' '
      state = 'regex'
    } else {
      result += char
    }
  }

  if (state === 'block-comment' || state === 'string' || state === 'regex') {
    policyDenied('SQL contains an unterminated comment, string, or regular expression')
  }
  return result
}

export function assertQuerySql(sql) {
  if (typeof sql !== 'string' || !sql.trim()) policyDenied('SQL is required')

  const masked = maskSqlLiteralsAndComments(sql).trim()
  const statement = masked.endsWith(';') ? masked.slice(0, -1).trimEnd() : masked
  if (!statement || statement.includes(';')) policyDenied('Only one SQL statement is allowed')

  const firstWord = statement.match(/^[A-Za-z]+/)?.[0].toUpperCase()
  if (!ALLOWED_SQL_STARTS.has(firstWord)) policyDenied('Only read-only SQL is allowed')
  if (FORBIDDEN_SQL_WORDS.test(statement) || /\bINTO\b/i.test(statement)) {
    policyDenied('SQL mutations and administrative commands are not allowed')
  }
  return sql
}

export function assertBudget(run, now) {
  if (
    run === null
    || typeof run !== 'object'
    || !Number.isInteger(run.toolCallCount)
    || run.toolCallCount < 0
    || !Number.isFinite(run.deadlineAt)
    || !Number.isFinite(now)
  ) {
    throw new AgentError(400, 'AGENT_BUDGET_INVALID', 'Agent run budget is invalid')
  }
  if (run.toolCallCount >= AGENT_LIMITS.maxToolCalls || now > run.deadlineAt) {
    throw new AgentError(429, 'AGENT_BUDGET_EXCEEDED', 'Agent run budget exceeded')
  }
}

export function redactSensitive(value) {
  const seen = new WeakMap()

  function redact(nested) {
    if (nested === null || typeof nested !== 'object') return nested
    const prototype = Object.getPrototypeOf(nested)
    if (!Array.isArray(nested) && prototype !== Object.prototype && prototype !== null) return nested
    if (seen.has(nested)) return '[Circular]'

    const output = Array.isArray(nested) ? [] : Object.create(prototype)
    seen.set(nested, output)
    const descriptors = Object.getOwnPropertyDescriptors(nested)
    for (const key of Object.keys(descriptors)) {
      const descriptor = descriptors[key]
      if (!descriptor.enumerable) continue
      const redacted = 'value' in descriptor
        ? (SENSITIVE_KEY.test(key) ? '[REDACTED]' : redact(descriptor.value))
        : '[Accessor]'
      Object.defineProperty(output, key, {
        value:redacted,
        enumerable:true,
        configurable:true,
        writable:true,
      })
    }
    return output
  }

  return redact(value)
}
