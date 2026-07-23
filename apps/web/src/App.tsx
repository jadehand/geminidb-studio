import { lazy, Suspense, useEffect, useMemo, useRef, useState } from 'react'
import { bridge } from './api'
import { load, save } from './storage'
import { deleteCredential, loadCredential, saveCredential } from './credentials'
import { filterDayTables, multiTableQuery, type DayRange } from './day-tables'
import ResultsTable from './ResultsTable'
import { inspectInfluxQL, lineDiff, localFix } from './diagnostics'
import { beginSession, clearWorkspace, endSession, readWorkspace, writeWorkspace } from './workspace'
import { createDiagnosticProvider } from './diagnostic-provider'
import { getDesktopBridgeStatus, restartDesktopBridge, type DesktopBridgeStatus } from './desktop'
import { connectionForTransport, endpointProtocol, withEndpointProtocol } from './endpoint'
import { clampSidebarWidth, DEFAULT_SIDEBAR_WIDTH, MAX_SIDEBAR_WIDTH, MIN_SIDEBAR_WIDTH } from './sidebar-width'
import { conversionFromMilliseconds, formatBeijing, formatUtcInput, parseDateTime, parseUnixTimestamp, type DateTimeZone, type TimeConversion } from './time-converter'
import { csvContent, excelContent, jsonContent } from './result-export'
import { NEW_INFLUX_CONNECTION, removeMockConnections } from './connections'
import type { ClaudeDiagnosis, ClaudeSettings, Connection, Execution, Favorite, MeasurementSchema, QueryRow } from './types'
const QueryEditor = lazy(() => import('./QueryEditor'))

const DEFAULT_SQL = 'SHOW DATABASES'
type SideTool = 'connections' | 'catalog'
type ResultView = 'result' | 'chart' | 'history' | 'messages' | 'favorites'
type QueryTab = { id: string; name: string; sql: string }
const DEFAULT_TAB: QueryTab = { id: 'query-1', name: '查询 1', sql: DEFAULT_SQL }
const UNCLEAN_SESSION = beginSession()
function fitSidebarWidth(value:number){return clampSidebarWidth(Math.min(value,window.innerWidth-640))}
function loadActiveConnection(){const id=load<string>('gdb.activeConnection','');return id==='mock'?'':id}

function splitTable(name: string) { const match = name.match(/^(.*)_(\d{10})$/); return match ? { prefix: match[1], timestamp: Number(match[2]) } : { prefix: name, timestamp: null } }
function day(timestamp: number | null) { return timestamp ? new Intl.DateTimeFormat('zh-CN', { timeZone: 'Asia/Shanghai', dateStyle: 'medium' }).format(new Date(timestamp * 1000)) : '常驻表' }
function formatTime(value: number) { return new Date(value).toLocaleString('zh-CN') }
function download(name: string, type: string, content: string) { const url = URL.createObjectURL(new Blob([content], { type })); const link = document.createElement('a'); link.href = url; link.download = name; link.hidden = true; document.body.append(link); link.click(); link.remove(); window.setTimeout(() => URL.revokeObjectURL(url), 1000) }

export default function App() {
  const [connections, setConnections] = useState<Connection[]>(() => removeMockConnections(load('gdb.connections', [])))
  const [activeConnection, setActiveConnection] = useState(loadActiveConnection)
  const [databases, setDatabases] = useState<string[]>([])
  const [database, setDatabase] = useState(() => load('gdb.workspace.database','monitoring'))
  const [tables, setTables] = useState<string[]>([])
  const [selectedTable, setSelectedTable] = useState(() => load('gdb.workspace.measurement',''))
  const [schema, setSchema] = useState<MeasurementSchema>({ fields: [], tags: [] })
  const [schemaLoading, setSchemaLoading] = useState(false)
  const [databaseOpen, setDatabaseOpen] = useState(true)
  const [measurementsOpen, setMeasurementsOpen] = useState(true)
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(() => new Set())
  const [filter, setFilter] = useState('')
  const [dayRange, setDayRange] = useState<DayRange>(()=>load('gdb.workspace.dayRange','all'))
  const [queryTabs, setQueryTabs] = useState<QueryTab[]>(() => { const tabs=load<QueryTab[]>('gdb.queryTabs',[DEFAULT_TAB]); return tabs.length ? tabs : [DEFAULT_TAB] })
  const [activeTabId, setActiveTabId] = useState(() => load('gdb.activeQueryTab','query-1'))
  const [rows, setRows] = useState<QueryRow[]>([])
  const [history, setHistory] = useState<Execution[]>(() => load('gdb.history', []))
  const [favorites, setFavorites] = useState<Favorite[]>(() => load('gdb.favorites', []))
  const [view, setView] = useState<ResultView>(()=>load('gdb.workspace.resultView','result'))
  const [sideTool, setSideTool] = useState<SideTool>(() => load('gdb.sideTool', 'connections'))
  const [sideOpen, setSideOpen] = useState(() => load('gdb.sideOpen', true))
  const [sidebarWidth,setSidebarWidth]=useState(()=>fitSidebarWidth(load('gdb.sidebarWidth',DEFAULT_SIDEBAR_WIDTH)))
  const [sidebarDragging,setSidebarDragging]=useState(false)
  const [status, setStatus] = useState('等待连接')
  const [resultStatus, setResultStatus] = useState('READY')
  const [resultMeta, setResultMeta] = useState('支持查询与写入')
  const [message, setMessage] = useState('')
  const [running, setRunning] = useState(false)
  const queryAbort = useRef<AbortController | null>(null)
  const schemaCache = useRef(new Map<string, MeasurementSchema>())
  const schemaRequest = useRef(0)
  const cancelReason = useRef<'user' | 'timeout' | null>(null)
  const [connectionDialog, setConnectionDialog] = useState<Connection | null>(null)
  const [timeDialog, setTimeDialog] = useState(false)
  const [claudeOpen, setClaudeOpen] = useState(false)
  const [claudeAnswer, setClaudeAnswer] = useState<ClaudeDiagnosis | null>(null)
  const [claudeLoading,setClaudeLoading]=useState(false),[claudeSettingsOpen,setClaudeSettingsOpen]=useState(false)
  const [claudeSettings,setClaudeSettings]=useState<ClaudeSettings>(()=>{const defaults:ClaudeSettings={provider:'cli',cliPath:'claude',endpoint:'https://api.anthropic.com',model:'claude-sonnet-4-5',maxTokens:2048};return{...defaults,...load('gdb.claude.settings',defaults)}})
  const [lastError,setLastError]=useState('')
  const [recoveryOpen,setRecoveryOpen]=useState(UNCLEAN_SESSION)
  const [bridgeStatus,setBridgeStatus]=useState<DesktopBridgeStatus|null>(null)
  const [bridgeRetrying,setBridgeRetrying]=useState(false)
  const diagnosticAbort=useRef<AbortController|null>(null),diagnosticRequest=useRef(0)

  const currentConnection = connections.find(c => c.id === activeConnection) || connections[0]
  const activeQueryTab = queryTabs.find(tab => tab.id === activeTabId) || queryTabs[0]
  const sql = activeQueryTab?.sql || ''
  const filteredTables = useMemo(() => filterDayTables(tables,dayRange).filter(t => t.toLowerCase().includes(filter.toLowerCase())), [tables, filter, dayRange])
  const tableGroups = useMemo(() => filteredTables.reduce<Record<string, string[]>>((all, table) => { const prefix = splitTable(table).prefix; (all[prefix] ||= []).push(table); return all }, {}), [filteredTables])

  function toast(text: string) { setMessage(text); window.setTimeout(() => setMessage(''), 1800) }
  function persistQueryTabs(next: QueryTab[]) { setQueryTabs(next); save('gdb.queryTabs',next) }
  function setSql(nextSql: string) { persistQueryTabs(queryTabs.map(tab => tab.id === activeQueryTab.id ? {...tab,sql:nextSql} : tab)) }
  function addQueryTab() { const id=crypto.randomUUID(),next=[...queryTabs,{id,name:`查询 ${queryTabs.length+1}`,sql:''}];persistQueryTabs(next);setActiveTabId(id);save('gdb.activeQueryTab',id) }
  function openQueryTab(command:string) { const id=crypto.randomUUID(),next=[...queryTabs,{id,name:'诊断修复',sql:command}];persistQueryTabs(next);setActiveTabId(id);save('gdb.activeQueryTab',id);setClaudeOpen(false) }
  function selectQueryTab(id: string) { setActiveTabId(id); save('gdb.activeQueryTab',id) }
  function closeQueryTab(id: string) { if(queryTabs.length===1){persistQueryTabs([{...queryTabs[0],sql:'',name:'查询 1'}]);return}const index=queryTabs.findIndex(tab=>tab.id===id),next=queryTabs.filter(tab=>tab.id!==id);persistQueryTabs(next);if(id===activeTabId)selectQueryTab(next[Math.max(0,index-1)].id) }
  function renameQueryTab(id: string) { const current=queryTabs.find(tab=>tab.id===id);if(!current)return;const name=window.prompt('查询页签名称',current.name)?.trim();if(name)persistQueryTabs(queryTabs.map(tab=>tab.id===id?{...tab,name}:tab)) }
  function persistConnections(next: Connection[]) { setConnections(next); next.forEach(connection => { if (connection.password) void saveCredential(connection.id,connection.password) }); save('gdb.connections', next.map(connection => ({ ...connection, password: '' }))) }
  function switchTool(tool: SideTool) { if (tool === sideTool && sideOpen) { setSideOpen(false); save('gdb.sideOpen', false); return } setSideTool(tool); setSideOpen(true); save('gdb.sideTool', tool); save('gdb.sideOpen', true) }
  function resizeSidebarBy(next:number){const width=fitSidebarWidth(next);setSidebarWidth(width);save('gdb.sidebarWidth',width)}
  function beginSidebarResize(event:React.PointerEvent<HTMLButtonElement>){event.preventDefault();const origin=event.clientX,start=sidebarWidth;setSidebarDragging(true);const move=(next:PointerEvent)=>setSidebarWidth(fitSidebarWidth(start+next.clientX-origin));const stop=(next:PointerEvent)=>{const width=fitSidebarWidth(start+next.clientX-origin);setSidebarWidth(width);save('gdb.sidebarWidth',width);setSidebarDragging(false);window.removeEventListener('pointermove',move);window.removeEventListener('pointerup',stop)};window.addEventListener('pointermove',move);window.addEventListener('pointerup',stop)}

  async function connect(connection = currentConnection) {
    if (!connection) return
    setStatus('正在登录…')
    try {
      const transport=connectionForTransport(connection)
      await bridge.login({ mode: transport.mode, endpoint: transport.endpoint, username: transport.username, password: transport.password || await loadCredential(transport.id) || '', insecureSkipVerify: transport.insecureSkipVerify, readOnly: transport.readOnly })
      const list = await bridge.databases()
      const nextDb = list.includes(database) ? database : list[0]
      const nextTables=await bridge.tables(nextDb),restoredTable=nextDb===database&&nextTables.includes(selectedTable)?selectedTable:''
      schemaRequest.current += 1; setSelectedTable(restoredTable); setSchema({ fields: [], tags: [] }); setSchemaLoading(false)
      setDatabases(list); setDatabase(nextDb); setTables(nextTables); setStatus(`${connection.name} 已连接`); toast(restoredTable?'已恢复上次查询工作区':'已登录并载入数据目录');if(restoredTable)void loadSchema(restoredTable)
    } catch (error) { setStatus('连接失败'); toast(error instanceof Error ? error.message : '连接失败') }
  }

  useEffect(() => {
    let active=true
    const refresh=()=>void getDesktopBridgeStatus().then(next=>{if(active)setBridgeStatus(next)}).catch(error=>{if(active)setBridgeStatus({running:false,error:error instanceof Error?error.message:'无法读取 Bridge 状态',logPath:null})})
    refresh()
    const timer=window.setInterval(refresh,2000)
    return()=>{active=false;window.clearInterval(timer)}
  },[])
  useEffect(() => {
    save('gdb.connections', connections.map(connection => ({ ...connection, password: '' })))
    void deleteCredential('mock')
    if (!currentConnection) {
      setActiveConnection('')
      save('gdb.activeConnection', '')
      return
    }
    if (activeConnection !== currentConnection.id) {
      setActiveConnection(currentConnection.id)
      save('gdb.activeConnection', currentConnection.id)
    }
    if (currentConnection.autoLogin) void connect(currentConnection)
  }, [])
  useEffect(()=>{const close=()=>endSession();window.addEventListener('beforeunload',close);return()=>window.removeEventListener('beforeunload',close)},[])
  useEffect(()=>{const timer=window.setTimeout(()=>{try{writeWorkspace({database,measurement:selectedTable,dayRange,resultView:view,activeConnection,activeTabId,queryTabs,sideTool,sideOpen})}catch{toast('工作区保存失败，请检查可用空间')}save('gdb.workspace.database',database);save('gdb.workspace.measurement',selectedTable);save('gdb.workspace.dayRange',dayRange);save('gdb.workspace.resultView',view)},500);return()=>window.clearTimeout(timer)},[database,selectedTable,dayRange,view,activeConnection,activeTabId,queryTabs,sideTool,sideOpen])
  function restoreWorkspace(){const snapshot=readWorkspace();if(snapshot){setDatabase(snapshot.database);setSelectedTable(snapshot.measurement);setDayRange(snapshot.dayRange);setView(snapshot.resultView);setActiveConnection(snapshot.activeConnection);setActiveTabId(snapshot.activeTabId);setQueryTabs(snapshot.queryTabs);setSideTool(snapshot.sideTool);setSideOpen(snapshot.sideOpen)}setRecoveryOpen(false);toast('已恢复上次工作区')}
  function discardWorkspace(){clearWorkspace();persistQueryTabs([DEFAULT_TAB]);setActiveTabId(DEFAULT_TAB.id);save('gdb.activeQueryTab',DEFAULT_TAB.id);setSelectedTable('');setView('result');setRecoveryOpen(false);toast('已创建新工作区')}

  async function changeDatabase(next: string) {
    if (!next || next === database) return
    const started = performance.now()
    try {
      await bridge.query(database, `USE \`${next}\``)
      schemaRequest.current += 1; setSchemaLoading(false); setDatabase(next); setSelectedTable(''); setSchema({fields:[],tags:[]}); setTables(await bridge.tables(next)); addHistory(`USE \`${next}\``, performance.now() - started, 'success', 'database 已切换', next); toast(`已执行 USE ${next}`)
    } catch (error) { addHistory(`USE \`${next}\``, performance.now() - started, 'error', error instanceof Error ? error.message : '切换失败', database) }
  }

  function chooseDatabaseNode(next: string) {
    if (next === database) {
      setDatabaseOpen(value => !value)
      return
    }
    setDatabaseOpen(true)
    setMeasurementsOpen(true)
    void changeDatabase(next)
  }

  async function chooseTable(table: string) {
    setSelectedTable(table)
    persistQueryTabs(queryTabs.map(tab => tab.id === activeQueryTab.id ? {...tab,name:table.replace(/_\d{10}$/,'').slice(0,28),sql:`SELECT *\nFROM "${table}"\nWHERE time >= now() - 1h\nORDER BY time DESC\nLIMIT 100`} : tab))
    await loadSchema(table)
  }

  async function loadSchema(table: string, force = false) {
    const key = `${currentConnection?.id || activeConnection}\u0000${database}\u0000${table}`
    const requestId = ++schemaRequest.current
    const cached = schemaCache.current.get(key)
    if (cached && !force) { setSchema(cached); setSchemaLoading(false); return }
    setSchema({ fields: [], tags: [] }); setSchemaLoading(true)
    try {
      const nextSchema = await bridge.schema(database, table)
      schemaCache.current.set(key, nextSchema)
      if (requestId === schemaRequest.current) { setSchema(nextSchema); toast(`已载入 ${nextSchema.fields.length} 个字段、${nextSchema.tags.length} 个 Tag`) }
    } catch (error) {
      if (requestId === schemaRequest.current) toast(error instanceof Error ? `字段加载失败：${error.message}` : '字段加载失败')
    } finally { if (requestId === schemaRequest.current) setSchemaLoading(false) }
  }

  function toggleGroup(prefix: string) { setCollapsedGroups(current => { const next=new Set(current);if(next.has(prefix))next.delete(prefix);else next.add(prefix);return next }) }
  function queryGroup(prefix: string, group: string[]) { const command=multiTableQuery(group);if(!command)return toast('当前日期范围没有天表');setSql(command);toast(`已生成 ${prefix} 的 ${group.length} 张天表查询`) }

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
      setLastError('')
      if (data.rows) { setRows(data.rows); setResultMeta(`${data.rows.length} rows · ${Math.round(duration)} ms`); addHistory(command, duration, 'success', `${data.rows.length} 行`) }
      else { setRows([]); setResultMeta(`${data.affectedRows || 0} affected · ${Math.round(duration)} ms`); addHistory(command, duration, 'success', `影响 ${data.affectedRows || 0} 行`) }
      setResultStatus('SUCCESS'); toast(data.rows ? '查询完成' : '写入完成')
    } catch (error) {
      const cancelled = error instanceof DOMException && error.name === 'AbortError'
      const text = cancelled ? (cancelReason.current === 'timeout' ? '查询超过 30 秒，已取消' : '查询已取消') : error instanceof Error ? error.message : '执行失败'
      setRows([]); setLastError(text); setResultStatus(cancelled ? 'CANCELLED' : 'ERROR'); setResultMeta(`${Math.round(performance.now() - started)} ms`); addHistory(command, performance.now() - started, cancelled ? 'cancelled' : 'error', text); toast(text)
    } finally { window.clearTimeout(timeout); queryAbort.current = null; cancelReason.current = null; setRunning(false) }
  }
  function cancelQuery() { cancelReason.current = 'user'; queryAbort.current?.abort() }
  async function retryBridge(){setBridgeRetrying(true);try{const next=await restartDesktopBridge();setBridgeStatus(next);if(next.running){toast('Bridge 已重新启动');void connect()}else toast(next.error||'Bridge 重启失败')}catch(error){toast(error instanceof Error?error.message:'Bridge 重启失败')}finally{setBridgeRetrying(false)}}

  function saveFavorite() { const name = window.prompt('收藏名称', `常用命令 · ${database}`); if (!name) return; const next = [{ id: crypto.randomUUID(), name, sql, database }, ...favorites]; setFavorites(next); save('gdb.favorites', next); toast('已加入收藏') }
  async function askClaude() { diagnosticAbort.current?.abort();const requestId=++diagnosticRequest.current,controller=new AbortController();diagnosticAbort.current=controller;setClaudeOpen(true);setClaudeAnswer(null);const localIssues=inspectInfluxQL(sql,schema),apiKey=claudeSettings.provider==='api'?await loadCredential('claude-api'):'';if(claudeSettings.provider==='api'&&!apiKey){setClaudeSettingsOpen(true);diagnosticAbort.current=null;return}setClaudeLoading(true);try{const provider=createDiagnosticProvider(claudeSettings,apiKey||''),result=await provider.diagnose({database,measurement:selectedTable,sql,error:lastError,schema,localIssues},controller.signal);if(requestId===diagnosticRequest.current)setClaudeAnswer(result)}catch(error){if(controller.signal.aborted){if(requestId===diagnosticRequest.current)toast('已取消查询诊断');return}if(requestId===diagnosticRequest.current)setClaudeAnswer({summary:error instanceof Error?error.message:'诊断服务不可用',problems:localIssues,fixedSql:localFix(sql),performanceAdvice:[],risk:/\b(write|drop|delete|alter|into)\b/i.test(sql)?'danger':'read'})}finally{if(requestId===diagnosticRequest.current){setClaudeLoading(false);diagnosticAbort.current=null}} }
  function cancelDiagnosis(){diagnosticAbort.current?.abort();diagnosticAbort.current=null;setClaudeLoading(false)}
  function exportCsv() { if (!rows.length) return toast('没有可导出的结果'); download(`geminidb-${Date.now()}.csv`, 'text/csv;charset=utf-8', csvContent(rows)); toast('CSV 已开始下载') }
  function exportExcel() { if (!rows.length) return toast('没有可导出的结果'); download(`geminidb-${Date.now()}.xls`, 'application/vnd.ms-excel;charset=utf-8', excelContent(rows)); toast('Excel 已开始下载') }
  function exportJson() { if (!rows.length) return toast('没有可导出的结果'); download(`geminidb-${Date.now()}.json`, 'application/json;charset=utf-8', jsonContent(rows)); toast('JSON 已开始下载') }
  async function copyResults() { if (!rows.length) return toast('没有可复制的结果'); try { await navigator.clipboard.writeText(jsonContent(rows)); toast('结果已复制') } catch { toast('复制失败，请检查剪贴板权限') } }

  return <div className={`app ${sideOpen ? '' : 'sidebar-closed'}`} style={{'--sidebar-width':`${sidebarWidth}px`} as React.CSSProperties}>
    {bridgeStatus&&!bridgeStatus.running&&<div className="bridge-alert" role="alert"><span><b>GeminiDB Bridge 启动失败</b><small>{bridgeStatus.error||'后台服务不可用，客户端仍可打开。'}{bridgeStatus.logPath&&<> · 日志：{bridgeStatus.logPath}</>}</small></span><button disabled={bridgeRetrying} onClick={()=>void retryBridge()}>{bridgeRetrying?'正在重试…':'重试 Bridge'}</button></div>}
    <header><div className="brand"><span className="brand-mark"/><b>GeminiDB Studio</b></div><div className="topbar">
      <select value={database} onChange={e => void changeDatabase(e.target.value)} disabled={!databases.length}>{databases.map(db => <option key={db}>{db}</option>)}</select>
      <button className="icon-button" onClick={() => setTimeDialog(true)} title="时间戳转换">◷</button><button className={`connection-state connection-control env-${currentConnection?.environment||'dev'} ${status.includes('失败') ? 'error' : ''}`} onClick={() => currentConnection && setConnectionDialog(currentConnection)} title="编辑当前连接"><i/>{status}<UiIcon name="settings"/></button>
    </div></header>

    <aside className="left-sidebar"><nav className="tool-rail" aria-label="工具窗口"><button className={sideOpen && sideTool === 'connections' ? 'active' : ''} onClick={() => switchTool('connections')} title="连接"><UiIcon name="connection"/></button><button className={sideOpen && sideTool === 'catalog' ? 'active' : ''} onClick={() => switchTool('catalog')} title="数据目录"><UiIcon name="catalog"/></button></nav>
      <div className="side-content">{sideTool === 'connections' ? <section className="side-panel"><PanelTitle title="连接" count={connections.length}/><div className="panel-scroll connection-list">{!connections.length&&<Empty text="尚未添加连接" sub="新建 GeminiDB Influx 连接后开始查询"/>}{connections.map(connection => <div key={connection.id} className={`connection-item ${connection.id === activeConnection ? 'active' : ''}`}><button className="connection-row" onClick={() => { setActiveConnection(connection.id); save('gdb.activeConnection', connection.id); void connect(connection) }}><span className="connection-glyph"><UiIcon name="connection"/></span><span><b>{connection.name}</b><small>{connection.endpoint}</small></span></button><button className="connection-more" onClick={() => setConnectionDialog(connection)} aria-label={`编辑 ${connection.name}`} title="编辑连接">•••</button></div>)}</div><div className="connection-footer"><button className="add-row" onClick={() => setConnectionDialog({...NEW_INFLUX_CONNECTION})}><span>＋</span> 新建连接</button></div></section> :
      <section className="side-panel"><PanelTitle title="数据目录" count={databases.length}/><div className="catalog-tools"><small>{database}<span>·</span>{filteredTables.length} 张天表</small><select value={dayRange} onChange={event=>setDayRange(event.target.value as DayRange)} title="按日期筛选"><option value="all">全部</option><option value="today">今天</option><option value="yesterday">昨天</option><option value="7d">近7天</option></select><button onClick={() => void connect()} title="刷新数据目录">↻</button></div><div className="search"><span><UiIcon name="search"/></span><input value={filter} onChange={e => setFilter(e.target.value)} placeholder="筛选 Measurement 或表名"/></div><div className="tree">{databases.map(db=>{const active=db===database;const open=active&&databaseOpen;return <div key={db} className="database-node"><button className={`tree-row tree-toggle database-row ${active?'selected':''}`} aria-expanded={open} onClick={()=>chooseDatabaseNode(db)} title={db}><UiIcon name="chevron" open={open}/><UiIcon name="database"/><b>{db}</b><em>{active?'当前':'Database'}</em></button>{open&&<><button className="tree-row level-1 tree-toggle" aria-expanded={measurementsOpen} onClick={()=>setMeasurementsOpen(value=>!value)}><UiIcon name="chevron" open={measurementsOpen}/><UiIcon name="layers"/><b>Measurements</b><em>{filteredTables.length}</em></button>{measurementsOpen&&Object.entries(tableGroups).map(([prefix, group]) => {const groupOpen=!collapsedGroups.has(prefix);return <div key={prefix}><button className="tree-row level-2 tree-toggle" aria-expanded={groupOpen} onClick={()=>toggleGroup(prefix)} onDoubleClick={()=>queryGroup(prefix,group)} title={`${prefix} · 双击生成当前日期范围的多天表查询`}><UiIcon name="chevron" open={groupOpen}/><UiIcon name="table"/><b>{prefix}</b><em>{group.length}</em></button>{groupOpen&&group.toSorted().reverse().map(table => { const parsed = splitTable(table); return <button key={table} title={table} onClick={() => void chooseTable(table)} className={`tree-row table-row level-3 ${table === selectedTable ? 'selected' : ''}`}><span className="tree-guide"/><span><b>{day(parsed.timestamp)}</b><small>{table}</small></span></button> })}</div>})}</>}</div>})}</div></section>}</div>
    </aside>
    <button className={`sidebar-resizer ${sidebarDragging?'dragging':''}`} type="button" role="separator" aria-label="调整数据目录宽度" aria-orientation="vertical" aria-valuemin={MIN_SIDEBAR_WIDTH} aria-valuemax={MAX_SIDEBAR_WIDTH} aria-valuenow={sidebarWidth} onPointerDown={beginSidebarResize} onDoubleClick={()=>resizeSidebarBy(DEFAULT_SIDEBAR_WIDTH)} onKeyDown={event=>{if(event.key==='ArrowLeft'){event.preventDefault();resizeSidebarBy(sidebarWidth-16)}if(event.key==='ArrowRight'){event.preventDefault();resizeSidebarBy(sidebarWidth+16)}if(event.key==='Home'){event.preventDefault();resizeSidebarBy(MIN_SIDEBAR_WIDTH)}if(event.key==='End'){event.preventDefault();resizeSidebarBy(MAX_SIDEBAR_WIDTH)}}} title="拖动调整宽度，双击恢复默认"/>

    <main><section className="editor"><div className="editor-head"><div><h1>查询窗口</h1><span className="context">{database} / {selectedTable || '未选表'}</span>{selectedTable&&<button className="schema-refresh" disabled={schemaLoading} onClick={()=>void loadSchema(selectedTable,true)} title="刷新当前 Measurement 的 Field 和 Tag">{schemaLoading?'… Schema':'↻ Schema'}</button>}</div><div className="actions"><button className="claude wide-query-action" onClick={() => void askClaude()}>✦ 诊断查询</button><button className="wide-query-action" onClick={saveFavorite}>☆ 收藏语句</button><details className="action-menu query-more"><summary>更多 ⋯</summary><div><button onClick={() => void askClaude()}>✦ 诊断查询</button><button onClick={saveFavorite}>☆ 收藏语句</button></div></details><button className={running ? 'danger' : 'primary'} onClick={running ? cancelQuery : () => void runQuery()}>{running ? '■ 取消查询' : '▶ 执行命令'}</button></div></div><div className="query-tabs" role="tablist">{queryTabs.map(tab=><div key={tab.id} role="tab" tabIndex={0} aria-selected={tab.id===activeQueryTab.id} className={`query-tab ${tab.id===activeQueryTab.id?'active':''}`} onClick={()=>selectQueryTab(tab.id)} onKeyDown={event=>{if(event.key==='Enter'||event.key===' ')selectQueryTab(tab.id)}} onDoubleClick={()=>renameQueryTab(tab.id)} title="双击重命名"><span>{tab.name}</span><button className="close-tab" onClick={event=>{event.stopPropagation();closeQueryTab(tab.id)}} aria-label={`关闭 ${tab.name}`}>×</button></div>)}<button className="add-query-tab" onClick={addQueryTab} title="新建查询">＋</button></div><Suspense fallback={<div className="editor-loading">正在加载 InfluxQL 编辑器…</div>}><QueryEditor tabId={activeQueryTab.id} value={sql} measurements={tables} schema={schema} onChange={setSql} onRun={command=>void runQuery(command)}/></Suspense></section>
      <section className="results"><div className="result-tabs"><div>{(['result','chart','history','messages','favorites'] as ResultView[]).map(item => <button key={item} className={view === item ? 'active' : ''} onClick={() => setView(item)}>{({result:'执行结果',chart:'图表',history:`执行记录 ${history.length}`,messages:'交互消息',favorites:`收藏 ${favorites.length}`})[item]}</button>)}</div>{view === 'result' && <div className="result-actions"><button onClick={() => void copyResults()}>复制</button><button className="wide-export-action" onClick={exportCsv}>CSV</button><button className="wide-export-action" onClick={exportExcel}>Excel</button><button className="wide-export-action" onClick={exportJson}>JSON</button><details className="action-menu export-menu"><summary>导出 ▾</summary><div><button onClick={exportCsv}>导出 CSV</button><button onClick={exportExcel}>导出 Excel</button><button onClick={exportJson}>导出 JSON</button></div></details></div>}</div><div className="result-body"><ResultContent view={view} rows={rows} history={history} favorites={favorites} onUseSql={value => { setSql(value); setView('result') }} onRemoveFavorite={id => { const next = favorites.filter(f => f.id !== id); setFavorites(next); save('gdb.favorites', next) }}/></div><div className="statusbar"><b className={resultStatus === 'ERROR' ? 'danger' : ''}>{resultStatus}</b><span>{resultMeta}</span></div></section>
    </main>

    {connectionDialog && <ConnectionDialog connection={connectionDialog} onClose={() => setConnectionDialog(null)} onSave={connection => { const next = connections.some(c => c.id === connection.id) ? connections.map(c => c.id === connection.id ? connection : c) : [connection, ...connections]; persistConnections(next); setActiveConnection(connection.id); save('gdb.activeConnection', connection.id); setConnectionDialog(null); void connect(connection) }} onDuplicate={connection=>{const copy={...connection,id:crypto.randomUUID(),name:`${connection.name} 副本`};persistConnections([copy,...connections]);setConnectionDialog(copy)}} onDelete={connection=>{if(!window.confirm(`删除连接“${connection.name}”？`))return;const next=connections.filter(item=>item.id!==connection.id);persistConnections(next);void deleteCredential(connection.id);setConnectionDialog(null);if(activeConnection===connection.id){const nextId=next[0]?.id||'';setActiveConnection(nextId);save('gdb.activeConnection',nextId);if(next[0])void connect(next[0])}}}/>} 
    {recoveryOpen&&<div className="modal"><div className="dialog recovery-dialog"><h2>恢复查询工作区</h2><p>检测到上次未正常关闭。可以恢复查询页签和目录位置；不会自动执行 SQL。</p><div className="dialog-actions"><button onClick={discardWorkspace}>重新开始</button><button className="primary" onClick={restoreWorkspace}>恢复工作区</button></div></div></div>}
    {timeDialog && <TimeDialog onClose={() => setTimeDialog(false)}/>} 
    {claudeSettingsOpen&&<ClaudeSettingsDialog settings={claudeSettings} onClose={()=>setClaudeSettingsOpen(false)} onSave={(settings,key)=>{setClaudeSettings(settings);save('gdb.claude.settings',settings);if(key)void saveCredential('claude-api',key);setClaudeSettingsOpen(false);toast('诊断设置已保存')}}/>}
    <aside className={`claude-drawer ${claudeOpen ? 'open' : ''}`}><div className="drawer-head"><b>✦ 查询诊断</b><span>{claudeLoading&&<button className="danger" onClick={cancelDiagnosis}>取消</button>}<button onClick={()=>setClaudeSettingsOpen(true)} title="诊断设置">设置</button><button onClick={() => {cancelDiagnosis();setClaudeOpen(false)}}>×</button></span></div><div className="drawer-body">{claudeLoading?<div className="center">正在检查语法、Schema 与性能…</div>:claudeAnswer?<DiagnosisPanel result={claudeAnswer} originalSql={sql} onOpen={openQueryTab} onReplace={fixed=>setSql(fixed)}/>:<div className="center"><div><b>诊断当前 InfluxQL</b><small>仅发送 SQL、错误和 Field/Tag Schema</small></div></div>}</div><footer>{claudeSettings.provider==='cli'?'本地 Claude CLI':'Anthropic API'} · {database}</footer></aside>
    {message && <div className="toast">{message}</div>}
  </div>
}

type UiIconName = 'catalog' | 'chevron' | 'connection' | 'database' | 'layers' | 'search' | 'settings' | 'table'
function UiIcon({ name, open = false }: { name: UiIconName; open?: boolean }) {
  const paths: Record<Exclude<UiIconName, 'chevron'>, React.ReactNode> = {
    catalog:<><rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/></>,
    connection:<><path d="M8 12h8M7 8v8M17 8v8"/><path d="M4 9V5a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v4M4 15v4a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-4"/></>,
    database:<><ellipse cx="12" cy="5" rx="8" ry="3"/><path d="M4 5v7c0 1.7 3.6 3 8 3s8-1.3 8-3V5M4 12v7c0 1.7 3.6 3 8 3s8-1.3 8-3v-7"/></>,
    layers:<><path d="m12 3 9 5-9 5-9-5 9-5Z"/><path d="m3 12 9 5 9-5M3 16l9 5 9-5"/></>,
    search:<><circle cx="11" cy="11" r="7"/><path d="m20 20-4-4"/></>,
    settings:<><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1-2.8 2.8-.1-.1a1.7 1.7 0 0 0-1.9-.3 1.7 1.7 0 0 0-1 1.6v.2h-4V21a1.7 1.7 0 0 0-1-1.6 1.7 1.7 0 0 0-1.9.3l-.1.1L4.2 17l.1-.1a1.7 1.7 0 0 0 .3-1.9A1.7 1.7 0 0 0 3 14H2.8v-4H3a1.7 1.7 0 0 0 1.6-1 1.7 1.7 0 0 0-.3-1.9L4.2 7 7 4.2l.1.1a1.7 1.7 0 0 0 1.9.3A1.7 1.7 0 0 0 10 3V2.8h4V3a1.7 1.7 0 0 0 1 1.6 1.7 1.7 0 0 0 1.9-.3l.1-.1L19.8 7l-.1.1a1.7 1.7 0 0 0-.3 1.9 1.7 1.7 0 0 0 1.6 1h.2v4H21a1.7 1.7 0 0 0-1.6 1Z"/></>,
    table:<><rect x="3" y="4" width="18" height="16" rx="1"/><path d="M3 9h18M8 9v11"/></>
  }
  return <svg className={`ui-icon ${name === 'chevron' && open ? 'open' : ''}`} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{name === 'chevron' ? <path d="m9 18 6-6-6-6"/> : paths[name]}</svg>
}

function PanelTitle({ title, count }: { title: string; count: number }) { return <div className="panel-title"><b>{title}</b><small>{count}</small></div> }

function ResultContent({ view, rows, history, favorites, onUseSql, onRemoveFavorite }: { view: ResultView; rows: QueryRow[]; history: Execution[]; favorites: Favorite[]; onUseSql: (sql: string) => void; onRemoveFavorite: (id: string) => void }) {
  if(view==='chart')return <div className="chart-placeholder"><div><span>⌁</span><b>图表可视化</b><p>后续将根据 time、数值 Field 和 Tag 自动生成时序图。</p><small>当前版本保留入口，不影响查询与结果导出。</small></div></div>
  if (view === 'history') return history.length ? <table><thead><tr><th>执行时间</th><th>命令语句</th><th>耗时</th><th>执行结果</th></tr></thead><tbody>{history.map(item => <tr key={item.id} onClick={() => onUseSql(item.sql)}><td>{formatTime(item.executedAt)}</td><td>{item.sql.replace(/\s+/g, ' ')}</td><td>{item.durationMs} ms</td><td className={item.status === 'success' ? 'success' : 'danger'}>{item.status === 'success' ? '成功' : item.status === 'cancelled' ? '已取消' : '失败'} · {item.result}</td></tr>)}</tbody></table> : <Empty text="还没有执行记录"/>
  if (view === 'messages') return history.length ? <div className="messages">{history.map(item => <pre key={item.id}>{`--------开始执行--------\n【执行命令】\n${item.sql}\n执行命令${item.status === 'success' ? '成功' : item.status === 'cancelled' ? '已取消' : '失败'}，耗时：[${item.durationMs}ms]！`}</pre>)}</div> : <Empty text="还没有交互消息"/>
  if (view === 'favorites') return favorites.length ? <div className="favorite-list">{favorites.map(item => <div className="favorite" key={item.id} onClick={() => onUseSql(item.sql)}><span><b>★ {item.name}</b><code>{item.sql.replace(/\s+/g, ' ')}</code></span><button onClick={e => { e.stopPropagation(); onRemoveFavorite(item.id) }}>×</button></div>)}</div> : <Empty text="还没有收藏语句"/>
  if (!rows.length) return <Empty text="执行命令后在这里查看结果" sub="查询返回数据表，写入返回影响行数"/>
  return <ResultsTable rows={rows}/>
}
function Empty({ text, sub }: { text: string; sub?: string }) { return <div className="center"><div><b>{text}</b>{sub && <small>{sub}</small>}</div></div> }

function DiagnosisPanel({result,originalSql,onOpen,onReplace}:{result:ClaudeDiagnosis;originalSql:string;onOpen:(sql:string)=>void;onReplace:(sql:string)=>void}){
  const changed=result.fixedSql.trim()&&result.fixedSql.trim()!==originalSql.trim(),danger=result.risk!=='read'
  return <div className="diagnosis"><div className="diagnosis-summary"><small>{danger?'需要人工确认':'诊断完成'}</small><b>{result.summary}</b></div>{result.problems.length>0&&<section><h3>发现的问题</h3>{result.problems.map((issue,index)=><p key={index} className={`issue ${issue.level}`}><i/>{issue.message}</p>)}</section>}{changed&&<section><h3>SQL 差异</h3><pre className="sql-diff">{lineDiff(originalSql,result.fixedSql)}</pre><div className="diagnosis-actions"><button onClick={()=>navigator.clipboard.writeText(result.fixedSql)}>复制</button><button onClick={()=>onOpen(result.fixedSql)}>新页签打开</button><button className="primary" onClick={()=>onReplace(result.fixedSql)}>替换当前 SQL</button></div></section>}{result.performanceAdvice.length>0&&<section><h3>性能建议</h3><ul>{result.performanceAdvice.map((item,index)=><li key={index}>{item}</li>)}</ul></section>}{result.usage&&(result.usage.inputTokens||result.usage.outputTokens)&&<small className="usage">输入 {result.usage.inputTokens||0} · 输出 {result.usage.outputTokens||0} tokens</small>}{danger&&<p className="risk-note">诊断结果包含写入或高风险操作，只允许预览和替换，不会自动执行。</p>}</div>
}

function ClaudeSettingsDialog({settings,onClose,onSave}:{settings:ClaudeSettings;onClose:()=>void;onSave:(settings:ClaudeSettings,key:string)=>void}){
  const [draft,setDraft]=useState(settings),[key,setKey]=useState(''),[testing,setTesting]=useState(false),[testResult,setTestResult]=useState('')
  async function test(){setTesting(true);setTestResult('');try{const provider=createDiagnosticProvider(draft,key),result=await provider.probe();setTestResult(`${result.message}${result.version?` · ${result.version}`:''}`)}catch(error){setTestResult(error instanceof Error?error.message:'检测失败')}finally{setTesting(false)}}
  return <div className="modal"><div className="dialog"><h2>查询诊断设置</h2><p>诊断是 GeminiDB 查询的辅助功能，不会自动执行建议 SQL。</p><div className="provider-choice"><button className={draft.provider==='cli'?'active':''} onClick={()=>setDraft({...draft,provider:'cli'})}><b>本地 CLI</b><small>使用本机 Claude Code</small></button><button className={draft.provider==='api'?'active':''} onClick={()=>setDraft({...draft,provider:'api'})}><b>Anthropic API</b><small>使用独立 API Key</small></button></div>{draft.provider==='cli'?<label>Claude 命令路径<input value={draft.cliPath} onChange={event=>setDraft({...draft,cliPath:event.target.value})} placeholder="claude"/></label>:<><label>API 地址<input value={draft.endpoint} onChange={event=>setDraft({...draft,endpoint:event.target.value})}/></label><label>API Key<input type="password" value={key} onChange={event=>setKey(event.target.value)} placeholder="留空表示保留已保存的 Key"/></label><div className="form-row"><label>模型<input value={draft.model} onChange={event=>setDraft({...draft,model:event.target.value})}/></label><label>最大输出<select value={draft.maxTokens} onChange={event=>setDraft({...draft,maxTokens:Number(event.target.value)})}><option>1024</option><option>2048</option><option>4096</option></select></label></div></>}{testResult&&<p className="setting-result">{testResult}</p>}<div className="privacy-note">发送内容仅限当前 SQL、错误信息和 Field/Tag Schema；不发送密码和查询结果。</div><div className="dialog-actions"><button disabled={testing} onClick={()=>void test()}>{testing?'检测中…':'测试'}</button><span><button onClick={onClose}>取消</button><button className="primary" onClick={()=>onSave(draft,key)}>保存</button></span></div></div></div>
}

function ConnectionDialog({ connection, onClose, onSave, onDuplicate, onDelete }: { connection: Connection; onClose: () => void; onSave: (connection: Connection) => void; onDuplicate:(connection:Connection)=>void; onDelete:(connection:Connection)=>void }) {
  const [draft, setDraft] = useState(connection)
  const [testing, setTesting] = useState(false)
  const [testResult, setTestResult] = useState('')
  const testConnection = async () => {
    setTesting(true); setTestResult('')
    try {
      const savedPassword = draft.id ? await loadCredential(draft.id) : null
      await bridge.login({...connectionForTransport(draft), password:draft.password || savedPassword || ''})
      const list = await bridge.databases()
      setTestResult(`连接成功 · 发现 ${list.length} 个 Database`)
    } catch (error) { setTestResult(error instanceof Error ? `连接失败：${error.message}` : '连接失败') }
    finally { setTesting(false) }
  }
  const protocol=endpointProtocol(draft.endpoint)
  return <div className="modal"><div className="dialog"><h2>GeminiDB Influx 连接</h2><p>密码在桌面端保存到系统凭据库；开发模式仅保留到当前会话。</p><div className="form-row"><label>连接名称<input value={draft.name} onChange={e => setDraft({...draft, name:e.target.value})}/></label><label>环境<select value={draft.environment||'dev'} onChange={e=>setDraft({...draft,environment:e.target.value as Connection['environment']})}><option value="prod">生产</option><option value="test">测试</option><option value="dev">开发</option></select></label></div><div className="form-row"><label>连接协议<select value={protocol} onChange={e=>setDraft({...draft,endpoint:withEndpointProtocol(draft.endpoint,e.target.value as 'http'|'https'),insecureSkipVerify:e.target.value==='https'&&draft.insecureSkipVerify})}><option value="http">HTTP</option><option value="https">HTTPS（TLS）</option></select></label><label>实例地址<input value={draft.endpoint} onChange={e => setDraft({...draft, endpoint:e.target.value})} placeholder="http://192.0.2.10:8635"/></label></div><div className="form-row"><label>用户名<input value={draft.username} onChange={e => setDraft({...draft, username:e.target.value})} placeholder="请输入实例用户名"/></label><label>密码<input type="password" value={draft.password || ''} onChange={e => setDraft({...draft, password:e.target.value})}/></label></div><label className="checkbox"><input type="checkbox" checked={draft.autoLogin} onChange={e => setDraft({...draft, autoLogin:e.target.checked})}/> 打开页面时自动登录</label><label className="checkbox"><input type="checkbox" checked={draft.readOnly} onChange={e => setDraft({...draft, readOnly:e.target.checked})}/> 只读连接（禁止 WRITE）</label>{protocol === 'https' && <label className="checkbox"><input type="checkbox" checked={draft.insecureSkipVerify} onChange={e => setDraft({...draft, insecureSkipVerify:e.target.checked})}/> 忽略 TLS 证书校验（仅限自签名证书）</label>}{testResult&&<p className={testResult.startsWith('连接成功')?'success':'danger'}>{testResult}</p>}<div className="dialog-actions"><span>{draft.id&&<><button onClick={()=>onDuplicate(draft)}>复制</button><button className="danger" onClick={()=>onDelete(draft)}>删除</button></>}</span><span><button disabled={testing} onClick={()=>void testConnection()}>{testing?'正在测试…':'测试连接'}</button><button onClick={onClose}>取消</button><button className="primary" onClick={() => onSave({...connectionForTransport(draft), id:draft.id || crypto.randomUUID()})}>保存并连接</button></span></div></div></div>
}

function TimeDialog({ onClose }: { onClose: () => void }) {
  const now = useRef(new Date()).current
  const initialMilliseconds = Math.floor(now.getTime()/1000)*1000
  const [mode,setMode]=useState<'timestamp'|'datetime'>('timestamp')
  const [zone,setZone]=useState<DateTimeZone>('beijing')
  const [timestamp,setTimestamp]=useState(String(initialMilliseconds/1000))
  const [dateTime,setDateTime]=useState(formatBeijing(now))
  const [result,setResult]=useState<TimeConversion|null>(()=>conversionFromMilliseconds(initialMilliseconds))
  const [error,setError]=useState('')
  const [copied,setCopied]=useState('')
  function convert(){
    const milliseconds=mode==='timestamp'?parseUnixTimestamp(timestamp):parseDateTime(dateTime,zone)
    const next=milliseconds===null?null:conversionFromMilliseconds(milliseconds)
    setResult(next)
    setError(next?'':mode==='timestamp'?'请输入有效的 10/13/16/19 位时间戳':'请输入有效日期：YYYY-MM-DD HH:mm:ss')
  }
  function switchMode(next:'timestamp'|'datetime'){
    setMode(next);setError('')
    if(next==='datetime')setDateTime(zone==='beijing'?formatBeijing(now):formatUtcInput(now))
  }
  function switchZone(next:DateTimeZone){
    setZone(next);setDateTime(next==='beijing'?formatBeijing(now):formatUtcInput(now));setError('')
  }
  async function copy(label:string,value:string){
    await navigator.clipboard.writeText(value);setCopied(label);window.setTimeout(()=>setCopied(current=>current===label?'':current),1200)
  }
  const rows=result?[['北京时间',result.beijing],['UTC / RFC3339',result.utc],['Unix 秒',result.unixSeconds],['Unix 毫秒',result.unixMilliseconds]]:[] as string[][]
  return <div className="modal"><div className="dialog time-dialog" role="dialog" aria-modal="true" aria-labelledby="time-dialog-title">
    <div className="time-dialog-head"><div><h2 id="time-dialog-title">时间转换</h2><p>北京时间 UTC+8 · UTC 零时区 · Unix 时间戳</p></div><button className="close-icon" onClick={onClose} aria-label="关闭">×</button></div>
    <div className="time-dialog-body">
      <div className="time-mode" role="tablist"><button className={mode==='timestamp'?'active':''} onClick={()=>switchMode('timestamp')}>时间戳转日期</button><button className={mode==='datetime'?'active':''} onClick={()=>switchMode('datetime')}>日期转时间戳</button></div>
      <label className="time-input-label">{mode==='timestamp'?'输入时间戳':'输入日期时间'}</label>
      <div className={`time-input-row ${mode==='timestamp'?'timestamp-mode':''}`}>
        {mode==='datetime'&&<select value={zone} onChange={event=>switchZone(event.target.value as DateTimeZone)} aria-label="输入时区"><option value="beijing">北京时间 UTC+8</option><option value="utc">UTC 零时区</option></select>}
        <input value={mode==='timestamp'?timestamp:dateTime} onChange={event=>mode==='timestamp'?setTimestamp(event.target.value):setDateTime(event.target.value)} onKeyDown={event=>{if(event.key==='Enter')convert()}} spellCheck={false}/>
        <button className="primary" onClick={convert}>转换</button>
      </div>
      <div className={`time-input-hint ${error?'error':''}`}>{error|| (mode==='timestamp'?'自动识别秒、毫秒、微秒和纳秒':'格式：YYYY-MM-DD HH:mm:ss；严格按所选时区解析')}</div>
      {result&&<><div className="time-results">{rows.map(([label,value],index)=><div className={`time-result-row ${index<2?'primary-result':''}`} key={label}><span className="label">{label}</span><code title={value}>{value}</code><button onClick={()=>void copy(label,value)}>{copied===label?'已复制':'复制'}</button></div>)}</div>
      <div className="influx-time"><span>InfluxQL 时间</span><code>{result.influxQL}</code><button onClick={()=>void copy('InfluxQL',result.influxQL)}>{copied==='InfluxQL'?'已复制':'复制'}</button></div></>}
      <p className="time-query-note">查询可使用 <code>now() - 1h</code>、RFC3339 时间或带精度单位的 Unix 时间戳；模板采用 UTC，是为了跨时区保持含义一致。</p>
    </div>
  </div></div>
}
