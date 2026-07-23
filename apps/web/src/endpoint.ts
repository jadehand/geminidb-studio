import type { Connection } from './types'

export type EndpointProtocol = 'http' | 'https'

export function endpointProtocol(endpoint: string): EndpointProtocol {
  return endpoint.trim().toLowerCase().startsWith('https://') ? 'https' : 'http'
}

export function withEndpointProtocol(endpoint: string, protocol: EndpointProtocol) {
  const rest = endpoint.trim().replace(/^https?:\/\//i, '')
  return `${protocol}://${rest}`
}

export function connectionForTransport(connection: Connection): Connection {
  return {
    ...connection,
    insecureSkipVerify: endpointProtocol(connection.endpoint) === 'https' && connection.insecureSkipVerify,
  }
}
