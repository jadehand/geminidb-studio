import type { MeasurementDataWorkspaceTab, QueryWorkspaceTab, WorkspaceTab } from './types'

export type MeasurementDataTabContext = Pick<MeasurementDataWorkspaceTab,'connectionId'|'database'|'measurement'>

function measurementDataTabId(context:MeasurementDataTabContext){return `measurement-data:${JSON.stringify([context.connectionId,context.database,context.measurement])}`}
export const DEFAULT_QUERY_WORKSPACE_TAB:QueryWorkspaceTab={kind:'query',id:'query-1',name:'查询 1',sql:'SHOW DATABASES'}

export function openMeasurementDataTab(tabs:WorkspaceTab[],context:MeasurementDataTabContext){
  const existing=tabs.find(tab=>tab.kind==='measurement-data'&&tab.connectionId===context.connectionId&&tab.database===context.database&&tab.measurement===context.measurement)
  if(existing)return {tabs,activeId:existing.id}
  const baseId=measurementDataTabId(context)
  let id=baseId,suffix=2
  while(tabs.some(tab=>tab.id===id))id=`${baseId}-${suffix++}`
  const tab:MeasurementDataWorkspaceTab={kind:'measurement-data',id,name:`${context.measurement} · 数据`,...context}
  return {tabs:[...tabs,tab],activeId:tab.id}
}

export function closeWorkspaceTab(tabs:WorkspaceTab[],activeTabId:string,id:string){
  const index=tabs.findIndex(tab=>tab.id===id)
  if(index<0)return {tabs,activeId:activeTabId}
  const current=tabs[index]
  if(tabs.length===1){
    if(current.kind==='query')return {tabs:[{...current,name:'查询 1',sql:''}],activeId:current.id}
    return {tabs:[DEFAULT_QUERY_WORKSPACE_TAB],activeId:DEFAULT_QUERY_WORKSPACE_TAB.id}
  }
  const next=tabs.filter(tab=>tab.id!==id)
  return {tabs:next,activeId:id===activeTabId?next[Math.max(0,index-1)].id:activeTabId}
}
