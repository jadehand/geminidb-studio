import { useEffect, useMemo, useRef, useState } from 'react'
import { uniqueColumnValues, type MeasurementGridColumn } from './measurement-grid'
import type { MeasurementPoint } from './measurement-data'

type Props={
  points:MeasurementPoint[]
  column:MeasurementGridColumn
  selected:string[]|undefined
  onChange:(values:string[]|undefined)=>void
  onClose:()=>void
}

export default function MeasurementColumnMenu({points,column,selected,onChange,onClose}:Props){
  const [search,setSearch]=useState('')
  const root=useRef<HTMLDivElement>(null)
  const values=useMemo(()=>uniqueColumnValues(points,column,search),[points,column,search])
  useEffect(()=>{
    const close=(event:MouseEvent)=>{if(root.current&&!root.current.contains(event.target as Node))onClose()}
    const key=(event:KeyboardEvent)=>{if(event.key==='Escape')onClose()}
    document.addEventListener('mousedown',close);document.addEventListener('keydown',key)
    return()=>{document.removeEventListener('mousedown',close);document.removeEventListener('keydown',key)}
  },[onClose])
  function toggle(value:string){
    const next=new Set(selected??[])
    if(next.has(value))next.delete(value);else next.add(value)
    onChange(next.size?[...next]:undefined)
  }
  return <div ref={root} className="measurement-column-menu" role="dialog" aria-label={`${column.key} 的本地筛选器`}>
    <input autoFocus value={search} onChange={event=>setSearch(event.target.value)} placeholder="搜索值" aria-label={`搜索 ${column.key} 的值`}/>
    <div className="measurement-column-menu-actions"><button type="button" onClick={()=>onChange(values.length?values:undefined)}>全选</button><button type="button" onClick={()=>onChange(undefined)}>清空</button></div>
    <div className="measurement-column-values">{values.length?values.map(value=><label key={value}><input type="checkbox" checked={selected?.includes(value)??false} onChange={()=>toggle(value)}/><span>{value}</span></label>):<small>当前页没有匹配值</small>}</div>
  </div>
}
