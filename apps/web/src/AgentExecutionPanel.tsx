import type { AgentEvent, AgentProviderSettings, AgentRun } from './agent-types'

type Props = {
  run?: AgentRun
  events: AgentEvent[]
  settings: AgentProviderSettings
  providerReady?: boolean
  open?: boolean
  onSettings: (settings: AgentProviderSettings) => void
  onStop: () => void
}

export default function AgentExecutionPanel({ run, events, settings, providerReady, open, onSettings, onStop }: Props) {
  const active = run?.status === 'planning' || run?.status === 'running'
  const toolCalls = run?.budget?.toolCalls ?? 0
  return <aside className={`agent-execution ${open ? 'open' : ''}`}>
    <header><div><b>执行与安全</b><span className={providerReady ? 'ready' : ''}>{run?.provider === 'api' ? 'Anthropic API' : run?.provider === 'cli' ? 'Claude CLI' : providerReady ? 'Provider 可用' : 'Provider 待检查'}</span></div><button className="danger" disabled={!active} onClick={onStop}>停止任务</button></header>
    <section className="agent-budget">
      <div><span>工具调用</span><b>{toolCalls} / 12</b></div>
      <div><span>运行时间</span><b>{elapsed(run)} / 05:00</b></div>
    </section>
    <section className="agent-provider">
      <label>Provider<select value={settings.provider} onChange={event => onSettings({ ...settings, provider:event.target.value as 'cli'|'api' })}><option value="cli">Claude CLI</option><option value="api">Anthropic API</option></select></label>
      <label>模型<input value={settings.model || ''} onChange={event => onSettings({ ...settings, model:event.target.value })} placeholder="claude-sonnet"/></label>
    </section>
    <section className="agent-trace" aria-live="polite">
      <h3>执行轨迹</h3>
      {!events.length && <p>工具调用会显示在这里。</p>}
      {events.toSorted((a,b) => b.sequence-a.sequence).map(event => <article key={event.id || event.sequence}>
        <i className={event.type.includes('failed') ? 'failed' : event.type.includes('completed') ? 'done' : ''}/>
        <div><b>{eventLabel(event.type)}</b><small>#{event.sequence}{event.runId ? ` · ${event.runId.slice(0,8)}` : ''}</small></div>
      </article>)}
    </section>
    <footer><b>本地历史</b><span>查询结果最多 1000 行，可能包含业务数据。API 模式会把结果发送到配置的 Anthropic Endpoint。密码、API Key 和连接凭据不会发送。</span></footer>
  </aside>
}

function elapsed(run?: AgentRun) {
  if (!run?.budget?.startedAt) return '00:00'
  const end = ['completed','stopped','budget_exceeded','blocked','failed','interrupted'].includes(run.status) ? Number(run.updatedAt) : Date.now()
  const seconds = Math.max(0, Math.min(300, Math.floor((end - run.budget.startedAt) / 1000)))
  return `${String(Math.floor(seconds / 60)).padStart(2,'0')}:${String(seconds % 60).padStart(2,'0')}`
}

function eventLabel(type: string) {
  if (type === 'tool.requested') return '请求工具'
  if (type === 'tool.completed') return '工具完成'
  if (type === 'tool.failed') return '工具失败'
  if (type === 'assistant.message') return 'Agent 回复'
  if (type === 'run.status') return '任务状态'
  return type
}
