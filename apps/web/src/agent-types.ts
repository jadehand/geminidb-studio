export type AgentRunStatus =
  | 'planning' | 'running' | 'completed' | 'stopped'
  | 'budget_exceeded' | 'blocked' | 'failed' | 'interrupted'

export interface AgentBudget {
  toolCalls: number
  maxToolCalls: number
  startedAt: number
  deadlineAt: number
}

export interface AgentRun {
  id: string
  sessionId: string
  status: AgentRunStatus
  provider?: string
  stopReason?: string
  budget: AgentBudget
  createdAt: string | number
  updatedAt: string | number
}

export interface AgentMessage {
  id: string
  sessionId: string
  runId?: string
  role: 'user' | 'assistant' | 'tool'
  content: string
  toolCallId?: string
  toolName?: string
  createdAt: string | number
}

export interface AgentEvent {
  id?: string
  sequence: number
  sessionId?: string
  runId?: string
  type: string
  payload: Record<string, unknown>
  createdAt?: string | number
}

export interface AgentSessionSummary {
  id: string
  title: string
  connectionId: string
  environment: 'dev' | 'test'
  database: string
  retentionPolicy: string
  status: AgentRunStatus
  createdAt: string | number
  updatedAt: string | number
}

export interface AgentSessionDetail extends AgentSessionSummary {
  readOnly?: boolean
  messages: AgentMessage[]
  runs: AgentRun[]
  events: AgentEvent[]
}

export interface AgentProviderSettings {
  provider: 'cli' | 'api'
  model?: string
  endpoint?: string
  cliPath?: string
  fallbackToApi?: boolean
}

export interface AgentProviderProbe {
  ready: boolean
  provider?: string
  version?: string
  message?: string
}
