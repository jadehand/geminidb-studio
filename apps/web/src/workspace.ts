import type { WorkspaceTab } from './types'

export type WorkspaceSnapshot = {
  version: 1
  database: string
  measurement: string
  dayRange: 'all'|'today'|'yesterday'|'7d'
  resultView: 'result'|'chart'|'history'|'messages'|'favorites'
  activeConnection: string
  activeTabId: string
  tabs: WorkspaceTab[]
  sideTool: 'connections'|'catalog'|'knowledge'
  sideOpen: boolean
  savedAt: number
}

const SNAPSHOT='gdb.workspace.snapshot',RECENT='gdb.workspace.recent',SESSION='gdb.session.open'

function isRecord(value:unknown):value is Record<string,unknown>{return Boolean(value)&&typeof value==='object'}
function isString(value:unknown):value is string{return typeof value==='string'}
function isDayRange(value:unknown):value is WorkspaceSnapshot['dayRange']{return value==='all'||value==='today'||value==='yesterday'||value==='7d'}
function isResultView(value:unknown):value is WorkspaceSnapshot['resultView']{return value==='result'||value==='chart'||value==='history'||value==='messages'||value==='favorites'}
function isSideTool(value:unknown):value is WorkspaceSnapshot['sideTool']{return value==='connections'||value==='catalog'||value==='knowledge'}
export function migrateWorkspaceTabs(value:unknown):WorkspaceTab[]{
  if(!Array.isArray(value))return []
  return value.reduce<WorkspaceTab[]>((tabs,tab)=>{
    if(!isRecord(tab)||!isString(tab.id)||!isString(tab.name))return tabs
    if(tab.kind==='query'&&isString(tab.sql))tabs.push({kind:'query',id:tab.id,name:tab.name,sql:tab.sql})
    else if(tab.kind==='measurement-data'&&isString(tab.connectionId)&&isString(tab.database)&&isString(tab.measurement))tabs.push({kind:'measurement-data',id:tab.id,name:tab.name,connectionId:tab.connectionId,database:tab.database,measurement:tab.measurement})
    else if(tab.kind===undefined&&isString(tab.sql))tabs.push({kind:'query',id:tab.id,name:tab.name,sql:tab.sql})
    return tabs
  },[])
}
function migrateSnapshot(value:unknown):WorkspaceSnapshot|null{
  if(!isRecord(value)||value.version!==1||!isString(value.database)||!isString(value.measurement)||!isDayRange(value.dayRange)||!isResultView(value.resultView)||!isString(value.activeConnection)||!isString(value.activeTabId)||!isSideTool(value.sideTool)||typeof value.sideOpen!=='boolean'||typeof value.savedAt!=='number')return null
  const tabs=migrateWorkspaceTabs(Array.isArray(value.tabs)?value.tabs:value.queryTabs)
  if(!tabs.length)return null
  return {version:1,database:value.database,measurement:value.measurement,dayRange:value.dayRange,resultView:value.resultView,activeConnection:value.activeConnection,activeTabId:value.activeTabId,tabs,sideTool:value.sideTool,sideOpen:value.sideOpen,savedAt:value.savedAt}
}
export function readWorkspace():WorkspaceSnapshot|null{
  try{return migrateSnapshot(JSON.parse(localStorage.getItem(SNAPSHOT)||'null'))}catch{return null}
}
export function writeWorkspace(value:Omit<WorkspaceSnapshot,'version'|'savedAt'>){
  const snapshot:WorkspaceSnapshot={...value,tabs:migrateWorkspaceTabs(value.tabs),version:1,savedAt:Date.now()}
  localStorage.setItem(SNAPSHOT,JSON.stringify(snapshot))
  const recent=readRecent().filter(item=>item.activeTabId!==snapshot.activeTabId||JSON.stringify(item.tabs)!==JSON.stringify(snapshot.tabs))
  localStorage.setItem(RECENT,JSON.stringify([snapshot,...recent].slice(0,3)))
}
export function readRecent():WorkspaceSnapshot[]{try{const value=JSON.parse(localStorage.getItem(RECENT)||'[]');return Array.isArray(value)?value.flatMap(item=>{const snapshot=migrateSnapshot(item);return snapshot?[snapshot]:[]}):[]}catch{return[]}}
export function clearWorkspace(){localStorage.removeItem(SNAPSHOT);localStorage.removeItem(RECENT)}
export function beginSession(){const unclean=localStorage.getItem(SESSION)==='true';localStorage.setItem(SESSION,'true');return unclean&&Boolean(readWorkspace())}
export function endSession(){localStorage.setItem(SESSION,'false')}
