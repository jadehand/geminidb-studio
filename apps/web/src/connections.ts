import type { Connection } from './types'
import { normalizeConnectionWritePolicy } from './write-policy.ts'

export const NEW_INFLUX_CONNECTION: Connection = {
  id: '',
  name: '',
  mode: 'influx',
  environment: 'dev',
  endpoint: '',
  username: '',
  password: '',
  autoLogin: false,
  readOnly: false,
  insecureSkipVerify: false,
}

export function removeMockConnections(connections: Connection[]) {
  return connections.filter(connection => connection.mode === 'influx')
}

export function migrateConnections(connections: Connection[]) {
  return removeMockConnections(connections).map(normalizeConnectionWritePolicy)
}
