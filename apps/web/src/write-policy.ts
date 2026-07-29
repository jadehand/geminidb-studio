import type { Connection } from './types'

export function effectiveReadOnly(environment: Connection['environment']): boolean {
  return (environment ?? 'dev') === 'prod'
}

export function normalizeConnectionWritePolicy(connection: Connection): Connection {
  const environment = connection.environment ?? 'dev'
  return { ...connection, environment, readOnly:effectiveReadOnly(environment) }
}
