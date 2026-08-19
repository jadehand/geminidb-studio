import { BridgeError, bridgeApiBase, bridgeRequest, currentBridgeSessionId } from './api.ts'
import type {
  ClaudeAssistantAttachments,
  ClaudeAssistantSession,
  ClaudeAssistantSessionSummary,
  ClaudeProbe,
  ClaudeSettings,
} from './claude-assistant-types.ts'

type Fetch = typeof fetch

export type ClaudeAssistantClientOptions = {
  fetchImpl?: Fetch
  apiBase?: () => string
  sessionId?: () => string
}

function redactToken(value:unknown,token:string,seen=new WeakSet<object>()):unknown {
  if(typeof value==='string')return token?value.split(token).join('[REDACTED]'):value
  if(!value||typeof value!=='object'||seen.has(value))return value
  seen.add(value)
  if(Array.isArray(value))return value.map(item=>redactToken(item,token,seen))
  const result:Record<string,unknown>={}
  for(const [key,descriptor] of Object.entries(Object.getOwnPropertyDescriptors(value))) {
    if('value' in descriptor)result[key]=redactToken(descriptor.value,token,seen)
  }
  return result
}

async function responseBody<T>(response:Response,token:string):Promise<T> {
  if(!response.ok) {
    const body=await response.json().catch(()=>({message:response.statusText})) as {
      message?:string;code?:string;details?:unknown
    }
    throw new BridgeError(
      redactToken(body.message||`HTTP ${response.status}`,token) as string,
      body.code||'HTTP_ERROR',response.status,redactToken(body.details,token),
    )
  }
  if(response.status===204)return undefined as T
  return response.json() as Promise<T>
}

export function createClaudeAssistantClient(options:ClaudeAssistantClientOptions={}) {
  const fetchImpl=options.fetchImpl??fetch
  const getBase=options.apiBase??bridgeApiBase
  const getSession=options.sessionId??currentBridgeSessionId
  async function request<T>(path:string,init?:RequestInit):Promise<T> {
    if(!options.fetchImpl&&!options.apiBase&&!options.sessionId)return bridgeRequest<T>(path,init)
    const token=getSession()
    const response=await fetchImpl(`${getBase()}${path}`,{
      ...init,
      headers:{'Content-Type':'application/json',...(token?{Authorization:`Bearer ${token}`}:{ }),...init?.headers},
    })
    return responseBody<T>(response,token)
  }
  return{
    listSessions:()=>request<ClaudeAssistantSessionSummary[]>('/claude/sessions'),
    createSession:(title='新会话')=>request<ClaudeAssistantSession>('/claude/sessions',{
      method:'POST',body:JSON.stringify({title}),
    }),
    getSession:(id:string)=>request<ClaudeAssistantSession>(`/claude/sessions/${encodeURIComponent(id)}`),
    renameSession:(id:string,title:string)=>request<ClaudeAssistantSession>(`/claude/sessions/${encodeURIComponent(id)}`,{
      method:'PATCH',body:JSON.stringify({title}),
    }),
    deleteSession:(id:string)=>request<void>(`/claude/sessions/${encodeURIComponent(id)}`,{method:'DELETE'}),
    sendMessage:(id:string,input:{content:string;attachments?:ClaudeAssistantAttachments},signal?:AbortSignal)=>
      request<ClaudeAssistantSession>(`/claude/sessions/${encodeURIComponent(id)}/messages`,{
        method:'POST',body:JSON.stringify(input),signal,
      }),
    probe:()=>request<ClaudeProbe>('/claude/probe',{method:'POST',body:'{}'}),
    getSettings:()=>request<ClaudeSettings>('/claude/settings'),
    saveSettings:(cliPath:string)=>request<ClaudeSettings>('/claude/settings',{
      method:'PATCH',body:JSON.stringify({cliPath}),
    }),
  }
}

export const claudeAssistantApi=createClaudeAssistantClient()
