import type { MeasurementDataWorkspaceTab, WorkspaceTab } from './types'

export type MeasurementDataTabContext = Pick<MeasurementDataWorkspaceTab,'connectionId'|'database'|'measurement'>

function measurementDataTabId(context:MeasurementDataTabContext){return `measurement-data:${JSON.stringify([context.connectionId,context.database,context.measurement])}`}

export function openMeasurementDataTab(tabs:WorkspaceTab[],context:MeasurementDataTabContext){
  const existing=tabs.find(tab=>tab.kind==='measurement-data'&&tab.connectionId===context.connectionId&&tab.database===context.database&&tab.measurement===context.measurement)
  if(existing)return {tabs,activeId:existing.id}
  const tab:MeasurementDataWorkspaceTab={kind:'measurement-data',id:measurementDataTabId(context),name:`${context.measurement} · 数据`,...context}
  return {tabs:[...tabs,tab],activeId:tab.id}
}
