import type { MeasurementSchema, QueryResponse } from './types'
import { isTauri } from '@tauri-apps/api/core'

let sessionId = ''
const apiBase = isTauri() && import.meta.env.PROD ? 'http://127.0.0.1:8790' : '/api'

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${apiBase}${path}`, { ...init, headers: { 'Content-Type': 'application/json', ...(sessionId ? { Authorization: `Bearer ${sessionId}` } : {}), ...init?.headers } })
  if (!response.ok) {
    const body = await response.json().catch(() => ({ message: response.statusText }))
    throw new Error(body.message || `HTTP ${response.status}`)
  }
  return response.json()
}

export const bridge = {
  login: async (connection: { mode: 'mock' | 'influx'; endpoint: string; username: string; password: string; insecureSkipVerify: boolean; readOnly: boolean }) => {
    const result = await request<{ sessionId: string }>('/login', { method: 'POST', body: JSON.stringify(connection) })
    sessionId = result.sessionId
    return result
  },
  databases: () => request<string[]>('/databases'),
  tables: (database: string) => request<string[]>(`/tables?database=${encodeURIComponent(database)}`),
  schema: (database: string, measurement: string) => request<MeasurementSchema>(`/schema?database=${encodeURIComponent(database)}&measurement=${encodeURIComponent(measurement)}`),
  query: (database: string, sql: string, signal?: AbortSignal) => request<QueryResponse>('/query', { method: 'POST', body: JSON.stringify({ database, sql, maxRows: 1000, timeoutMs: 30000 }), signal }),
  ask: (database: string, sql: string, error = '') => request<{ answer: string; suggestedSql: string }>('/ask', { method: 'POST', body: JSON.stringify({ database, sql, error }) })
}
