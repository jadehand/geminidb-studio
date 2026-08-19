import type { MeasurementPoint } from './measurement-data'

export type MeasurementGridColumn = { key:string; kind:'time'|'tag'|'field'; type?:string }
export type MeasurementGridSort = { key:string; direction:'asc'|'desc' } | null
export type MeasurementGridState = {
  filters:Partial<Record<string,string[]>>
  sort:MeasurementGridSort
  columns:MeasurementGridColumn[]
}

const EMPTY_VALUE='(空)'

export function columnValue(point:MeasurementPoint, column:MeasurementGridColumn): string|number|boolean|null {
  if(column.kind==='time') return point.time
  if(column.kind==='tag') return point.tags[column.key] ?? null
  return point.fields[column.key] ?? null
}

function displayValue(value: string|number|boolean|null) {
  return value === null || value === '' ? EMPTY_VALUE : String(value)
}

export function uniqueColumnValues(points:MeasurementPoint[], column:MeasurementGridColumn, search='') {
  const needle=search.trim().toLocaleLowerCase()
  return [...new Set(points.map(point => displayValue(columnValue(point,column))))]
    .sort((left,right) => left.localeCompare(right,'zh-CN',{numeric:true}))
    .filter(value => !needle || value.toLocaleLowerCase().includes(needle))
}

function compareValues(left:string|number|boolean|null,right:string|number|boolean|null) {
  if(left===null||left==='') return right===null||right==='' ? 0 : 1
  if(right===null||right==='') return -1
  if(typeof left==='number'&&typeof right==='number') return left-right
  if(typeof left==='boolean'&&typeof right==='boolean') return Number(left)-Number(right)
  if(typeof left==='string'&&typeof right==='string'&&/^\d+$/.test(left)&&/^\d+$/.test(right)) {
    const a=BigInt(left),b=BigInt(right)
    return a===b?0:a>b?1:-1
  }
  return String(left).localeCompare(String(right),'zh-CN',{numeric:true,sensitivity:'base'})
}

export function applyMeasurementGrid(points:MeasurementPoint[], state:MeasurementGridState) {
  const filtered=points.filter(point => state.columns.every(column => {
    const selected=state.filters[column.key]
    return !selected || selected.length===0 || selected.includes(displayValue(columnValue(point,column)))
  }))
  if(!state.sort) return filtered
  const column=state.columns.find(item => item.key===state.sort?.key)
  if(!column) return filtered
  const direction=state.sort.direction==='asc'?1:-1
  return filtered.map((point,index) => ({point,index})).sort((left,right) => compareValues(columnValue(left.point,column),columnValue(right.point,column))*direction || left.index-right.index).map(item => item.point)
}
