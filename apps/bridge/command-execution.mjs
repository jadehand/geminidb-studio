import { commandKind, splitStatements, validateWriteBatch } from './command-batch.mjs'
import { assertEnvironmentWritable } from './write-policy.mjs'

function commandError(code, message) {
  const error = new Error(message)
  error.code = code
  error.status = 400
  return error
}

function validatedSingleQuery(script) {
  let statements
  try {
    statements = splitStatements(script)
  } catch (error) {
    error.status ??= 400
    throw error
  }

  if (statements.length === 0) throw commandError('EMPTY_SQL', '命令不能为空')
  const kinds = statements.map(commandKind)
  if (kinds.includes('unsupported')) throw commandError('UNSUPPORTED_COMMAND', '仅支持单条 InfluxQL 查询')
  const hasQuery = kinds.includes('query')
  const hasWrite = kinds.some(kind => kind === 'insert' || kind === 'write')
  if (hasQuery && hasWrite) throw commandError('MIXED_COMMAND_BATCH', '查询脚本不能包含写命令')
  if (hasWrite) throw commandError('WRITE_REQUIRES_COMMANDS_ENDPOINT', '写命令必须通过 commands 接口执行')
  if (statements.length !== 1) throw commandError('MULTI_STATEMENT_QUERY_UNSUPPORTED', 'query 接口只支持单条查询')
  return statements[0]
}

export async function executeSingleQuery({ script, executeQuery }) {
  const statement = validatedSingleQuery(script)
  const result = await executeQuery(statement)
  return { rows:result.rows, rowCount:result.rows.length, durationMs:result.durationMs, hasMore:false }
}

function validatedWriteBatch({ script, session }) {
  assertEnvironmentWritable(session)
  try {
    return validateWriteBatch(script)
  } catch (error) {
    error.status ??= 400
    throw error
  }
}

export function validateWriteBatchForSession({ script, session }) {
  const { statements, kind } = validatedWriteBatch({ script, session })
  return { statementCount:statements.length, kind }
}

export async function executeWriteBatch({ script, session, database, executeInsert, executeWrite }) {
  const { statements } = validatedWriteBatch({ script, session })
  let succeeded = 0

  for (const [index, statement] of statements.entries()) {
    try {
      if (commandKind(statement) === 'insert') {
        await executeInsert(statement, database)
      } else {
        await executeWrite(statement.replace(/^write\s+/i, ''), database)
      }
      succeeded++
    } catch (error) {
      return {
        summary:{ total:statements.length, succeeded, failed:1, skipped:statements.length - succeeded - 1 },
        failedIndex:index,
        error:error instanceof Error ? error.message : String(error),
      }
    }
  }

  return { summary:{ total:statements.length, succeeded, failed:0, skipped:0 } }
}
