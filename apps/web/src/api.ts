import type { ClaudeDiagnosis, ClaudeSettings, MeasurementSchema, QueryResponse } from './types'
import { isTauri } from '@tauri-apps/api/core'

let sessionId = ''
const apiBase = isTauri() && import.meta.env?.PROD ? 'http://127.0.0.1:8790' : '/api'

export class BridgeError extends Error { code:string;status:number;constructor(message:string,code:string,status:number){super(message);this.code=code;this.status=status} }

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${apiBase}${path}`, { ...init, headers: { 'Content-Type': 'application/json', ...(sessionId ? { Authorization: `Bearer ${sessionId}` } : {}), ...init?.headers } })
  if (!response.ok) {
    const body = await response.json().catch(() => ({ message: response.statusText }))
    throw new BridgeError(body.message || `HTTP ${response.status}`,body.code || 'HTTP_ERROR',response.status)
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
  ask: (context: { database:string; measurement:string; sql:string; error:string; schema:MeasurementSchema; localIssues:{level:string;message:string}[] }, settings: ClaudeSettings, apiKey: string, signal?:AbortSignal) => request<ClaudeDiagnosis>('/ask', { method: 'POST', body: JSON.stringify({ context, settings, apiKey }),signal }),
  probeClaude: (settings: ClaudeSettings) => request<{ready:boolean;version?:string;message:string}>('/claude/probe',{method:'POST',body:JSON.stringify({settings})})
}
