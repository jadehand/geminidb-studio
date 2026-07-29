import { commandKind, validateWriteBatch } from './command-batch.mjs'
import { assertEnvironmentWritable } from './write-policy.mjs'

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
