export type Connection = { id: string; name: string; mode: 'mock' | 'influx'; environment?: 'prod' | 'test' | 'dev'; endpoint: string; username: string; password?: string; autoLogin: boolean; readOnly: boolean; insecureSkipVerify: boolean }
export type QueryRow = Record<string, string | number | boolean | null>
export type Execution = { id: string; executedAt: number; sql: string; durationMs: number; status: 'success' | 'error' | 'cancelled'; result: string; database: string }
export type Favorite = { id: string; name: string; sql: string; database: string }
export type QueryResponse = { rows?: QueryRow[]; rowCount?: number; affectedRows?: number; durationMs: number; message?: string }
export type MeasurementSchema = { fields: { name: string; type: string }[]; tags: string[] }
export type ClaudeSettings = { provider: 'cli'|'api'; cliPath: string; endpoint: string; model: string; maxTokens: number }
export type ClaudeDiagnosis = { summary: string; problems: { level: 'error'|'warning'|'info'; message: string }[]; fixedSql: string; performanceAdvice: string[]; risk: 'read'|'write'|'danger'; usage?: { inputTokens?: number; outputTokens?: number } }

export type TagGenerator =
  | { kind:'list'; values:string[] }
  | { kind:'sequence'; prefix:string; start:number; count:number; padding:number }
  | { kind:'existing'; values:string[]; truncated:boolean }

export type FieldGenerator =
  | { kind:'fixed'; value:string|number|boolean }
  | { kind:'random-number'; min:number; max:number }
  | { kind:'increment'; start:number; step:number }
  | { kind:'string-list'; values:string[] }
  | { kind:'random-boolean'; truePercent:number }

export type BulkConstraint = { left:string; operator:'>'|'>='|'<'|'<='|'='|'!='; right:{ kind:'field'; field:string }|{ kind:'fixed'; value:string|number|boolean } }
export type BulkTagDraft = { name:string; generator:TagGenerator }
export type BulkFieldDraft = { name:string; type:string; generator:FieldGenerator }
export type BulkDraft = { prefix:string; database:string; sourceMeasurement:string; retentionPolicy:string; dates:string[]; startTime:string; endTime:string; intervalSeconds:number; tags:BulkTagDraft[]; fields:BulkFieldDraft[]; constraints:BulkConstraint[]; previewId?:string }
export type BulkPlanRequest = Omit<BulkDraft, 'previewId'|'tags'|'fields'> & { schema?:MeasurementSchema; tags:{ name:string; values:string[] }[]; fields:{ name:string; type:string; generator:FieldGenerator }[] }
export type BulkIssue = { code:string; message:string; [key:string]: unknown }
export type BulkPreview = { previewId:string; expiresAt:number; pointCount:number; maxNewSeries:number; warnings:BulkIssue[]; samples:{ index:number; lineProtocol:string }[] }
export type BulkJobStatus = { id:string; status:'running'|'paused'|'cancelling'|'cancelled'|'succeeded'|'failed'; currentMeasurement:string|null; completedPoints:number; totalPoints:number; completedBatches:number; totalBatches:number; retryCount:number; lastError:BulkIssue|null; startedAt:number; updatedAt:number }
export type BulkHistoryItem = BulkDraft & { jobId:string; status:BulkJobStatus['status']; completedAt:number; progress?:Pick<BulkJobStatus, 'completedPoints'|'totalPoints'|'completedBatches'|'totalBatches'>; seed?:string; preview?:BulkPreview }
export type BulkWizardStep = 1|2|3|4
