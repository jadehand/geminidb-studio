import { useEffect, useRef, useState } from 'react'
import { agentBridge } from './agent-api'
import type { AgentEvent, AgentProviderSettings, AgentSessionDetail, AgentSessionSummary } from './agent-types'
import type { Connection } from './types'
import AgentSessionList from './AgentSessionList'
import AgentConversation from './AgentConversation'
import AgentExecutionPanel from './AgentExecutionPanel'

export type AgentWorkbenchContext = {
  connection?: Connection
  connected: boolean
  connections: Connection[]
  database: string
  databases: string[]
  retentionPolicy?: string
  retentionPolicies?: string[]
  onConnectionChange?: (connection: Connection) => void
  onDatabaseChange?: (database: string) => void
}

export type AgentLaunchContext = {
  sql: string
  error: string
  database: string
  measurement: string
  schema: { fields:{ name:string; type:string }[]; tags:string[] }
}

type Props = {
  context: AgentWorkbenchContext
  launchContext?: AgentLaunchContext
  onLaunchConsumed?: () => void
  onOpenSql: (sql: string) => void
  onNotify: (message: string) => void
}

const activeStatuses = new Set(['planning','running'])
const defaultSettings: AgentProviderSettings = {
  provider:'cli',
  cliPath:'claude',
  endpoint:'https://api.anthropic.com',
  model:'claude-sonnet-4-5',
  fallbackToApi:true,
}

export default function AgentWorkbench({ context, launchContext, onLaunchConsumed, onOpenSql, onNotify }: Props) {
  const [sessions, setSessions] = useState<AgentSessionSummary[]>([])
  const [activeId, setActiveId] = useState<string>()
  const [detail, setDetail] = useState<AgentSessionDetail>()
  const [events, setEvents] = useState<AgentEvent[]>([])
  const [settings, setSettings] = useState<AgentProviderSettings>(defaultSettings)
  const [providerReady, setProviderReady] = useState<boolean>()
  const [busy, setBusy] = useState(false)
  const [sessionsOpen,setSessionsOpen] = useState(false)
  const [executionOpen,setExecutionOpen] = useState(false)
  const [retentionPolicy,setRetentionPolicy] = useState(context.retentionPolicy || '')
  const seen = useRef(new Set<number>())
  const detailRequest = useRef(0)

  const loadSessions = async () => {
    const next = await agentBridge.listSessions()
    setSessions(next)
    setActiveId(current => current && next.some(item => item.id === current) ? current : next[0]?.id)
  }
  const loadDetail = async (id: string) => {
    const request = ++detailRequest.current
    const next = await agentBridge.getSession(id)
    if (request !== detailRequest.current) return
    setDetail(next)
    setEvents(next.events || [])
    seen.current = new Set((next.events || []).map(event => event.sequence))
  }

  useEffect(() => {
    if (!context.connection || !context.connected) {
      setSessions([])
      setActiveId(undefined)
      setDetail(undefined)
      setEvents([])
      setProviderReady(undefined)
      return
    }
    let cancelled = false
    void Promise.all([agentBridge.listSessions(), agentBridge.probeProvider(settings)]).then(([next, probe]) => {
      if (cancelled) return
      setSessions(next)
      setActiveId(next[0]?.id)
      setProviderReady(probe.ready)
    }).catch(error => !cancelled && onNotify(error instanceof Error ? error.message : 'Agent 工作台加载失败'))
    return () => { cancelled = true }
  }, [context.connection?.id, context.connected])

  useEffect(() => {
    if (!activeId) { detailRequest.current += 1; setDetail(undefined); setEvents([]); return }
    let cancelled = false
    let unsubscribe = () => {}
    void loadDetail(activeId).then(() => {
      if (cancelled) return
      let after = 0
      for (const sequence of seen.current) after = Math.max(after, sequence)
      unsubscribe = agentBridge.subscribe(activeId, after, {
        event:event => {
          if (cancelled) return
          if (seen.current.has(event.sequence)) return
          seen.current.add(event.sequence)
          setEvents(current => [...current, event])
          void loadDetail(activeId).catch(() => {})
        },
        error:error => onNotify(error instanceof Error ? error.message : 'Agent 事件流已断开'),
      })
    }).catch(error => !cancelled && onNotify(error instanceof Error ? error.message : '无法读取 Agent 会话'))
    return () => { cancelled = true; unsubscribe() }
  }, [activeId])

  const latestRun = detail?.runs?.at(-1)
  const active = Boolean(latestRun && activeStatuses.has(latestRun.status))
  const perform = async (action: () => Promise<void>) => {
    setBusy(true)
    try { await action() } catch (error) { onNotify(error instanceof Error ? error.message : '操作失败') } finally { setBusy(false) }
  }
  const create = () => perform(async () => {
    if (!context.connection || !context.connected || !context.database) throw new Error('请先连接并选择 Database')
    const created = await agentBridge.createSession({ title:'新会话', database:context.database, retentionPolicy })
    await loadSessions()
    setActiveId(created.id)
  })
  const send = async (message: string) => perform(async () => {
    if (!activeId || active) return
    await agentBridge.sendMessage(activeId, message, settings)
    await loadDetail(activeId)
  })
  const launchDraft = launchContext
    ? `请分析当前查询并给出可执行建议。\n\nDatabase: ${launchContext.database || '未选择'}\nMeasurement: ${launchContext.measurement || '未选择'}\n错误: ${launchContext.error || '无'}\nSchema: ${JSON.stringify(launchContext.schema)}\n\n\`\`\`influxql\n${launchContext.sql}\n\`\`\``
    : undefined

  return <section className="agent-workbench">
    <div className="agent-context-bar">
      <div><strong>Agent 工作台</strong><span>受控查询与自动化</span></div>
      <button className="agent-mobile-toggle sessions-toggle" aria-expanded={sessionsOpen} onClick={()=>setSessionsOpen(value=>!value)}>会话</button>
      <label>连接<select value={context.connection?.id || ''} onChange={event => { const next = context.connections.find(item => item.id === event.target.value); if (next) context.onConnectionChange?.(next) }}>{context.connections.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
      <label>Database<select value={context.database} onChange={event => context.onDatabaseChange?.(event.target.value)}>{context.databases.map(item => <option key={item}>{item}</option>)}</select></label>
      <label>RP<select value={retentionPolicy} onChange={event => setRetentionPolicy(event.target.value)}><option value="">默认</option>{context.retentionPolicies?.map(item => <option key={item}>{item}</option>)}</select></label>
      <button className="agent-mobile-toggle execution-toggle" aria-expanded={executionOpen} onClick={()=>setExecutionOpen(value=>!value)}>执行</button>
    </div>
    <div className="agent-workbench-grid">
      <AgentSessionList sessions={sessions} activeId={activeId} busy={busy} open={sessionsOpen} onCreate={() => void create()} onSelect={id=>{setActiveId(id);setSessionsOpen(false)}} onRename={session => { const title = window.prompt('会话名称',session.title)?.trim(); if (title) void perform(async () => { await agentBridge.updateSession(session.id,{title}); await loadSessions(); if (session.id === activeId) await loadDetail(session.id) }) }} onDelete={session => { if (window.confirm(`删除“${session.title || '未命名会话'}”？`)) void perform(async () => { await agentBridge.deleteSession(session.id); await loadSessions() }) }}/>
      <AgentConversation messages={detail?.messages || []} run={latestRun} disabled={!activeId || active || busy} initialDraft={launchDraft} onInitialDraftConsumed={onLaunchConsumed} onSend={send} onOpenSql={onOpenSql}/>
      <AgentExecutionPanel run={latestRun} events={events} settings={settings} providerReady={providerReady} open={executionOpen} onSettings={setSettings} onStop={() => { if (activeId) void perform(async () => { await agentBridge.stop(activeId); await loadDetail(activeId) }) }}/>
    </div>
  </section>
}
