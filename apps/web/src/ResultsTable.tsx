import { useEffect, useMemo, useState } from 'react'
import type { CSSProperties } from 'react'
import type { QueryRow } from './types'
import { pinnedResultColumn } from './result-columns'
import { resultCell } from './result-time'
import { ResultGridZoomControls } from './ResultGridZoomControls'
import { stepGridZoom, useGridZoom } from './result-grid-zoom'
import ResultColumnMenu from './ResultColumnMenu'

export default function ResultsTable({ rows }: { rows: QueryRow[] }) {
  const columns = Object.keys(rows[0] || {})
  const [search,setSearch]=useState(''), [sort,setSort]=useState<{column:string;desc:boolean}|null>(null), [hidden,setHidden]=useState<Set<string>>(new Set())
  const [filters,setFilters]=useState<Partial<Record<string,string[]>>>({}), [openColumn,setOpenColumn]=useState<string|null>(null)
  const [page,setPage]=useState(1),[pageSize,setPageSize]=useState(()=>Number(localStorage.getItem('gdb.resultPageSize'))||100)
  const [zoom,setZoom]=useGridZoom()
  const visible=columns.filter(column=>!hidden.has(column))
  const pinnedColumn=pinnedResultColumn(visible)
  const data=useMemo(()=>{const filtered=rows.filter(row=>Object.entries(filters).every(([column,values])=>!values?.length||values.includes(String(row[column]??'(空)')))&&(!search||Object.values(row).some(value=>String(value??'').toLowerCase().includes(search.toLowerCase()))));if(!sort)return filtered;return [...filtered].sort((a,b)=>String(a[sort.column]??'').localeCompare(String(b[sort.column]??''),undefined,{numeric:true})*(sort.desc?-1:1))},[rows,search,sort,filters])
  useEffect(()=>setPage(1),[rows,filters])
  const pages=Math.max(1,Math.ceil(data.length/pageSize)),currentPage=Math.min(page,pages),paged=data.slice((currentPage-1)*pageSize,currentPage*pageSize)
  const start=data.length?(currentPage-1)*pageSize+1:0,end=Math.min(currentPage*pageSize,data.length)
  return <div className="data-grid" style={{'--grid-zoom':zoom/100} as CSSProperties} onWheel={event=>{if(!event.ctrlKey)return;event.preventDefault();setZoom(current=>stepGridZoom(current,event.deltaY<0?1:-1))}}>
    <div className="grid-tools"><input value={search} onChange={event=>{setSearch(event.target.value);setPage(1)}} placeholder="搜索结果…"/><details><summary>列 {visible.length}/{columns.length}</summary><div className="column-menu">{columns.map(column=><label key={column}><input type="checkbox" checked={!hidden.has(column)} onChange={()=>setHidden(current=>{const next=new Set(current);next.has(column)?next.delete(column):next.add(column);return next})}/>{column}</label>)}</div></details><ResultGridZoomControls zoom={zoom} onChange={setZoom}/><span>{data.length} 行 · 客户端分页 <i>↔ 横向滚动查看更多字段</i></span></div>
    <div className="grid-scroll" tabIndex={0} aria-label="查询结果表格，可横向滚动"><table><thead><tr>{visible.map(column=><th key={column} className={`result-column-head ${column===pinnedColumn?'pinned':''} ${openColumn===column?'menu-open':''}`}><span className="result-column-label">{column}<small>{column.toLowerCase()==='time'?'UTC':typeof rows[0]?.[column]}</small></span><button type="button" className={sort?.column===column?'active':''} onClick={()=>setSort(current=>({column,desc:current?.column===column?!current.desc:false}))}>{sort?.column===column?(sort.desc?'↓':'↑'):'↕'}</button><button type="button" className={filters[column]?.length?'active':''} onClick={()=>setOpenColumn(openColumn===column?null:column)}>⌕</button>{openColumn===column&&<ResultColumnMenu rows={rows} column={column} selected={filters[column]} onChange={values=>{setFilters(current=>({...current,[column]:values}));setPage(1)}} onClose={()=>setOpenColumn(null)}/>}</th>)}</tr></thead><tbody>{paged.map((row,index)=><tr key={(currentPage-1)*pageSize+index}>{visible.map(column=>{const cell=resultCell(column,row[column]);return <td key={column} className={column===pinnedColumn?'pinned':''} title={cell.title}>{cell.text}</td>})}</tr>)}</tbody></table></div>
    <div className="grid-pagination"><span>显示 {start}–{end} / {data.length}</span><label className="page-size">每页 <select value={pageSize} onChange={event=>{const size=Number(event.target.value);setPageSize(size);setPage(1);localStorage.setItem('gdb.resultPageSize',String(size))}}>{[50,100,200,500,1000].map(size=><option key={size}>{size}</option>)}</select> 行</label><div className="page-controls"><button disabled={currentPage<=1} onClick={()=>setPage(1)} title="首页">«</button><button disabled={currentPage<=1} onClick={()=>setPage(value=>value-1)} title="上一页">‹</button><label>第 <input type="number" min="1" max={pages} value={currentPage} onChange={event=>setPage(Math.max(1,Math.min(pages,Number(event.target.value)||1)))}/> / {pages} 页</label><button disabled={currentPage>=pages} onClick={()=>setPage(value=>value+1)} title="下一页">›</button><button disabled={currentPage>=pages} onClick={()=>setPage(pages)} title="末页">»</button></div></div>
  </div>
}
