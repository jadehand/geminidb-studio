import { commandKind, validateWriteBatch } from './command-batch.mjs'
import { assertEnvironmentWritable } from './write-policy.mjs'

export async function executeWriteBatch({ script, session, database, executeInsert, executeWrite }) {
  assertEnvironmentWritable(session)
  let statements
  try {
    ({ statements } = validateWriteBatch(script))
  } catch (error) {
    error.status ??= 400
    throw error
  }
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
