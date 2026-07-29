import type { Connection } from './types'
import { effectiveReadOnly } from './write-policy.ts'

export type WriteConfirmation = {
  command: string
  statementCount: number
  connectionId: string
  database: string
  environment: Connection['environment']
  sessionGeneration: number
}

export function isWriteConfirmationCurrent(confirmation: WriteConfirmation, current: { connection: Pick<Connection, 'id'|'environment'> | undefined; database: string; sessionGeneration: number }): boolean {
  return confirmation.connectionId === current.connection?.id
    && confirmation.database === current.database
    && confirmation.environment === current.connection.environment
    && confirmation.sessionGeneration === current.sessionGeneration
    && !effectiveReadOnly(current.connection.environment)
}

export function createWriteExecutionLock() {
  let locked = false
  return {
    tryAcquire: () => {
      if (locked) return false
      locked = true
      return true
    },
    release: () => { locked = false },
  }
}
