import { redactSensitiveText, sanitizeClaudeValue } from './claude-safety.mjs'

const DEFAULT_TIMEOUT_MS=90_000
const DEFAULT_MAX_OUTPUT_BYTES=40_000
const MAX_MESSAGES=100
const MAX_MESSAGE_CHARS=40_000

export class ClaudeCliError extends Error {
  constructor(status,code,message) {
    super(message)
    this.name='ClaudeCliError'
    this.status=status
    this.code=code
  }
}
function invalid(message='Claude 输入无效') {
  return new ClaudeCliError(400,'CLAUDE_INPUT_INVALID',message)
}

function cleanText(value,label,max=MAX_MESSAGE_CHARS) {
  if(typeof value!=='string')throw invalid(`${label} 必须是字符串`)
  const text=value.trim()
  if(!text)throw invalid(`${label}不能为空`)
  if(text.length>max)throw invalid(`${label}超过长度限制`)
  return text
}

function normalizeMessages(messages,secrets=[]) {
  if(!Array.isArray(messages)||messages.length===0||messages.length>MAX_MESSAGES)
    throw invalid('消息数量无效')
  return messages.map((message,index)=>{
    if(!message||typeof message!=='object'||Array.isArray(message))throw invalid(`第 ${index+1} 条消息无效`)
    if(!['user','assistant'].includes(message.role))throw invalid(`第 ${index+1} 条消息角色无效`)
    return{role:message.role,content:redactSensitiveText(cleanText(message.content,`第 ${index+1} 条消息`),{secrets})}
  })
}

function normalizeAttachments(value,secrets=[]) {
  if(value===undefined)return{}
  if(!value||typeof value!=='object'||Array.isArray(value))throw invalid('上下文附件无效')
  const attachments={}
  if(value.sql!==undefined)attachments.sql=redactSensitiveText(cleanText(value.sql,'SQL',80_000),{secrets})
  if(value.error!==undefined&&String(value.error).trim())attachments.error=redactSensitiveText(cleanText(value.error,'错误信息',20_000),{secrets})
  if(value.schema!==undefined&&value.schema!==null) {
    if(typeof value.schema!=='object'||Array.isArray(value.schema))throw invalid('Schema 无效')
    let schema
    try{schema=sanitizeClaudeValue(value.schema,{secrets,path:'Schema'})}catch(error){throw invalid(error.message)}
    const encoded=JSON.stringify(schema)
    if(encoded.length>80_000)throw invalid('Schema 超过长度限制')
    attachments.schema=JSON.parse(encoded)
  }
  return attachments
}

function safeError(error,signal) {
  const code=signal?.aborted||error?.code==='DIAGNOSIS_CANCELLED'||error?.code==='CLAUDE_CANCELLED'
    ? 'CLAUDE_CANCELLED'
    : error?.code==='CLAUDE_TIMEOUT'
      ? 'CLAUDE_TIMEOUT'
      : error?.code==='CLAUDE_OUTPUT_LIMIT'
        ? 'CLAUDE_OUTPUT_LIMIT'
        : error?.code==='CLAUDE_CLI_START_FAILED'
          ? 'CLAUDE_CLI_START_FAILED'
          : 'CLAUDE_CLI_FAILED'
  const mapping={
    CLAUDE_CANCELLED:[499,'Claude 请求已取消'],
    CLAUDE_TIMEOUT:[504,'Claude CLI 请求超时'],
    CLAUDE_OUTPUT_LIMIT:[502,'Claude 输出超过限制'],
    CLAUDE_CLI_START_FAILED:[502,'Claude CLI 启动失败'],
    CLAUDE_CLI_FAILED:[502,'Claude CLI 执行失败'],
  }
  return new ClaudeCliError(mapping[code][0],code,mapping[code][1])
}

function outputText(result,maxOutputBytes) {
  const content=typeof result==='string'?result:String(result?.stdout??'')
  if(Buffer.byteLength(content,'utf8')>maxOutputBytes)
    throw new ClaudeCliError(502,'CLAUDE_OUTPUT_LIMIT','Claude 输出超过限制')
  if(!content.trim())throw new ClaudeCliError(502,'CLAUDE_EMPTY_RESPONSE','Claude 未返回内容')
  return content.trim()
}

export function buildClaudeChatPrompt(messages,attachments={},options={}) {
  const secrets=Array.isArray(options.secrets)?options.secrets:[]
  return JSON.stringify({
    system:'你是 GeminiDB Studio 的本地 Claude 助手。只回答用户问题并分析显式提供的上下文。不得索取或推测凭据，不得调用工具、读取文件、执行命令或执行数据库操作。生成的 InfluxQL 仅供用户审阅和手动执行。',
    conversation:normalizeMessages(messages,secrets),
    attachments:normalizeAttachments(attachments,secrets),
  })
}

export function createClaudeCli({
  runProcess,
  command='claude',
  timeoutMs=DEFAULT_TIMEOUT_MS,
  maxOutputBytes=DEFAULT_MAX_OUTPUT_BYTES,
}={}) {
  if(typeof runProcess!=='function')throw new TypeError('runProcess is required')
  return{
    async probe() {
      try{
        const versionResult=await runProcess(command,['--version'],'',10_000)
        const version=String(versionResult?.stdout??versionResult??'').trim()
        if(!/claude/i.test(version))return{ready:false,kind:'not_installed',version,message:'指定路径不是 Claude Code 命令'}
        try{
          const authResult=await runProcess(command,['auth','status','--json'],'',15_000)
          const auth=JSON.parse(String(authResult?.stdout??authResult??''))
          const ready=Boolean(auth.loggedIn??auth.authenticated??false)
          return{ready,kind:ready?'ready':'not_authenticated',version,message:ready?'Claude CLI 已安装并登录':'Claude CLI 尚未登录'}
        }catch{
          return{ready:false,kind:'authentication_unknown',version,message:'Claude CLI 登录状态无法确认'}
        }
      }catch{
        return{ready:false,kind:'not_installed',message:'未检测到 Claude CLI'}
      }
    },

    async chat({messages,attachments={},signal,secrets=[]}={}) {
      const prompt=buildClaudeChatPrompt(messages,attachments,{secrets})
      try{
        const result=await runProcess(command,[
          '-p','--tools','','--permission-mode','dontAsk','--no-session-persistence','--output-format','text',
        ],prompt,timeoutMs,signal)
        return{content:outputText(result,maxOutputBytes),usage:{}}
      }catch(error){
        if(error instanceof ClaudeCliError)throw error
        throw safeError(error,signal)
      }
    },
  }
}
