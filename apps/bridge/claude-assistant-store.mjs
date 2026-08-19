import { randomUUID as nodeRandomUUID } from 'node:crypto'
import { mkdir, readFile, readdir, rename, unlink, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { redactSensitiveText, sanitizeClaudeValue } from './claude-safety.mjs'

const VERSION=1
const MAX_TITLE=120
const MAX_MESSAGE=40_000
const MAX_SQL=80_000
const MAX_ERROR=20_000
const MAX_SCHEMA=80_000

export class ClaudeAssistantStoreError extends Error {
  constructor(status,code,message) {
    super(message)
    this.name='ClaudeAssistantStoreError'
    this.status=status
    this.code=code
  }
}

const invalid=message=>new ClaudeAssistantStoreError(400,'CLAUDE_HISTORY_INVALID',message)
const missing=()=>new ClaudeAssistantStoreError(404,'CLAUDE_SESSION_NOT_FOUND','Claude 会话不存在')

function text(value,label,max,{allowEmpty=false}={}) {
  if(typeof value!=='string')throw invalid(`${label}必须是字符串`)
  const normalized=value.trim()
  if(!allowEmpty&&!normalized)throw invalid(`${label}不能为空`)
  if(normalized.length>max)throw invalid(`${label}超过长度限制`)
  return normalized
}

function owner(value) {
  return text(value,'会话所有者',256)
}

function safeClone(value,path='Schema') {
  try{return sanitizeClaudeValue(value,{path})}catch(error){throw invalid(error.message)}
}

function attachments(value) {
  if(value===undefined)return undefined
  if(!value||typeof value!=='object'||Array.isArray(value))throw invalid('上下文附件无效')
  const keys=Object.keys(value)
  if(keys.some(key=>!['sql','error','schema'].includes(key)))
    throw invalid('上下文附件包含不允许的字段')
  const result={}
  if(value.sql!==undefined)result.sql=redactSensitiveText(text(value.sql,'SQL',MAX_SQL))
  if(value.error!==undefined&&String(value.error).trim())result.error=redactSensitiveText(text(value.error,'错误信息',MAX_ERROR))
  if(value.schema!==undefined&&value.schema!==null) {
    const schema=safeClone(value.schema)
    if(JSON.stringify(schema).length>MAX_SCHEMA)throw invalid('Schema 超过长度限制')
    result.schema=schema
  }
  return Object.keys(result).length?result:undefined
}

function message(value,{id,createdAt}) {
  if(!value||typeof value!=='object'||Array.isArray(value))throw invalid('消息无效')
  if(!['user','assistant'].includes(value.role))throw invalid('消息角色无效')
  const normalized={
    id,
    role:value.role,
    content:redactSensitiveText(text(value.content,'消息内容',MAX_MESSAGE)),
    createdAt,
  }
  const context=attachments(value.attachments)
  if(context)normalized.attachments=context
  return normalized
}

function validateStoredSession(value) {
  if(!value||typeof value!=='object'||Array.isArray(value))throw invalid('会话文件无效')
  const normalized={
    id:text(value.id,'会话 ID',80),
    ownerId:owner(value.ownerId),
    title:text(value.title,'会话标题',MAX_TITLE),
    createdAt:Number(value.createdAt),
    updatedAt:Number(value.updatedAt),
    messages:[],
  }
  if(!Number.isFinite(normalized.createdAt)||!Number.isFinite(normalized.updatedAt)||!Array.isArray(value.messages))
    throw invalid('会话时间或消息无效')
  normalized.messages=value.messages.map(item=>message(item,{id:text(item?.id,'消息 ID',80),createdAt:Number(item?.createdAt)}))
  if(normalized.messages.some(item=>!Number.isFinite(item.createdAt)))throw invalid('消息时间无效')
  return normalized
}

export function createClaudeAssistantStore({dataDir,now=Date.now,randomUUID=nodeRandomUUID}={}) {
  if(typeof dataDir!=='string'||!dataDir.trim())throw new TypeError('dataDir is required')
  const root=join(dataDir,'claude-assistant')
  const sessionsDir=join(root,'sessions')
  const indexPath=join(root,'index.json')
  let index={version:VERSION,sessions:[]}
  let queue=Promise.resolve()

  const atomicWrite=async(path,value)=>{
    const temporary=`${path}.${randomUUID()}.tmp`
    await writeFile(temporary,`${JSON.stringify(value,null,2)}\n`,'utf8')
    await rename(temporary,path)
  }
  const saveIndex=()=>atomicWrite(indexPath,index)
  const sessionPath=id=>join(sessionsDir,`${id}.json`)
  const mutate=operation=>{
    const pending=queue.then(operation,operation)
    queue=pending.catch(()=>{})
    return pending
  }
  const loadSession=async(ownerId,id)=>{
    const summary=index.sessions.find(item=>item.id===id&&item.ownerId===ownerId)
    if(!summary)throw missing()
    try{return validateStoredSession(JSON.parse(await readFile(sessionPath(id),'utf8')))}catch(error){
      if(error instanceof ClaudeAssistantStoreError)throw error
      throw missing()
    }
  }

  return{
    async init() {
      await mkdir(sessionsDir,{recursive:true})
      try{
        const parsed=JSON.parse(await readFile(indexPath,'utf8'))
        if(parsed?.version!==VERSION||!Array.isArray(parsed.sessions))throw invalid('历史索引无效')
        index={version:VERSION,sessions:parsed.sessions.map(item=>({
          id:text(item.id,'会话 ID',80),ownerId:owner(item.ownerId),title:text(item.title,'会话标题',MAX_TITLE),
          createdAt:Number(item.createdAt),updatedAt:Number(item.updatedAt),messageCount:Number(item.messageCount||0),
        }))}
      }catch(error){
        if(error?.code!=='ENOENT') {
          try{await rename(indexPath,`${indexPath}.${now()}.corrupt`)}catch{}
        }
        index={version:VERSION,sessions:[]}
        await saveIndex()
      }
      let changed=false
      for(const summary of [...index.sessions]) {
        try{await loadSession(summary.ownerId,summary.id)}catch{
          try{await rename(sessionPath(summary.id),`${sessionPath(summary.id)}.${now()}.corrupt`)}catch{}
          index.sessions=index.sessions.filter(item=>item.id!==summary.id)
          changed=true
        }
      }
      if(changed)await saveIndex()
      return this
    },

    async list(ownerId) {
      await queue
      const currentOwner=owner(ownerId)
      return index.sessions.filter(item=>item.ownerId===currentOwner)
        .sort((a,b)=>b.updatedAt-a.updatedAt)
        .map(({ownerId:_owner,...item})=>({...item}))
    },

    async create(ownerId,{title='新会话'}={}) {
      return mutate(async()=>{
        const currentOwner=owner(ownerId)
        const timestamp=Number(now())
        const session={id:randomUUID(),ownerId:currentOwner,title:redactSensitiveText(text(title,'会话标题',MAX_TITLE)),createdAt:timestamp,updatedAt:timestamp,messages:[]}
        await atomicWrite(sessionPath(session.id),session)
        index.sessions.push({...session,messageCount:0,messages:undefined})
        index.sessions=index.sessions.map(({messages,...item})=>item)
        await saveIndex()
        const {ownerId:_owner,...publicSession}=session
        return publicSession
      })
    },

    async get(ownerId,id) {
      await queue
      const session=await loadSession(owner(ownerId),text(id,'会话 ID',80))
      const {ownerId:_owner,...publicSession}=session
      return publicSession
    },

    async rename(ownerId,id,title) {
      return mutate(async()=>{
        const currentOwner=owner(ownerId),currentId=text(id,'会话 ID',80)
        const session=await loadSession(currentOwner,currentId)
        session.title=redactSensitiveText(text(title,'会话标题',MAX_TITLE))
        session.updatedAt=Number(now())
        await atomicWrite(sessionPath(currentId),session)
        index.sessions=index.sessions.map(item=>item.id===currentId&&item.ownerId===currentOwner
          ? {...item,title:session.title,updatedAt:session.updatedAt}
          : item)
        await saveIndex()
        const {ownerId:_owner,...publicSession}=session
        return publicSession
      })
    },

    async append(ownerId,id,value) {
      return mutate(async()=>{
        const currentOwner=owner(ownerId),currentId=text(id,'会话 ID',80)
        const session=await loadSession(currentOwner,currentId)
        const timestamp=Number(now())
        const next=message(value,{id:randomUUID(),createdAt:timestamp})
        session.messages.push(next)
        session.updatedAt=timestamp
        await atomicWrite(sessionPath(currentId),session)
        index.sessions=index.sessions.map(item=>item.id===currentId&&item.ownerId===currentOwner
          ? {...item,updatedAt:timestamp,messageCount:session.messages.length}
          : item)
        await saveIndex()
        return next
      })
    },

    async remove(ownerId,id) {
      return mutate(async()=>{
        const currentOwner=owner(ownerId),currentId=text(id,'会话 ID',80)
        if(!index.sessions.some(item=>item.id===currentId&&item.ownerId===currentOwner))throw missing()
        try{await unlink(sessionPath(currentId))}catch(error){if(error?.code!=='ENOENT')throw error}
        index.sessions=index.sessions.filter(item=>item.id!==currentId||item.ownerId!==currentOwner)
        await saveIndex()
      })
    },
  }
}
