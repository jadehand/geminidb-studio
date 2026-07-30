import { useMemo, useState } from 'react'
import { KNOWLEDGE_ENTRIES, knowledgeExample, searchKnowledge, type KnowledgeCategory } from './knowledge-base'

const CATEGORIES:('全部'|KnowledgeCategory)[]=['全部','产品与模型','数据建模','写入数据','查询基础','Schema 探索','聚合分析','时间处理','数据管理','性能实践','排错指南','兼容说明']

export default function KnowledgeBasePanel({measurement,onInsert}:{measurement:string;onInsert:(sql:string)=>void}) {
  const [query,setQuery]=useState('')
  const [category,setCategory]=useState<'全部'|KnowledgeCategory>('全部')
  const entries=useMemo(()=>searchKnowledge(KNOWLEDGE_ENTRIES,query,category),[query,category])
  return <section className="side-panel knowledge-panel" aria-label="GeminiDB Influx 语法知识库">
    <div className="panel-title"><b>语法知识库</b><small>{entries.length}/{KNOWLEDGE_ENTRIES.length}</small></div>
    <div className="knowledge-search"><span aria-hidden="true">⌕</span><input autoFocus value={query} onChange={event=>setQuery(event.target.value)} placeholder="搜索 InfluxQL 语法或知识…"/>{query&&<button onClick={()=>setQuery('')} aria-label="清空搜索">×</button>}</div>
    <div className="knowledge-categories" role="tablist" aria-label="知识分类">{CATEGORIES.map(item=><button key={item} role="tab" aria-selected={category===item} className={category===item?'active':''} onClick={()=>setCategory(item)}>{item}</button>)}</div>
    <div className="knowledge-list">{entries.map(item=><article className={`knowledge-card ${item.kind==='concept'?'concept':'syntax'} ${item.risk?'risk':''}`} key={item.id}>
      <header><span>{item.category} · {item.kind==='concept'?'概念知识':'语法示例'}</span>{item.risk&&<em>高风险</em>}</header>
      <h3>{item.title}</h3><p>{item.content}</p>{item.tips&&<ul>{item.tips.map(tip=><li key={tip}>{tip}</li>)}</ul>}
      {item.kind!=='concept'&&<><small>语法模板</small><code>{item.syntax}</code>
      <small>可执行示例</small><pre>{knowledgeExample(item,measurement)}</pre>
      <button className="knowledge-insert" onClick={()=>onInsert(knowledgeExample(item,measurement))}>插入到新查询</button></>}
    </article>)}
    {!entries.length&&<div className="knowledge-empty"><b>没有匹配的知识条目</b><small>试试 SELECT、Tag、时间或聚合</small></div>}</div>
    <footer>离线内容 · GeminiDB Influx / InfluxQL 1.7–1.8</footer>
  </section>
}
