import { useEffect, useMemo, useRef, useState } from 'react'
import type { QueryRow } from './types'

export default function ResultColumnMenu({rows,column,selected,onChange,onClose}:{rows:QueryRow[];column:string;selected?:string[];onChange:(values:string[]|undefined)=>void;onClose:()=>void}){
  const [search,setSearch]=useState(''),root=useRef<HTMLDivElement>(null)
  const values=useMemo(()=>[...new Set(rows.map(row=>String(row[column]??'(空)')))].sort((a,b)=>a.localeCompare(b,undefined,{numeric:true})).filter(value=>value.toLowerCase().includes(search.trim().toLowerCase())),[rows,column,search])
  useEffect(()=>{const outside=(event:MouseEvent)=>{if(root.current&&!root.current.contains(event.target as Node))onClose()};const key=(event:KeyboardEvent)=>{if(event.key==='Escape')onClose()};document.addEventListener('mousedown',outside);document.addEventListener('keydown',key);return()=>{document.removeEventListener('mousedown',outside);document.removeEventListener('keydown',key)}},[onClose])
  return <div ref={root} className="result-column-menu" role="dialog" aria-label={`${column} 的本地筛选器`}><input autoFocus value={search} onChange={event=>setSearch(event.target.value)} placeholder="搜索值" aria-label={`搜索 ${column} 的值`}/><div className="result-column-menu-actions"><button type="button" onClick={()=>onChange(values.length?values:undefined)}>全选</button><button type="button" onClick={()=>onChange(undefined)}>清空</button></div><div className="result-column-values">{values.map(value=><label key={value}><input type="checkbox" checked={selected?.includes(value)??false} onChange={()=>{const next=new Set(selected??[]);next.has(value)?next.delete(value):next.add(value);onChange(next.size?[...next]:undefined)}}/><span>{value}</span></label>)}</div></div>
}
