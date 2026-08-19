import { useEffect, useRef } from 'react'
import { CURRENT_LEARNING_RELEASE, GUIDE_TOPICS, type GuideTopicId, type LearningProgress } from './learning-center'

export default function LearningCenter({progress,onClose,onStart,onReset}:{progress:LearningProgress;onClose:()=>void;onStart:(id:GuideTopicId)=>void;onReset:()=>void}){
  const closeRef=useRef<HTMLButtonElement>(null)
  useEffect(()=>{closeRef.current?.focus();const key=(event:KeyboardEvent)=>{if(event.key==='Escape')onClose()};window.addEventListener('keydown',key);return()=>window.removeEventListener('keydown',key)},[onClose])
  const releaseNew=progress.seenRelease!==CURRENT_LEARNING_RELEASE
  return <div className="modal learning-center-modal"><section className="learning-center" role="dialog" aria-modal="true" aria-labelledby="learning-center-title">
    <header><div><span className="learning-kicker">GEMINIDB STUDIO</span><h2 id="learning-center-title">学习中心</h2><p>从最短查询路径开始，需要时再学习高级功能。</p></div><button ref={closeRef} className="close-icon" onClick={onClose} aria-label="关闭学习中心">×</button></header>
    {releaseNew&&<div className="learning-release"><b>v0.7 新功能</b><span>Claude 助手、Measurement 数据查看与编辑、离线知识库现已加入专题引导。</span></div>}
    <div className="learning-section-title"><b>推荐开始</b><span>首次使用约 3 分钟</span></div>
    <TopicCard id="quick-start" progress={progress} onStart={onStart}/>
    <div className="learning-section-title"><b>实用功能</b><span>按场景随时学习</span></div>
    <div className="learning-topic-grid">{GUIDE_TOPICS.filter(topic=>topic.id!=='quick-start').map(topic=><TopicCard key={topic.id} id={topic.id} progress={progress} onStart={onStart}/>)}</div>
    <footer><span>学习状态仅保存在本机</span><button onClick={onReset}>重置学习进度</button></footer>
  </section></div>
}

function TopicCard({id,progress,onStart}:{id:GuideTopicId;progress:LearningProgress;onStart:(id:GuideTopicId)=>void}){
  const topic=GUIDE_TOPICS.find(item=>item.id===id)!
  const status=progress.topics[id]
  const label=status==='completed'?'已完成':status==='skipped'?'已跳过':'未体验'
  return <article className={`learning-topic ${id==='quick-start'?'featured':''}`}>
    <span className="learning-topic-icon" aria-hidden="true">{topic.icon}</span>
    <div><div className="learning-topic-heading"><h3>{topic.title}</h3><em className={`status-${status}`}>{label}</em></div><p>{topic.description}</p><small>{topic.steps.length} 个步骤</small></div>
    <button className={id==='quick-start'?'primary':''} onClick={()=>onStart(id)}>{status==='new'?'开始体验':'重新体验'}</button>
  </article>
}
