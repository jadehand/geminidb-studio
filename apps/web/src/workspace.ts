export type WorkspaceSnapshot = {
  version: 1
  database: string
  measurement: string
  dayRange: 'all'|'today'|'yesterday'|'7d'
  resultView: 'result'|'chart'|'history'|'messages'|'favorites'
  activeConnection: string
  activeTabId: string
  queryTabs: { id:string; name:string; sql:string }[]
  sideTool: 'connections'|'catalog'
  sideOpen: boolean
  savedAt: number
}

const SNAPSHOT='gdb.workspace.snapshot',RECENT='gdb.workspace.recent',SESSION='gdb.session.open'

export function readWorkspace():WorkspaceSnapshot|null{
  try{const value=JSON.parse(localStorage.getItem(SNAPSHOT)||'null');return value?.version===1&&Array.isArray(value.queryTabs)&&value.queryTabs.length?value:null}catch{return null}
}
export function writeWorkspace(value:Omit<WorkspaceSnapshot,'version'|'savedAt'>){
  const snapshot:WorkspaceSnapshot={...value,version:1,savedAt:Date.now()}
  localStorage.setItem(SNAPSHOT,JSON.stringify(snapshot))
  const recent=readRecent().filter(item=>item.activeTabId!==snapshot.activeTabId||item.queryTabs.map(tab=>tab.sql).join('\0')!==snapshot.queryTabs.map(tab=>tab.sql).join('\0'))
  localStorage.setItem(RECENT,JSON.stringify([snapshot,...recent].slice(0,3)))
}
export function readRecent():WorkspaceSnapshot[]{try{const value=JSON.parse(localStorage.getItem(RECENT)||'[]');return Array.isArray(value)?value.filter(item=>item?.version===1):[]}catch{return[]}}
export function clearWorkspace(){localStorage.removeItem(SNAPSHOT);localStorage.removeItem(RECENT)}
export function beginSession(){const unclean=localStorage.getItem(SESSION)==='true';localStorage.setItem(SESSION,'true');return unclean&&Boolean(readWorkspace())}
export function endSession(){localStorage.setItem(SESSION,'false')}
