import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import { claudeAssistantApi } from './claude-assistant-api.ts'
import { DEFAULT_CLAUDE_DRAWER_WIDTH, fitClaudeDrawerWidth } from './claude-assistant-layout.ts'
import { buildClaudeAttachments, extractInfluxqlBlocks, shouldRenameSession, type ClaudeContextSelection, type ClaudeContextSource } from './claude-assistant.ts'
import type { ClaudeAssistantAttachments, ClaudeAssistantMessage, ClaudeAssistantSession, ClaudeAssistantSessionSummary, ClaudeProbe } from './claude-assistant-types.ts'

type Props={
  open:boolean
  context:ClaudeContextSource
  onClose:()=>void
  onOpenSql:(sql:string)=>void
  onNotify:(message:string)=>void
}

const emptySelection:ClaudeContextSelection={sql:false,error:false,schema:false}
const drawerWidthKey='gdb.claudeDrawerWidth'

function initialDrawerWidth() {
  const stored=Number(window.localStorage.getItem(drawerWidthKey))
  return fitClaudeDrawerWidth(Number.isFinite(stored)&&stored>0?stored:DEFAULT_CLAUDE_DRAWER_WIDTH,window.innerWidth)
}

function titleFromMessage(content:string) {
  const compact=content.replace(/\s+/g,' ').trim()
  return compact.slice(0,28)||'新会话'
}

function messageParts(content:string) {
  const parts:{kind:'text'|'code';content:string}[]=[]
  const pattern=/```(?:influxql|sql)?\s*\n([\s\S]*?)```/gi
  let offset=0
  for(const match of content.matchAll(pattern)) {
    const index=match.index??0
    if(index>offset)parts.push({kind:'text',content:content.slice(offset,index)})
    parts.push({kind:'code',content:match[1].trim()})
    offset=index+match[0].length
  }
  if(offset<content.length)parts.push({kind:'text',content:content.slice(offset)})
  return parts.length?parts:[{kind:'text' as const,content}]
}

export default function ClaudeAssistantDrawer({
  open,context,onClose,onOpenSql,onNotify,
}:Props) {
  const [sessions,setSessions]=useState<ClaudeAssistantSessionSummary[]>([])
  const [activeId,setActiveId]=useState('')
  const [active,setActive]=useState<ClaudeAssistantSession>()
  const [titleDraft,setTitleDraft]=useState('')
  const [search,setSearch]=useState('')
  const [input,setInput]=useState('')
  const [selection,setSelection]=useState<ClaudeContextSelection>(emptySelection)
  const [loading,setLoading]=useState(false)
  const [initializing,setInitializing]=useState(false)
  const [probe,setProbe]=useState<ClaudeProbe>()
  const [cliPathDraft,setCliPathDraft]=useState('')
  const [savingSettings,setSavingSettings]=useState(false)
  const [drawerWidth,setDrawerWidth]=useState(initialDrawerWidth)
  const [drawerDragging,setDrawerDragging]=useState(false)
  const [deleteTarget,setDeleteTarget]=useState<ClaudeAssistantSessionSummary>()
  const abortRef=useRef<AbortController|undefined>(undefined)

  const refresh=useCallback(async()=>{
    const next=await claudeAssistantApi.listSessions()
    setSessions(next)
    return next
  },[])

  const loadSession=useCallback(async(id:string)=>{
    const detail=await claudeAssistantApi.getSession(id)
    setActiveId(id)
    setActive(detail)
    return detail
  },[])

  useEffect(()=>{
    if(!open)return
    let cancelled=false
    setInitializing(true)
    void Promise.all([refresh(),claudeAssistantApi.probe(),claudeAssistantApi.getSettings()]).then(async([next,nextProbe,nextSettings])=>{
      if(cancelled)return
      setProbe(nextProbe)
      setCliPathDraft(nextSettings.cliPath)
      const id=activeId&&next.some(item=>item.id===activeId)?activeId:next[0]?.id
      if(id)await loadSession(id)
      else setActive(undefined)
    }).catch(error=>!cancelled&&onNotify(error instanceof Error?error.message:'Claude 助手加载失败'))
      .finally(()=>!cancelled&&setInitializing(false))
    return()=>{cancelled=true}
  },[open,activeId,loadSession,onNotify,refresh])

  useEffect(()=>{
    const resize=()=>setDrawerWidth(current=>fitClaudeDrawerWidth(current,window.innerWidth))
    window.addEventListener('resize',resize)
    return()=>window.removeEventListener('resize',resize)
  },[])

  useEffect(()=>setTitleDraft(active?.title??''),[active?.id,active?.title])

  useEffect(()=>{
    if(!deleteTarget)return
    const onKeyDown=(event:KeyboardEvent)=>{if(event.key==='Escape'){event.preventDefault();setDeleteTarget(undefined)}}
    window.addEventListener('keydown',onKeyDown)
    return()=>window.removeEventListener('keydown',onKeyDown)
  },[deleteTarget])

  const visibleSessions=useMemo(()=>{
    const needle=search.trim().toLowerCase()
    return needle?sessions.filter(item=>item.title.toLowerCase().includes(needle)):sessions
  },[search,sessions])

  async function createSession(title='新会话') {
    const created=await claudeAssistantApi.createSession(title)
    setActiveId(created.id)
    setActive(created)
    await refresh()
    return created
  }

  function notifyCreateFailure(error:unknown) {
    onNotify(error instanceof Error?error.message:'新建 Claude 会话失败')
  }

  async function saveCliSettings() {
    if(savingSettings)return
    setSavingSettings(true)
    try{
      const settings=await claudeAssistantApi.saveSettings(cliPathDraft)
      setCliPathDraft(settings.cliPath)
      const nextProbe=await claudeAssistantApi.probe()
      setProbe(nextProbe)
      onNotify(nextProbe.ready?'Claude CLI 路径已保存并检测成功':`路径已保存：${nextProbe.message}`)
    }catch(error){onNotify(error instanceof Error?error.message:'Claude CLI 路径保存失败')}
    finally{setSavingSettings(false)}
  }

  function resizeDrawerBy(next:number) {
    const width=fitClaudeDrawerWidth(next,window.innerWidth)
    setDrawerWidth(width)
    window.localStorage.setItem(drawerWidthKey,String(width))
  }

  function beginDrawerResize(event:React.PointerEvent<HTMLButtonElement>) {
    event.preventDefault()
    const origin=event.clientX,start=drawerWidth
    setDrawerDragging(true)
    const move=(next:PointerEvent)=>setDrawerWidth(fitClaudeDrawerWidth(start+origin-next.clientX,window.innerWidth))
    const stop=(next:PointerEvent)=>{
      resizeDrawerBy(start+origin-next.clientX)
      setDrawerDragging(false)
      window.removeEventListener('pointermove',move)
      window.removeEventListener('pointerup',stop)
    }
    window.addEventListener('pointermove',move)
    window.addEventListener('pointerup',stop)
  }

  async function submit(content:string,attachments:ClaudeAssistantAttachments) {
    const message=content.trim()
    if(!message||loading)return
    setLoading(true)
    const controller=new AbortController()
    abortRef.current=controller
    let resolvedSessionId=active?.id??''
    try{
      const current=active??await createSession(titleFromMessage(message))
      resolvedSessionId=current.id
      if(current.title==='新会话')await claudeAssistantApi.renameSession(current.id,titleFromMessage(message))
      const next=await claudeAssistantApi.sendMessage(current.id,{content:message,attachments},controller.signal)
      setActive(next)
      setActiveId(next.id)
      setInput('')
      setSelection(emptySelection)
      await refresh()
    }catch(error){
      if(controller.signal.aborted)onNotify('已停止 Claude 回复')
      else onNotify(error instanceof Error?error.message:'Claude 回复失败')
      if(resolvedSessionId)void loadSession(resolvedSessionId).catch(()=>{})
    }finally{
      if(abortRef.current===controller)abortRef.current=undefined
      setLoading(false)
    }
  }

  function sendCurrent() {
    void submit(input,buildClaudeAttachments(context,selection))
  }

  function diagnoseCurrent() {
    if(!context.sql.trim())return onNotify('当前查询为空')
    void submit('请诊断当前查询：说明问题、给出修正后的 InfluxQL，并提示性能或写入风险。',buildClaudeAttachments(context,{sql:true,error:true,schema:true}))
  }

  async function renameActive() {
    if(!active||!shouldRenameSession(active.title,titleDraft)) {
      setTitleDraft(active?.title??'')
      return
    }
    const next=await claudeAssistantApi.renameSession(active.id,titleDraft.trim())
    setActive(next)
    setTitleDraft(next.title)
    await refresh()
  }

  async function confirmDelete() {
    if(!deleteTarget)return
    const id=deleteTarget.id
    await claudeAssistantApi.deleteSession(id)
    setDeleteTarget(undefined)
    const next=await refresh()
    if(activeId===id) {
      const replacement=next[0]
      if(replacement)await loadSession(replacement.id)
      else {setActiveId('');setActive(undefined)}
    }
  }

  return <aside className={`claude-assistant-drawer ${open?'open':''}`} aria-label="Claude 助手" style={{width:drawerWidth}}>
    <button className={`claude-assistant-resizer ${drawerDragging?'dragging':''}`} type="button" role="separator" aria-label="调整 Claude 助手宽度" aria-orientation="vertical" aria-valuemin={520} aria-valuemax={Math.max(520,window.innerWidth-96)} aria-valuenow={drawerWidth} onPointerDown={beginDrawerResize} onDoubleClick={()=>resizeDrawerBy(DEFAULT_CLAUDE_DRAWER_WIDTH)} onKeyDown={event=>{if(event.key==='ArrowLeft'){event.preventDefault();resizeDrawerBy(drawerWidth+16)}if(event.key==='ArrowRight'){event.preventDefault();resizeDrawerBy(drawerWidth-16)}if(event.key==='Home'){event.preventDefault();resizeDrawerBy(520)}if(event.key==='End'){event.preventDefault();resizeDrawerBy(window.innerWidth)}}} title="拖动调整宽度，双击恢复默认"/>
    <header className="claude-assistant-head"><div><b>✦ Claude 助手</b><small>{probe?.ready?'本地 CLI 已就绪':probe?.message||'检测本地 Claude CLI'}</small></div><button onClick={onClose} aria-label="关闭 Claude 助手">×</button></header>
    <div className="claude-cli-settings"><label><span>Claude CLI 路径</span><input value={cliPathDraft} onChange={event=>setCliPathDraft(event.target.value)} placeholder="留空使用自动检测" aria-label="Claude CLI 路径"/></label><button onClick={()=>void saveCliSettings()} disabled={savingSettings}>{savingSettings?'检测中…':'保存并检测'}</button><small>Claude Code CLI 的自定义路径；留空使用系统自动检测。</small></div>
    <div className="claude-assistant-layout">
      <nav className="claude-history" aria-label="聊天历史">
        <button className="primary claude-new-session" onClick={()=>void createSession().catch(notifyCreateFailure)}>＋ 新建会话</button>
        <input value={search} onChange={event=>setSearch(event.target.value)} placeholder="搜索历史" aria-label="搜索历史"/>
        <div className="claude-history-list">{visibleSessions.map(item=><div key={item.id} className={item.id===activeId?'active':''}><button onClick={()=>void loadSession(item.id)}><b>{item.title}</b><small>{new Date(item.updatedAt).toLocaleString('zh-CN')}</small></button><button className="claude-delete-session" onClick={()=>setDeleteTarget(item)} aria-label={`删除 ${item.title}`}>×</button></div>)}</div>
      </nav>
      <section className="claude-conversation">
        {initializing?<div className="claude-empty">正在读取本机历史…</div>:active?<>
          <input className="claude-session-title" value={titleDraft} onChange={event=>setTitleDraft(event.target.value)} onBlur={()=>void renameActive()} onKeyDown={event=>{if(event.key==='Enter')event.currentTarget.blur()}} aria-label="会话标题"/>
          <div className="claude-messages">{active.messages.length?active.messages.map(message=><ClaudeMessage key={message.id} message={message} onOpenSql={onOpenSql} onNotify={onNotify}/>):<div className="claude-empty"><b>开始一段本地对话</b><span>默认不会附带 SQL、错误或 Schema。</span></div>}</div>
        </>:<div className="claude-empty"><b>本地 Claude 助手</b><span>新建会话后，可进行普通聊天或诊断当前查询。</span><button className="primary" onClick={()=>void createSession().catch(notifyCreateFailure)}>新建会话</button></div>}
        <div className="claude-composer">
          <div className="claude-context-options">
            <label><input type="checkbox" checked={selection.sql} disabled={!context.sql.trim()} onChange={event=>setSelection({...selection,sql:event.target.checked})}/>附加当前 SQL</label>
            <label><input type="checkbox" checked={selection.error} disabled={!context.error.trim()} onChange={event=>setSelection({...selection,error:event.target.checked})}/>附加最近错误</label>
            <label><input type="checkbox" checked={selection.schema} disabled={!context.schema.fields.length&&!context.schema.tags.length} onChange={event=>setSelection({...selection,schema:event.target.checked})}/>附加 Schema</label>
          </div>
          <textarea value={input} onChange={event=>setInput(event.target.value)} onKeyDown={event=>{if(event.key==='Enter'&&!event.shiftKey){event.preventDefault();sendCurrent()}}} placeholder="向本地 Claude 提问，Enter 发送，Shift+Enter 换行"/>
          <div className="claude-composer-actions"><button onClick={diagnoseCurrent} disabled={loading||!context.sql.trim()}>诊断当前查询</button>{loading?<button className="danger" onClick={()=>abortRef.current?.abort()}>停止</button>:<button className="primary" disabled={!input.trim()} onClick={sendCurrent}>发送</button>}</div>
        </div>
      </section>
    </div>
    <footer>仅调用本机 Claude CLI · 历史保存在本机 · 不会自动执行 SQL</footer>
    {deleteTarget&&<div className="claude-delete-overlay"><div className="claude-delete-dialog" role="dialog" aria-modal="true" aria-labelledby="claude-delete-title"><h3 id="claude-delete-title">删除聊天记录？</h3><p>“{deleteTarget.title}”将从本机历史中删除。</p><div><button autoFocus onClick={()=>setDeleteTarget(undefined)}>取消</button><button className="danger" onClick={()=>void confirmDelete()}>确认删除</button></div></div></div>}
  </aside>
}

function ClaudeMessage({message,onOpenSql,onNotify}:{message:ClaudeAssistantMessage;onOpenSql:(sql:string)=>void;onNotify:(message:string)=>void}) {
  const blocks=extractInfluxqlBlocks(message.content)
  return <article className={`claude-message ${message.role}`}><header>{message.role==='user'?'你':'Claude'}<time>{new Date(message.createdAt).toLocaleTimeString('zh-CN')}</time></header>{message.attachments&&<div className="claude-message-attachments">{message.attachments.sql&&<span>SQL</span>}{message.attachments.error&&<span>错误</span>}{message.attachments.schema&&<span>Schema</span>}</div>}<div className="claude-message-content">{messageParts(message.content).map((part,index)=>part.kind==='code'?<pre key={index}><code>{part.content}</code></pre>:<p key={index}>{part.content}</p>)}</div>{blocks.map((sql,index)=><div className="claude-code-actions" key={`${sql}-${index}`}><button onClick={()=>void navigator.clipboard.writeText(sql).then(()=>onNotify('SQL 已复制')).catch(()=>onNotify('复制失败'))}>复制</button><button onClick={()=>onOpenSql(sql)}>打开到新查询</button></div>)}</article>
}
