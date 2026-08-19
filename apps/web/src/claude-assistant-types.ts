import type { MeasurementSchema } from './types'

export type ClaudeAssistantAttachments = {
  sql?: string
  error?: string
  schema?: MeasurementSchema
}

export type ClaudeAssistantMessage = {
  id: string
  role: 'user'|'assistant'
  content: string
  createdAt: number
  attachments?: ClaudeAssistantAttachments
}

export type ClaudeAssistantSessionSummary = {
  id: string
  title: string
  createdAt: number
  updatedAt: number
  messageCount: number
}

export type ClaudeAssistantSession = Omit<ClaudeAssistantSessionSummary,'messageCount'> & {
  messages: ClaudeAssistantMessage[]
}

export type ClaudeProbe = {
  ready: boolean
  kind: 'ready'|'not_installed'|'not_authenticated'|'authentication_unknown'
  message: string
  version?: string
}
