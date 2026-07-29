import type { MeasurementDataWorkspaceTab, QueryWorkspaceTab, WorkspaceTab } from './types'

export type PendingMeasurementAction = null | (() => void)
export type MeasurementTabDrafts = Record<string, Record<string, unknown>>

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

export function closeMeasurementTabAfterGuard(tabs: WorkspaceTab[], activeTabId: string, id: string) {
  return closeWorkspaceTab(tabs, activeTabId, id)
}

export function measurementTabDrafts(drafts: MeasurementTabDrafts, tabId: string) {
  return drafts[tabId] ?? {}
}

export function hasMeasurementTabDrafts(drafts: MeasurementTabDrafts, tabId: string) {
  return Object.values(measurementTabDrafts(drafts, tabId)).some(request => request !== null && typeof request === 'object' && Object.keys(request).length > 0)
}

export function replaceMeasurementTabDrafts(drafts: MeasurementTabDrafts, tabId: string, next: Record<string, unknown>): MeasurementTabDrafts {
  if (Object.keys(next).length === 0) {
    const { [tabId]: _removed, ...rest } = drafts
    return rest
  }
  return { ...drafts, [tabId]: next }
}

export function queueMeasurementAction(pending: PendingMeasurementAction, hasDrafts: boolean, continuation: () => void) {
  if (pending) return { pending, guarded: true, replaced: false }
  if (!hasDrafts) {
    continuation()
    return { pending: null as PendingMeasurementAction, guarded: false, replaced: false }
  }
  return { pending: continuation, guarded: true, replaced: false }
}

export async function submitMeasurementAction(pending: PendingMeasurementAction, submit: () => Promise<boolean>) {
  if (!pending || !await submit()) return pending
  pending()
  return null
}

export function discardMeasurementAction(pending: PendingMeasurementAction, discard: () => void) {
  discard()
  pending?.()
  return null
}

export function cancelMeasurementAction(_pending: PendingMeasurementAction) {
  return null
}
