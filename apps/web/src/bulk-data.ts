import { load, save } from './storage.ts'
import type { BulkDraft, BulkHistoryItem, BulkWizardStep, Connection } from './types.ts'

export type { BulkDraft, BulkHistoryItem, BulkIssue, BulkJobStatus, BulkPlanRequest, BulkPreview, BulkWizardStep, FieldGenerator, TagGenerator } from './types.ts'

export const BULK_DRAFT_KEY = 'gdb.bulkData.draft.v1'
export const BULK_HISTORY_KEY = 'gdb.bulkData.history.v1'
export const BULK_ACTIVE_KEY = 'gdb.bulkData.active.v1'
const HISTORY_LIMIT = 20

type StoredBulkDraft = { version:1; savedAt:number; draft:BulkDraft }
type StoredBulkHistory = { version:1; items:BulkHistoryItem[] }
type StoredActiveBulkRun = { version:1; jobId:string; draft:BulkDraft }
type BulkEntryContext = { connection?:Pick<Connection, 'environment'|'readOnly'> | null; connected:boolean; database?:string | null }

function withoutSensitive<T extends Record<string, unknown>>(value: T) {
  const { seed: _seed, preview: _preview, previewId: _previewId, ...safe } = value
  return safe
}

function safelyStoredDraft(value: unknown): BulkDraft | null {
  if (!value || typeof value !== 'object') return null
  const stored = value as Partial<StoredBulkDraft>
  return stored.version === 1 && stored.draft && typeof stored.draft === 'object' ? withoutSensitive(stored.draft as BulkDraft) : null
}

function safelyStoredHistory(value: unknown): BulkHistoryItem[] {
  if (!value || typeof value !== 'object') return []
  const stored = value as Partial<StoredBulkHistory>
  return stored.version === 1 && Array.isArray(stored.items) ? stored.items.map(item => withoutSensitive(item)).filter(item => typeof item.jobId === 'string') as BulkHistoryItem[] : []
}

export function bulkEntryState(context: BulkEntryContext) {
  if (context.connection?.environment !== 'test') return { enabled:false, reason:'仅测试环境连接可批量造数' }
  if (context.connection.readOnly !== false) return { enabled:false, reason:'只读连接不可批量造数' }
  if (!context.connected) return { enabled:false, reason:'请先连接到 GeminiDB' }
  if (!context.database?.trim()) return { enabled:false, reason:'请先选择数据库' }
  return { enabled:true, reason:'' }
}

export function estimateBulkDraft(draft: BulkDraft) {
  if (draft.dates.length === 0) throw new Error('至少选择一个日期')
  if (draft.dates.length > 30) throw new Error('最多选择 30 个日期')
  if (!Number.isInteger(draft.intervalSeconds) || draft.intervalSeconds < 1) throw new Error('采样间隔无效')
  const timeToSeconds = (value:string) => {
    const parts = value.split(':').map(Number)
    if (parts.length !== 3 || parts.some(part => !Number.isInteger(part))) throw new Error('时间格式无效')
    return parts[0] * 3600 + parts[1] * 60 + parts[2]
  }
  const start = timeToSeconds(draft.startTime), end = timeToSeconds(draft.endTime)
  if (start > end) throw new Error('结束时间不能早于开始时间')
  const slots = Math.floor((end - start) / draft.intervalSeconds) + 1
  const combinations = draft.tags.reduce((total, tag) => {
    const generator = tag.generator
    const count = generator.kind === 'sequence' ? generator.count : generator.values.length
    return total * count
  }, 1)
  const pointCount = draft.dates.length * slots * combinations
  return { pointCount, maxNewSeries:draft.dates.length * combinations, tagCombinationCount:combinations }
}

export function loadBulkDraft() { return safelyStoredDraft(load<unknown>(BULK_DRAFT_KEY, null)) }
export function saveBulkDraft(draft: BulkDraft) { save<StoredBulkDraft>(BULK_DRAFT_KEY, { version:1, savedAt:Date.now(), draft:withoutSensitive(draft) }) }
export function clearBulkDraft() { localStorage.removeItem(BULK_DRAFT_KEY) }
export function loadBulkHistory() { return safelyStoredHistory(load<unknown>(BULK_HISTORY_KEY, null)) }
export function appendBulkHistory(item: BulkHistoryItem) {
  const newest = withoutSensitive(item) as BulkHistoryItem
  save<StoredBulkHistory>(BULK_HISTORY_KEY, { version:1, items:[newest, ...loadBulkHistory().filter(current => current.jobId !== newest.jobId)].slice(0, HISTORY_LIMIT) })
}
export function saveActiveBulkRun(jobId:string, draft:BulkDraft) { save<StoredActiveBulkRun>(BULK_ACTIVE_KEY, { version:1, jobId, draft:withoutSensitive(draft) }) }
export function loadActiveBulkRun() {
  const stored = load<Partial<StoredActiveBulkRun> | null>(BULK_ACTIVE_KEY, null)
  return stored?.version === 1 && typeof stored.jobId === 'string' && stored.draft && typeof stored.draft === 'object'
    ? { jobId:stored.jobId, draft:withoutSensitive(stored.draft as BulkDraft) }
    : null
}
export function clearActiveBulkRun(jobId?:string) {
  const active = loadActiveBulkRun()
  if (!jobId || active?.jobId === jobId) localStorage.removeItem(BULK_ACTIVE_KEY)
}
export function copyHistoryToDraft(item: BulkHistoryItem): BulkDraft {
  const { jobId:_jobId, status:_status, seed:_seed, progress:_progress, preview:_preview, previewId:_previewId, completedAt:_completedAt, ...draft } = item
  return draft
}
export function stepForBulkError(code?:string): BulkWizardStep {
  if (/^(BULK_TEST_CONNECTION_REQUIRED|BULK_WRITE_CONNECTION_REQUIRED|BULK_SESSION_REQUIRED|RP_|SCHEMA_|PREFIX_)/.test(code ?? '')) return 1
  if (/^(POINT_|SERIES_|DATE_|TIME_|INTERVAL_)/.test(code ?? '')) return 2
  if (/^(CONSTRAINT_|GENERATOR_)/.test(code ?? '')) return 3
  return 4
}
