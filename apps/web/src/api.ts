import type { ClaudeDiagnosis, ClaudeSettings, CommandBatchResponse, CommandBatchValidation, MeasurementSchema, MeasurementUpdateResult, QueryResponse } from './types'
import type { BulkJobStatus, BulkPlanRequest, BulkPreview } from './bulk-data.ts'
import type { MeasurementDataOptions, MeasurementDataPage } from './measurement-data.ts'
import type { MeasurementPointUpdate } from './measurement-editing.ts'
import { isTauri } from '@tauri-apps/api/core'

let sessionId = ''
let loginRequest = 0
const apiBase = isTauri() && import.meta.env?.PROD ? 'http://127.0.0.1:8790' : '/api'

export class BridgeError extends Error { code:string;status:number;details:unknown;constructor(message:string,code:string,status:number,details?:unknown){super(message);this.code=code;this.status=status;this.details=details} }

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${apiBase}${path}`, { ...init, headers: { 'Content-Type': 'application/json', ...(sessionId ? { Authorization: `Bearer ${sessionId}` } : {}), ...init?.headers } })
  if (!response.ok) {
    const body = await response.json().catch(() => ({ message: response.statusText }))
    throw new BridgeError(body.message || `HTTP ${response.status}`,body.code || 'HTTP_ERROR',response.status,body.details)
  }
  return response.json()
}

export const bridge = {
  login: async (connection: { mode: 'mock' | 'influx'; endpoint: string; username: string; password: string; insecureSkipVerify: boolean; readOnly: boolean; environment?: 'prod'|'test'|'dev' }) => {
    const requestId = ++loginRequest
    const result = await request<{ sessionId: string }>('/login', { method: 'POST', body: JSON.stringify({ ...connection, environment: connection.environment ?? 'dev' }) })
    if (requestId !== loginRequest) throw new BridgeError('连接已被新的连接请求替代','LOGIN_SUPERSEDED',409)
    sessionId = result.sessionId
    return result
  },
  databases: () => request<string[]>('/databases'),
  tables: (database: string) => request<string[]>(`/tables?database=${encodeURIComponent(database)}`),
  schema: (database: string, measurement: string) => request<MeasurementSchema>(`/schema?database=${encodeURIComponent(database)}&measurement=${encodeURIComponent(measurement)}`),
  measurementData: (database: string, measurement: string, options: MeasurementDataOptions, signal?: AbortSignal) => {
    const bounds = options.startNs === null ? '' : `&startNs=${encodeURIComponent(options.startNs)}&endNs=${encodeURIComponent(options.endNs!)}`
    return request<MeasurementDataPage>(`/measurement-data?database=${encodeURIComponent(database)}&measurement=${encodeURIComponent(measurement)}&limit=${encodeURIComponent(String(options.limit))}&offset=${encodeURIComponent(String(options.offset))}${bounds}`, { signal })
  },
  updateMeasurementData: (payload: { database: string; measurement: string; updates: MeasurementPointUpdate[] }, signal?: AbortSignal) => request<MeasurementUpdateResult>('/measurement-data/updates', { method: 'POST', body: JSON.stringify(payload), signal }),
  retentionPolicies: (database: string) => request<{ name:string; durationMs:number; isDefault:boolean }[]>(`/retention-policies?database=${encodeURIComponent(database)}`),
  tagValues: (database: string, measurement: string, tag: string) => request<{ values:string[]; truncated:boolean }>(`/tag-values?database=${encodeURIComponent(database)}&measurement=${encodeURIComponent(measurement)}&tag=${encodeURIComponent(tag)}`),
  previewBulkJob: (plan: BulkPlanRequest, signal?: AbortSignal) => request<BulkPreview>('/bulk-jobs/preview', { method:'POST', body:JSON.stringify(plan), signal }),
  createBulkJob: (input: { previewId:string; database?:string; acknowledgeCreate?:boolean; acknowledgeOverwrite?:boolean }, signal?: AbortSignal) => request<BulkJobStatus>('/bulk-jobs', { method:'POST', body:JSON.stringify(input), signal }),
  activeBulkJob: () => request<BulkJobStatus | null>('/bulk-jobs/active'),
  bulkJob: (id: string, signal?:AbortSignal) => request<BulkJobStatus>(`/bulk-jobs/${encodeURIComponent(id)}`, { signal }),
  resumeBulkJob: (id: string) => request<BulkJobStatus>(`/bulk-jobs/${encodeURIComponent(id)}/resume`, { method:'POST' }),
  cancelBulkJob: (id: string, signal?:AbortSignal) => request<BulkJobStatus>(`/bulk-jobs/${encodeURIComponent(id)}/cancel`, { method:'POST', signal }),
  validateCommands: (script: string, signal?: AbortSignal) => request<CommandBatchValidation>('/commands/validate', { method:'POST', body:JSON.stringify({ script }), signal }),
  executeCommands: (database: string, script: string, signal?: AbortSignal) => request<CommandBatchResponse>('/commands', { method:'POST', body:JSON.stringify({ database, script }), signal }),
  query: (database: string, sql: string, signal?: AbortSignal) => request<QueryResponse>('/query', { method: 'POST', body: JSON.stringify({ database, sql, maxRows: 1000, timeoutMs: 30000 }), signal }),
  ask: (context: { database:string; measurement:string; sql:string; error:string; schema:MeasurementSchema; localIssues:{level:string;message:string}[] }, settings: ClaudeSettings, apiKey: string, signal?:AbortSignal) => request<ClaudeDiagnosis>('/ask', { method: 'POST', body: JSON.stringify({ context, settings, apiKey }),signal }),
  probeClaude: (settings: ClaudeSettings) => request<{ready:boolean;version?:string;message:string}>('/claude/probe',{method:'POST',body:JSON.stringify({settings})})
}
