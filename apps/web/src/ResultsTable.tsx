import { useMemo, useState } from 'react'
import type { QueryRow } from './types'

export default function ResultsTable({ rows }: { rows: QueryRow[] }) {
  const columns = Object.keys(rows[0] || {})
  const [search,setSearch]=useState(''), [sort,setSort]=useState<{column:string;desc:boolean}|null>(null), [hidden,setHidden]=useState<Set<string>>(new Set())
  const visible=columns.filter(column=>!hidden.has(column))
  const data=useMemo(()=>{const filtered=search?rows.filter(row=>Object.values(row).some(value=>String(value??'').toLowerCase().includes(search.toLowerCase()))):rows;if(!sort)return filtered;return [...filtered].sort((a,b)=>String(a[sort.column]??'').localeCompare(String(b[sort.column]??''),undefined,{numeric:true})*(sort.desc?-1:1))},[rows,search,sort])
  return <div className="data-grid"><div className="grid-tools"><input value={search} onChange={event=>setSearch(event.target.value)} placeholder="搜索结果…"/><details><summary>列 {visible.length}/{columns.length}</summary><div className="column-menu">{columns.map(column=><label key={column}><input type="checkbox" checked={!hidden.has(column)} onChange={()=>setHidden(current=>{const next=new Set(current);next.has(column)?next.delete(column):next.add(column);return next})}/>{column}</label>)}</div></details><span>{data.length} 行</span></div><div className="grid-scroll"><table><thead><tr>{visible.map((column,index)=><th key={column} className={index===0?'pinned':''} onClick={()=>setSort(current=>({column,desc:current?.column===column?!current.desc:false}))}>{column}{sort?.column===column?(sort.desc?' ↓':' ↑'):''}<small>{typeof rows[0]?.[column]}</small></th>)}</tr></thead><tbody>{data.map((row,index)=><tr key={index}>{visible.map((column,columnIndex)=><td key={column} className={columnIndex===0?'pinned':''} title={String(row[column]??'')}>{String(row[column]??'')}</td>)}</tr>)}</tbody></table></div></div>
}
