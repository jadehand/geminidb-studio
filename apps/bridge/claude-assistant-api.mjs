import { redactSensitiveText, sanitizeClaudeValue } from './claude-safety.mjs'

export class ClaudeAssistantApiError extends Error {
  constructor(status,code,message) {
    super(message)
    this.name='ClaudeAssistantApiError'
    this.status=status
    this.code=code
  }
}

const result=(status,payload)=>({status,payload})
const MAX_PROMPT_MESSAGES=80

function payload(value) {
  if(value===undefined)return{}
  if(!value||typeof value!=='object'||Array.isArray(value))
    throw new ClaudeAssistantApiError(400,'CLAUDE_INPUT_INVALID','请求内容无效')
  return value
}

function fields(value,allowed) {
  const unexpected=Object.keys(value).filter(key=>!allowed.includes(key))
  if(unexpected.length)throw new ClaudeAssistantApiError(400,'CLAUDE_INPUT_INVALID',`不支持的字段：${unexpected.join(', ')}`)
}

function ownerId() {return 'local'}

function sessionSecrets(session) {
  return [
    {kind:'endpoint',value:session?.endpoint},
    {kind:'username',value:session?.username},
    {kind:'password',value:session?.password},
  ].map(item=>({...item,value:String(item.value||'')})).filter(item=>item.value)
}

function safeInput(value,session) {
  const secrets=sessionSecrets(session)
  try{return sanitizeClaudeValue(value,{secrets,path:'Claude 请求'})}catch(error){
    throw new ClaudeAssistantApiError(400,'CLAUDE_INPUT_INVALID',error.message)
  }
}

function safeTitle(value,session) {
  return typeof value==='string'?redactSensitiveText(value,{secrets:sessionSecrets(session)}):value
}

function routeId(pathname,suffix='') {
  const expression=suffix
    ? new RegExp(`^/claude/sessions/([^/]+)/${suffix}$`)
    : /^\/claude\/sessions\/([^/]+)$/
  const match=pathname.match(expression)
  if(!match)return''
  try{return decodeURIComponent(match[1])}catch{
    throw new ClaudeAssistantApiError(400,'CLAUDE_INPUT_INVALID','会话 ID 无效')
  }
}

export function createClaudeAssistantApi({store,cli}) {
  if(!store||!cli)throw new TypeError('store and cli are required')
  const inFlight=new Set()
  return{
    async handle({pathname,method,session,payload:rawPayload,signal,emit}={}) {
      const body=payload(rawPayload)
      const owner=ownerId(session)
      if(pathname==='/claude/sessions'&&method==='GET') {
        fields(body,[])
        return result(200,await store.list(owner))
      }
      if(pathname==='/claude/sessions'&&method==='POST') {
        fields(body,['title'])
        return result(201,await store.create(owner,{title:safeTitle(body.title??'新会话',session)}))
      }

      const messageId=routeId(pathname,'messages')
      if(messageId&&method==='POST') {
        fields(body,['content','attachments'])
        const key=`${owner}\u0000${messageId}`
        if(inFlight.has(key))throw new ClaudeAssistantApiError(409,'CLAUDE_SESSION_BUSY','当前会话正在等待 Claude 回复')
        inFlight.add(key)
        try{
          await store.get(owner,messageId)
          const input=safeInput({content:body.content,...(body.attachments===undefined?{}:{attachments:body.attachments})},session)
          const userMessage=await store.append(owner,messageId,{role:'user',content:input.content,attachments:input.attachments})
          emit?.({type:'accepted',message:userMessage})
          const current=await store.get(owner,messageId)
          emit?.({type:'stage',stage:'generating'})
          const response=await cli.chat({
            messages:current.messages.slice(-MAX_PROMPT_MESSAGES).map(({role,content})=>({role,content})),
            attachments:userMessage.attachments||{},
            signal,
            onDelta:text=>emit?.({type:'delta',text}),
          })
          await store.append(owner,messageId,{role:'assistant',content:response.content})
          const completed=await store.get(owner,messageId)
          emit?.({type:'complete',session:completed})
          return result(200,completed)
        }finally{inFlight.delete(key)}
      }

      const id=routeId(pathname)
      if(id&&method==='GET') {
        fields(body,[])
        return result(200,await store.get(owner,id))
      }
      if(id&&method==='PATCH') {
        fields(body,['title'])
        return result(200,await store.rename(owner,id,safeTitle(body.title,session)))
      }
      if(id&&method==='DELETE') {
        fields(body,[])
        if(inFlight.has(`${owner}\u0000${id}`))throw new ClaudeAssistantApiError(409,'CLAUDE_SESSION_BUSY','当前会话正在等待 Claude 回复')
        await store.remove(owner,id)
        return result(204,undefined)
      }
      return undefined
    },
  }
}
