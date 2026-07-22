import { lazy, Suspense, useEffect, useMemo, useRef, useState } from 'react'
import { bridge } from './api'
import { load, save } from './storage'
import type { Connection, Execution, Favorite, MeasurementSchema, QueryRow } from './types'
const QueryEditor = lazy(() => import('./QueryEditor'))

const DEFAULT_CONNECTION: Connection = { id: 'mock', name: 'GeminiDB · 本地 Mock', mode: 'mock', endpoint: '', username: 'demo', password: 'demo', autoLogin: true, readOnly: false, insecureSkipVerify: false }
const DEFAULT_SQL = 'SELECT *\nFROM "t_maas_monitor_metrics_basic_m_1784563200"\nWHERE time >= now() - 1h\nORDER BY time DESC\nLIMIT 100'
type SideTool = 'connections' | 'catalog'
type ResultView = 'result' | 'history' | 'messages' | 'favorites'
type QueryTab = { id: string; name: string; sql: string }
const DEFAULT_TAB: QueryTab = { id: 'query-1', name: '查询 1', sql: DEFAULT_SQL }

function splitTable(name: string) { const match = name.match(/^(.*)_(\d{10})$/); return match ? { prefix: match[1], timestamp: Number(match[2]) } : { prefix: name, timestamp: null } }
function day(timestamp: number | null) { return timestamp ? new Intl.DateTimeFormat('zh-CN', { timeZone: 'Asia/Shanghai', dateStyle: 'medium' }).format(new Date(timestamp * 1000)) : '常驻表' }
function formatTime(value: number) { return new Date(value).toLocaleString('zh-CN') }
function formatBeijing(date: Date) { return new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Shanghai', dateStyle: 'short', timeStyle: 'medium', hourCycle: 'h23' }).format(date) }
function parseBeijing(value: string) { const m = value.match(/^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})(?::(\d{2}))?$/); return m ? Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4] - 8, +m[5], +(m[6] || 0)) : NaN }
function download(name: string, type: string, content: string) { const url = URL.createObjectURL(new Blob([content], { type })); const link = document.createElement('a'); link.href = url; link.download = name; link.click(); URL.revokeObjectURL(url) }

export default function App() {
  const [connections, setConnections] = useState<Connection[]>(() => load('gdb.connections', [DEFAULT_CONNECTION]))
  const [activeConnection, setActiveConnection] = useState(() => load('gdb.activeConnection', 'mock'))
  const [databases, setDatabases] = useState<string[]>([])
  const [database, setDatabase] = useState('monitoring')
  const [tables, setTables] = useState<string[]>([])
  const [selectedTable, setSelectedTable] = useState('')
  const [schema, setSchema] = useState<MeasurementSchema>({ fields: [], tags: [] })
  const [databaseOpen, setDatabaseOpen] = useState(true)
  const [measurementsOpen, setMeasurementsOpen] = useState(true)
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(() => new Set())
  const [filter, setFilter] = useState('')
  const [queryTabs, setQueryTabs] = useState<QueryTab[]>(() => { const tabs=load<QueryTab[]>('gdb.queryTabs',[DEFAULT_TAB]); return tabs.length ? tabs : [DEFAULT_TAB] })
  const [activeTabId, setActiveTabId] = useState(() => load('gdb.activeQueryTab','query-1'))
  const [rows, setRows] = useState<QueryRow[]>([])
  const [history, setHistory] = useState<Execution[]>(() => load('gdb.history', []))
  const [favorites, setFavorites] = useState<Favorite[]>(() => load('gdb.favorites', []))
  const [view, setView] = useState<ResultView>('result')
  const [sideTool, setSideTool] = useState<SideTool>(() => load('gdb.sideTool', 'catalog'))
  const [sideOpen, setSideOpen] = useState(() => load('gdb.sideOpen', true))
  const [status, setStatus] = useState('等待连接')
  const [resultStatus, setResultStatus] = useState('READY')
  const [resultMeta, setResultMeta] = useState('支持查询与写入')
  const [message, setMessage] = useState('')
  const [running, setRunning] = useState(false)
  const queryAbort = useRef<AbortController | null>(null)
  const cancelReason = useRef<'user' | 'timeout' | null>(null)
  const [connectionDialog, setConnectionDialog] = useState<Connection | null>(null)
  const [timeDialog, setTimeDialog] = useState(false)
  const [claudeOpen, setClaudeOpen] = useState(false)
  const [claudeAnswer, setClaudeAnswer] = useState<{ answer: string; suggestedSql: string } | null>(null)

  const currentConnection = connections.find(c => c.id === activeConnection) || connections[0]
  const activeQueryTab = queryTabs.find(tab => tab.id === activeTabId) || queryTabs[0]
  const sql = activeQueryTab?.sql || ''
  const filteredTables = useMemo(() => tables.filter(t => t.toLowerCase().includes(filter.toLowerCase())), [tables, filter])
  const tableGroups = useMemo(() => filteredTables.reduce<Record<string, string[]>>((all, table) => { const prefix = splitTable(table).prefix; (all[prefix] ||= []).push(table); return all }, {}), [filteredTables])

  function toast(text: string) { setMessage(text); window.setTimeout(() => setMessage(''), 1800) }
  function persistQueryTabs(next: QueryTab[]) { setQueryTabs(next); save('gdb.queryTabs',next) }
  function setSql(nextSql: string) { persistQueryTabs(queryTabs.map(tab => tab.id === activeQueryTab.id ? {...tab,sql:nextSql} : tab)) }
  function addQueryTab() { const id=crypto.randomUUID(),next=[...queryTabs,{id,name:`查询 ${queryTabs.length+1}`,sql:''}];persistQueryTabs(next);setActiveTabId(id);save('gdb.activeQueryTab',id) }
  function selectQueryTab(id: string) { setActiveTabId(id); save('gdb.activeQueryTab',id) }
  function closeQueryTab(id: string) { if(queryTabs.length===1){persistQueryTabs([{...queryTabs[0],sql:'',name:'查询 1'}]);return}const index=queryTabs.findIndex(tab=>tab.id===id),next=queryTabs.filter(tab=>tab.id!==id);persistQueryTabs(next);if(id===activeTabId)selectQueryTab(next[Math.max(0,index-1)].id) }
  function renameQueryTab(id: string) { const current=queryTabs.find(tab=>tab.id===id);if(!current)return;const name=window.prompt('查询页签名称',current.name)?.trim();if(name)persistQueryTabs(queryTabs.map(tab=>tab.id===id?{...tab,name}:tab)) }
  function persistConnections(next: Connection[]) { setConnections(next); next.forEach(connection => { if (connection.password) sessionStorage.setItem(`gdb.password.${connection.id}`, connection.password) }); save('gdb.connections', next.map(connection => ({ ...connection, password: '' }))) }
  function switchTool(tool: SideTool) { if (tool === sideTool && sideOpen) { setSideOpen(false); save('gdb.sideOpen', false); return } setSideTool(tool); setSideOpen(true); save('gdb.sideTool', tool); save('gdb.sideOpen', true) }

  async function connect(connection = currentConnection) {
    if (!connection) return
    setStatus('正在登录…')
    try {
      await bridge.login({ mode: connection.mode, endpoint: connection.endpoint, username: connection.username, password: connection.password || sessionStorage.getItem(`gdb.password.${connection.id}`) || '', insecureSkipVerify: connection.insecureSkipVerify, readOnly: connection.readOnly })
      const list = await bridge.databases()
      const nextDb = list.includes(database) ? database : list[0]
      setDatabases(list); setDatabase(nextDb); setTables(await bridge.tables(nextDb)); setStatus(`${connection.name} 已连接`); toast('已登录并载入数据目录')
    } catch (error) { setStatus('连接失败'); toast(error instanceof Error ? error.message : '连接失败') }
  }

  useEffect(() => { if (currentConnection?.autoLogin) void connect({ ...DEFAULT_CONNECTION, ...currentConnection }) }, [])

  async function changeDatabase(next: string) {
    if (!next || next === database) return
    const started = performance.now()
    try {
      await bridge.query(database, `USE \`${next}\``)
      setDatabase(next); setSelectedTable(''); setSchema({fields:[],tags:[]}); setTables(await bridge.tables(next)); addHistory(`USE \`${next}\``, performance.now() - started, 'success', 'database 已切换', next); toast(`已执行 USE ${next}`)
    } catch (error) { addHistory(`USE \`${next}\``, performance.now() - started, 'error', error instanceof Error ? error.message : '切换失败', database) }
  }

  async function chooseTable(table: string) {
    setSelectedTable(table)
    setSchema({ fields: [], tags: [] })
    persistQueryTabs(queryTabs.map(tab => tab.id === activeQueryTab.id ? {...tab,name:table.replace(/_\d{10}$/,'').slice(0,28),sql:`SELECT *\nFROM "${table}"\nWHERE time >= now() - 1h\nORDER BY time DESC\nLIMIT 100`} : tab))
    try { const nextSchema=await bridge.schema(database,table);setSchema(nextSchema);toast(`已载入 ${nextSchema.fields.length} 个字段、${nextSchema.tags.length} 个 Tag`) }
    catch (error) { toast(error instanceof Error ? `字段加载失败：${error.message}` : '字段加载失败') }
  }

  function toggleGroup(prefix: string) { setCollapsedGroups(current => { const next=new Set(current);if(next.has(prefix))next.delete(prefix);else next.add(prefix);return next }) }

  function addHistory(command: string, duration: number, executionStatus: Execution['status'], result: string, db = database) {
    setHistory(previous => { const next = [{ id: crypto.randomUUID(), executedAt: Date.now(), sql: command, durationMs: Math.round(duration), status: executionStatus, result, database: db }, ...previous].slice(0, 100); save('gdb.history', next); return next })
  }

  async function runQuery(commandOverride?: string) {
    const command = (commandOverride ?? sql).trim(); if (!command || running) return
    const isWrite = /^write\s+/i.test(command)
    if (isWrite && currentConnection?.readOnly) return toast('当前连接为只读，不能执行 WRITE')
    if (isWrite && !window.confirm(`确认向 ${database} 写入数据？\n\n${command}`)) return
    const controller = new AbortController(); queryAbort.current = controller; cancelReason.current = null
    const timeout = window.setTimeout(() => { cancelReason.current = 'timeout'; controller.abort() }, 30000)
    setRunning(true); setView('result'); setResultStatus('RUNNING'); const started = performance.now()
    try {
      const data = await bridge.query(database, command, controller.signal); const duration = data.durationMs || performance.now() - started
      if (data.rows) { setRows(data.rows); setResultMeta(`${data.rows.length} rows · ${Math.round(duration)} ms`); addHistory(command, duration, 'success', `${data.rows.length} 行`) }
      else { setRows([]); setResultMeta(`${data.affectedRows || 0} affected · ${Math.round(duration)} ms`); addHistory(command, duration, 'success', `影响 ${data.affectedRows || 0} 行`) }
      setResultStatus('SUCCESS'); toast(data.rows ? '查询完成' : '写入完成')
    } catch (error) {
      const cancelled = error instanceof DOMException && error.name === 'AbortError'
      const text = cancelled ? (cancelReason.current === 'timeout' ? '查询超过 30 秒，已取消' : '查询已取消') : error instanceof Error ? error.message : '执行失败'
      setRows([]); setResultStatus(cancelled ? 'CANCELLED' : 'ERROR'); setResultMeta(`${Math.round(performance.now() - started)} ms`); addHistory(command, performance.now() - started, cancelled ? 'cancelled' : 'error', text); toast(text)
    } finally { window.clearTimeout(timeout); queryAbort.current = null; cancelReason.current = null; setRunning(false) }
  }
  function cancelQuery() { cancelReason.current = 'user'; queryAbort.current?.abort() }

  function saveFavorite() { const name = window.prompt('收藏名称', `常用命令 · ${database}`); if (!name) return; const next = [{ id: crypto.randomUUID(), name, sql, database }, ...favorites]; setFavorites(next); save('gdb.favorites', next); toast('已加入收藏') }
  async function askClaude() { setClaudeOpen(true); setClaudeAnswer(null); try { setClaudeAnswer(await bridge.ask(database, sql)) } catch (error) { setClaudeAnswer({ answer: error instanceof Error ? error.message : 'Claude Bridge 不可用', suggestedSql: '' }) } }
  function exportCsv() { if (!rows.length) return toast('没有可导出的结果'); const columns = Object.keys(rows[0]); const cell = (v: unknown) => `"${String(v ?? '').replaceAll('"', '""')}"`; download(`geminidb-${Date.now()}.csv`, 'text/csv;charset=utf-8', '\ufeff' + columns.map(cell).join(',') + '\n' + rows.map(row => columns.map(c => cell(row[c])).join(',')).join('\n')) }

  return <div className={`app ${sideOpen ? '' : 'sidebar-closed'}`}>
    <header><div className="brand"><span className="brand-mark"/><b>GeminiDB Studio</b></div><div className="topbar">
      <select value={database} onChange={e => void changeDatabase(e.target.value)} disabled={!databases.length}>{databases.map(db => <option key={db}>{db}</option>)}</select>
      <button className="icon-button" onClick={() => setTimeDialog(true)} title="时间戳转换">◷</button><span className={`connection-state ${status.includes('失败') ? 'error' : ''}`}><i/>{status}</span><button onClick={() => setConnectionDialog(currentConnection)}>管理连接</button>
    </div></header>

    <aside className="left-sidebar"><nav className="tool-rail"><button className={sideOpen && sideTool === 'connections' ? 'active' : ''} onClick={() => switchTool('connections')} title="常用连接">⌘</button><button className={sideOpen && sideTool === 'catalog' ? 'active' : ''} onClick={() => switchTool('catalog')} title="数据目录">▦</button></nav>
      <div className="side-content">{sideTool === 'connections' ? <section className="side-panel"><PanelTitle title="常用连接" count={connections.length}/><div className="panel-scroll">{connections.map(connection => <button key={connection.id} className={`connection-row ${connection.id === activeConnection ? 'active' : ''}`} onClick={() => { setActiveConnection(connection.id); save('gdb.activeConnection', connection.id); void connect(connection) }}><span className="database-icon">◉</span><span><b>{connection.name}</b><small>{connection.mode === 'mock' ? '本地 Mock Bridge' : connection.endpoint}</small></span></button>)}<button className="add-row" onClick={() => setConnectionDialog({ ...DEFAULT_CONNECTION, id:'', name:'', mode:'influx', endpoint:'https://', username:'rwuser', password:'' })}>＋ 添加 GeminiDB 连接</button></div></section> :
      <section className="side-panel"><PanelTitle title="数据目录" count={databases.length}/><div className="catalog-tools"><small>{database} · {filteredTables.length} 张天表</small><button onClick={() => void connect()}>↻</button></div><div className="search"><span>⌕</span><input value={filter} onChange={e => setFilter(e.target.value)} placeholder="按 measurement 前缀或表名筛选"/></div><div className="tree"><button className="tree-row selected tree-toggle" aria-expanded={databaseOpen} onClick={()=>setDatabaseOpen(value=>!value)}><span>{databaseOpen?'▼':'▶'}</span><b>▱ {database}</b><em>database</em></button>{databaseOpen&&<><button className="tree-row level-1 tree-toggle" aria-expanded={measurementsOpen} onClick={()=>setMeasurementsOpen(value=>!value)}><span>{measurementsOpen?'▼':'▶'}</span><b>◉ measurements</b><em>{filteredTables.length} 天表</em></button>{measurementsOpen&&Object.entries(tableGroups).map(([prefix, group]) => {const open=!collapsedGroups.has(prefix);return <div key={prefix}><button className="tree-row level-2 tree-toggle" aria-expanded={open} onClick={()=>toggleGroup(prefix)}><span>{open?'▼':'▶'}</span><b><code>M</code> {prefix}</b><em>{group.length}</em></button>{open&&group.toSorted().reverse().map(table => { const parsed = splitTable(table); return <button key={table} onClick={() => void chooseTable(table)} className={`tree-row table-row level-3 ${table === selectedTable ? 'selected' : ''}`}><span>•</span><span><b>{day(parsed.timestamp)}</b><small>{table}</small></span></button> })}</div>})}</>}</div></section>}</div>
    </aside>

    <main><section className="editor"><div className="editor-head"><div><h1>查询窗口</h1><span className="context">{database} / {selectedTable || '未选表'}</span></div><div className="actions"><button className="claude" onClick={() => void askClaude()}>✦ 问 Claude Code</button><button onClick={saveFavorite}>☆ 收藏语句</button><button className={running ? 'danger' : 'primary'} onClick={running ? cancelQuery : () => void runQuery()}>{running ? '■ 取消查询' : '▶ 执行命令'}</button></div></div><div className="query-tabs" role="tablist">{queryTabs.map(tab=><div key={tab.id} role="tab" tabIndex={0} aria-selected={tab.id===activeQueryTab.id} className={`query-tab ${tab.id===activeQueryTab.id?'active':''}`} onClick={()=>selectQueryTab(tab.id)} onKeyDown={event=>{if(event.key==='Enter'||event.key===' ')selectQueryTab(tab.id)}} onDoubleClick={()=>renameQueryTab(tab.id)} title="双击重命名"><span>{tab.name}</span><button className="close-tab" onClick={event=>{event.stopPropagation();closeQueryTab(tab.id)}} aria-label={`关闭 ${tab.name}`}>×</button></div>)}<button className="add-query-tab" onClick={addQueryTab} title="新建查询">＋</button></div><Suspense fallback={<div className="editor-loading">正在加载 InfluxQL 编辑器…</div>}><QueryEditor tabId={activeQueryTab.id} value={sql} measurements={tables} schema={schema} onChange={setSql} onRun={command=>void runQuery(command)}/></Suspense></section>
      <section className="results"><div className="result-tabs"><div>{(['result','history','messages','favorites'] as ResultView[]).map(item => <button key={item} className={view === item ? 'active' : ''} onClick={() => setView(item)}>{({result:'执行结果',history:`执行记录 ${history.length}`,messages:'交互消息',favorites:`收藏 ${favorites.length}`})[item]}</button>)}</div>{view === 'result' && <div><button onClick={() => navigator.clipboard.writeText(JSON.stringify(rows, null, 2))}>复制</button><button onClick={exportCsv}>导出 CSV</button><button onClick={() => rows.length ? download(`geminidb-${Date.now()}.json`, 'application/json', JSON.stringify(rows, null, 2)) : toast('没有可导出的结果')}>导出 JSON</button></div>}</div><div className="result-body"><ResultContent view={view} rows={rows} history={history} favorites={favorites} onUseSql={value => { setSql(value); setView('result') }} onRemoveFavorite={id => { const next = favorites.filter(f => f.id !== id); setFavorites(next); save('gdb.favorites', next) }}/></div><div className="statusbar"><b className={resultStatus === 'ERROR' ? 'danger' : ''}>{resultStatus}</b><span>{resultMeta}</span></div></section>
    </main>

    {connectionDialog && <ConnectionDialog connection={connectionDialog} onClose={() => setConnectionDialog(null)} onSave={connection => { const next = connections.some(c => c.id === connection.id) ? connections.map(c => c.id === connection.id ? connection : c) : [connection, ...connections]; persistConnections(next); setActiveConnection(connection.id); save('gdb.activeConnection', connection.id); setConnectionDialog(null); void connect(connection) }}/>} 
    {timeDialog && <TimeDialog onClose={() => setTimeDialog(false)}/>} 
    <aside className={`claude-drawer ${claudeOpen ? 'open' : ''}`}><div className="drawer-head"><b>✦ Claude Code</b><button onClick={() => setClaudeOpen(false)}>×</button></div><div className="drawer-body">{claudeAnswer ? <div className="assistant"><b>Claude Code</b><p>{claudeAnswer.answer}</p>{claudeAnswer.suggestedSql && <><pre>{claudeAnswer.suggestedSql}</pre><button onClick={() => { setSql(claudeAnswer.suggestedSql); setClaudeOpen(false) }}>采用建议 SQL</button></>}</div> : <div className="center">Claude Code 正在分析当前命令…</div>}</div><footer>当前上下文：{database} · 本地 Bridge</footer></aside>
    {message && <div className="toast">{message}</div>}
  </div>
}

function PanelTitle({ title, count }: { title: string; count: number }) { return <div className="panel-title"><b>{title}</b><small>{count}</small></div> }

function ResultContent({ view, rows, history, favorites, onUseSql, onRemoveFavorite }: { view: ResultView; rows: QueryRow[]; history: Execution[]; favorites: Favorite[]; onUseSql: (sql: string) => void; onRemoveFavorite: (id: string) => void }) {
  if (view === 'history') return history.length ? <table><thead><tr><th>执行时间</th><th>命令语句</th><th>耗时</th><th>执行结果</th></tr></thead><tbody>{history.map(item => <tr key={item.id} onClick={() => onUseSql(item.sql)}><td>{formatTime(item.executedAt)}</td><td>{item.sql.replace(/\s+/g, ' ')}</td><td>{item.durationMs} ms</td><td className={item.status === 'success' ? 'success' : 'danger'}>{item.status === 'success' ? '成功' : item.status === 'cancelled' ? '已取消' : '失败'} · {item.result}</td></tr>)}</tbody></table> : <Empty text="还没有执行记录"/>
  if (view === 'messages') return history.length ? <div className="messages">{history.map(item => <pre key={item.id}>{`--------开始执行--------\n【执行命令】\n${item.sql}\n执行命令${item.status === 'success' ? '成功' : item.status === 'cancelled' ? '已取消' : '失败'}，耗时：[${item.durationMs}ms]！`}</pre>)}</div> : <Empty text="还没有交互消息"/>
  if (view === 'favorites') return favorites.length ? <div className="favorite-list">{favorites.map(item => <div className="favorite" key={item.id} onClick={() => onUseSql(item.sql)}><span><b>★ {item.name}</b><code>{item.sql.replace(/\s+/g, ' ')}</code></span><button onClick={e => { e.stopPropagation(); onRemoveFavorite(item.id) }}>×</button></div>)}</div> : <Empty text="还没有收藏语句"/>
  if (!rows.length) return <Empty text="执行命令后在这里查看结果" sub="查询返回数据表，写入返回影响行数"/>
  const columns = Object.keys(rows[0]); return <table><thead><tr>{columns.map(c => <th key={c}>{c}<small>{typeof rows[0][c]}</small></th>)}</tr></thead><tbody>{rows.map((row, index) => <tr key={index}>{columns.map(c => <td key={c}>{String(row[c] ?? 'NULL')}</td>)}</tr>)}</tbody></table>
}
function Empty({ text, sub }: { text: string; sub?: string }) { return <div className="center"><div><b>{text}</b>{sub && <small>{sub}</small>}</div></div> }

function ConnectionDialog({ connection, onClose, onSave }: { connection: Connection; onClose: () => void; onSave: (connection: Connection) => void }) {
  const [draft, setDraft] = useState(connection)
  return <div className="modal"><div className="dialog"><h2>GeminiDB Influx 连接</h2><p>真实连接默认使用 InfluxDB 1.x HTTP API；常用端口为 8635。</p><div className="form-row"><label>连接名称<input value={draft.name} onChange={e => setDraft({...draft, name:e.target.value})}/></label><label>连接模式<select value={draft.mode} onChange={e => setDraft({...draft, mode:e.target.value as Connection['mode']})}><option value="influx">GeminiDB Influx</option><option value="mock">本地 Mock</option></select></label></div>{draft.mode === 'influx' && <label>实例地址<input value={draft.endpoint} onChange={e => setDraft({...draft, endpoint:e.target.value})} placeholder="https://192.0.2.10:8635"/></label>}<div className="form-row"><label>用户名<input value={draft.username} onChange={e => setDraft({...draft, username:e.target.value})}/></label><label>密码<input type="password" value={draft.password || ''} onChange={e => setDraft({...draft, password:e.target.value})}/></label></div><label className="checkbox"><input type="checkbox" checked={draft.autoLogin} onChange={e => setDraft({...draft, autoLogin:e.target.checked})}/> 打开页面时自动登录</label><label className="checkbox"><input type="checkbox" checked={draft.readOnly} onChange={e => setDraft({...draft, readOnly:e.target.checked})}/> 只读连接（禁止 WRITE）</label>{draft.mode === 'influx' && <label className="checkbox"><input type="checkbox" checked={draft.insecureSkipVerify} onChange={e => setDraft({...draft, insecureSkipVerify:e.target.checked})}/> 忽略 TLS 证书校验（仅限自签名证书）</label>}<div className="dialog-actions"><button onClick={onClose}>取消</button><button className="primary" onClick={() => onSave({...draft, id:draft.id || crypto.randomUUID()})}>保存并连接</button></div></div></div>
}

function TimeDialog({ onClose }: { onClose: () => void }) {
  const [timestamp, setTimestamp] = useState(String(Math.floor(Date.now()/1000))); const [date, setDate] = useState(formatBeijing(new Date())); const [dateResult, setDateResult] = useState(''); const [timestampResult, setTimestampResult] = useState('')
  function toDate() { const n = Number(timestamp); const ms = Math.abs(n) >= 1e12 ? n : n * 1000; const parsed = new Date(ms); setDateResult(Number.isNaN(parsed.getTime()) ? '请输入有效时间戳' : `北京时间：${formatBeijing(parsed)}\nUTC：${parsed.toISOString()}`) }
  function toTimestamp() { const ms = parseBeijing(date); setTimestampResult(Number.isNaN(ms) ? '请输入 YYYY-MM-DD HH:mm:ss' : `秒：${Math.floor(ms/1000)}\n毫秒：${ms}`) }
  return <div className="modal"><div className="dialog wide"><h2>时间戳 ↔ 北京时间</h2><p>固定使用 Asia/Shanghai（UTC+8）转换。</p><div className="conversion"><b>任意时间戳 → 北京时间</b><div className="convert-row"><input value={timestamp} onChange={e => setTimestamp(e.target.value)}/><button className="primary" onClick={toDate}>转换</button></div><pre>{dateResult || '支持 10 位秒级和 13 位毫秒级时间戳'}</pre></div><div className="conversion"><b>任意北京时间 → Unix 时间戳</b><div className="convert-row"><input value={date} onChange={e => setDate(e.target.value)}/><button className="primary" onClick={toTimestamp}>转换</button></div><pre>{timestampResult || '例如：2026-07-22 08:00:00'}</pre></div><div className="dialog-actions"><span/><button onClick={onClose}>关闭</button></div></div></div>
}
