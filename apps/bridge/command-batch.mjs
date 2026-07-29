const QUERY = /^(select|show|describe|explain)\b/i
const INSERT = /^insert(?:\s+into\b)?\s+/i
const WRITE = /^write\s+/i

function commandError(code, message) {
  const error = new Error(message)
  error.code = code
  return error
}

export function splitStatements(script) {
  if (typeof script !== 'string') {
    throw commandError('INVALID_COMMAND_SCRIPT', 'Command script must be a string')
  }

  const statements = []
  let statement = ''
  let quote = null
  let escaped = false

  for (const character of script) {
    if (quote) {
      statement += character

      if (escaped) {
        escaped = false
      } else if (character === '\\') {
        escaped = true
      } else if (character === quote) {
        quote = null
      }
      continue
    }

    if (character === "'" || character === '"') {
      quote = character
      statement += character
    } else if (character === ';') {
      const trimmed = statement.trim()
      if (trimmed) statements.push(trimmed)
      statement = ''
    } else {
      statement += character
    }
  }

  if (quote) {
    throw commandError('INVALID_COMMAND_SCRIPT', 'Command script contains an unterminated string')
  }

  const trimmed = statement.trim()
  if (trimmed) statements.push(trimmed)
  return statements
}

export function commandKind(statement) {
  const normalized = typeof statement === 'string' ? statement.trim() : ''
  if (QUERY.test(normalized)) return 'query'
  if (INSERT.test(normalized)) return 'insert'
  if (WRITE.test(normalized)) return 'write'
  return 'unsupported'
}

export function validateWriteBatch(script) {
  const statements = splitStatements(script)
  if (statements.length === 0) {
    throw commandError('INVALID_COMMAND_SCRIPT', 'Command script cannot be empty')
  }

  const kinds = statements.map(commandKind)
  if (kinds.includes('unsupported')) {
    throw commandError('UNSUPPORTED_COMMAND', 'Command script contains an unsupported command')
  }

  const hasQuery = kinds.includes('query')
  const hasWrite = kinds.some(kind => kind === 'insert' || kind === 'write')
  if (hasQuery && hasWrite) {
    throw commandError('MIXED_COMMAND_BATCH', 'Command script cannot mix queries and writes')
  }
  if (hasQuery) {
    throw commandError('UNSUPPORTED_COMMAND', 'Command batch must contain only write commands')
  }

  return { statements, kind:'write-batch' }
}
