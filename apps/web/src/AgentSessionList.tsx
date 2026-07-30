import type { AgentSessionSummary } from './agent-types'

type Props = {
  sessions: AgentSessionSummary[]
  activeId?: string
  busy?: boolean
  open?: boolean
  onCreate: () => void
  onSelect: (id: string) => void
  onRename: (session: AgentSessionSummary) => void
  onDelete: (session: AgentSessionSummary) => void
}

export default function AgentSessionList({ sessions, activeId, busy, open, onCreate, onSelect, onRename, onDelete }: Props) {
  return <aside className={`agent-sessions ${open ? 'open' : ''}`} aria-label="Agent 会话">
    <header><div><b>会话</b><small>{sessions.length}</small></div><button className="primary" disabled={busy} onClick={onCreate}>新建</button></header>
    <div className="agent-session-scroll">
      {!sessions.length && <div className="agent-empty"><b>开始一个任务</b><span>选择当前 Database 后新建会话。</span></div>}
      {sessions.map(session => <article key={session.id} className={session.id === activeId ? 'active' : ''}>
        <button className="agent-session-main" onClick={() => onSelect(session.id)}>
          <b>{session.title || '未命名会话'}</b>
          <span>{session.database || '未选 Database'} · {statusLabel(session.status)}</span>
        </button>
        <div><button onClick={() => onRename(session)} aria-label={`重命名 ${session.title || '会话'}`}>改名</button><button onClick={() => onDelete(session)} aria-label={`删除 ${session.title || '会话'}`}>删除</button></div>
      </article>)}
    </div>
  </aside>
}

function statusLabel(status: AgentSessionSummary['status']) {
  return ({ planning:'规划中', running:'执行中', completed:'已完成', stopped:'已停止', budget_exceeded:'已达预算', blocked:'已阻止', failed:'失败', interrupted:'已中断' })[status]
}
