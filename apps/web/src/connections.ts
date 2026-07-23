import type { Connection } from './types'

export const NEW_INFLUX_CONNECTION: Connection = {
  id: '',
  name: '',
  mode: 'influx',
  environment: 'dev',
  endpoint: 'http://',
  username: '',
  password: '',
  autoLogin: false,
  readOnly: false,
  insecureSkipVerify: false,
}

export function removeMockConnections(connections: Connection[]) {
  return connections.filter(connection => connection.mode === 'influx')
}
