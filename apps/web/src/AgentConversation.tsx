import { useEffect, useState } from 'react'
import type { AgentMessage, AgentRun } from './agent-types'

type Props = {
  messages: AgentMessage[]
  run?: AgentRun
  disabled?: boolean
  onSend: (message: string) => Promise<void>
  onOpenSql: (sql: string) => void
  initialDraft?: string
  onInitialDraftConsumed?: () => void
}

const sqlBlock = /```(?:sql|influxql)?\s*([\s\S]*?)```/i

export default function AgentConversation({ messages, run, disabled, onSend, onOpenSql, initialDraft, onInitialDraftConsumed }: Props) {
  const [draft, setDraft] = useState('')
  useEffect(() => {
    if (!initialDraft) return
    setDraft(initialDraft)
    onInitialDraftConsumed?.()
  }, [initialDraft])
  const submit = async () => {
    const message = draft.trim()
    if (!message || disabled) return
    setDraft('')
    await onSend(message)
  }
  return <section className="agent-conversation">
    <div className="agent-conversation-head">
      <div><b>对话</b><span>{run ? runLabel(run.status) : '等待任务'}</span></div>
      <small>Claude 只通过 Studio 的受控工具访问 GeminiDB</small>
    </div>
    <div className="agent-messages" aria-live="polite">
      {!messages.length && <div className="agent-empty agent-conversation-empty"><b>描述你要完成的事情</b><span>例如：检查 cpu 表结构，生成查询并验证最近一小时数据。</span></div>}
      {messages.map(message => {
        const sql = message.content.match(sqlBlock)?.[1]?.trim()
        return <article key={message.id} className={`agent-message ${message.role}`}>
          <small>{message.role === 'user' ? '你' : message.role === 'tool' ? '工具结果' : 'Agent'}</small>
          <div>{message.content}</div>
          {sql && <button onClick={() => onOpenSql(sql)}>在查询窗口打开</button>}
        </article>
      })}
    </div>
    <footer className="agent-composer">
      <textarea value={draft} onChange={event => setDraft(event.target.value)} disabled={disabled} placeholder={disabled ? '当前任务运行中' : '输入任务，Enter 发送，Shift+Enter 换行'} onKeyDown={event => { if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); void submit() } }}/>
      <button className="primary" disabled={disabled || !draft.trim()} onClick={() => void submit()}>发送</button>
    </footer>
  </section>
}

function runLabel(status: AgentRun['status']) {
  return status === 'running' || status === 'planning' ? '正在执行' : status === 'completed' ? '已完成' : status
}
