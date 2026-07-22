export type Connection = { id: string; name: string; mode: 'mock' | 'influx'; environment?: 'prod' | 'test' | 'dev'; endpoint: string; username: string; password?: string; autoLogin: boolean; readOnly: boolean; insecureSkipVerify: boolean }
export type QueryRow = Record<string, string | number | boolean | null>
export type Execution = { id: string; executedAt: number; sql: string; durationMs: number; status: 'success' | 'error' | 'cancelled'; result: string; database: string }
export type Favorite = { id: string; name: string; sql: string; database: string }
export type QueryResponse = { rows?: QueryRow[]; rowCount?: number; affectedRows?: number; durationMs: number; message?: string }
export type MeasurementSchema = { fields: { name: string; type: string }[]; tags: string[] }
