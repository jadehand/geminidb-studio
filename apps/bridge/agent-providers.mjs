const RESPONSE_SCHEMA = {
  type:'object',
  additionalProperties:false,
  required:['kind','content'],
  properties:{
    kind:{ enum:['assistant_message','tool_call','final'] },
    content:{ type:'string' },
    callId:{ type:'string' },
    tool:{ type:'string' },
    input:{ type:'object' },
  },
}

class ProviderError extends Error {
  constructor(status,code,message,details) {
    super(message)
    this.name = 'ProviderError'
    this.status = status
    this.code = code
    if(details !== undefined)this.details = details
  }
}

const invalid = () => new ProviderError(502,'AGENT_MODEL_INVALID_RESPONSE','Agent 模型返回了无效响应')
const outputLimit = () => new ProviderError(502,'AGENT_OUTPUT_LIMIT','Agent 模型响应超过大小限制')
const plainObject = value => value !== null && typeof value === 'object' && !Array.isArray(value) &&
  (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null)

function parseJson(value) {
  if(typeof value !== 'string')return value
  try{return JSON.parse(value)}catch{throw invalid()}
}

function normalize(value,usage) {
  const response = parseJson(value)
  if(!plainObject(response) || !['assistant_message','tool_call','final'].includes(response.kind) ||
    typeof response.content !== 'string')throw invalid()
  if(response.kind === 'tool_call' && (typeof response.callId !== 'string' || !response.callId ||
    typeof response.tool !== 'string' || !response.tool || !plainObject(response.input)))throw invalid()
  const result = { kind:response.kind, content:response.content }
  if(response.kind === 'tool_call')Object.assign(result,{ callId:response.callId, tool:response.tool, input:response.input })
  if(usage)result.usage = usage
  return result
}

function endpointUrl(endpoint) {
  let url
  try{url = new URL(endpoint)}catch{throw new ProviderError(400,'AGENT_PROVIDER_INVALID_SETTINGS','Anthropic Endpoint 无效')}
  if(url.protocol !== 'https:')throw new ProviderError(400,'AGENT_PROVIDER_INVALID_SETTINGS','Anthropic Endpoint 必须使用 HTTPS')
  if(url.username || url.password || url.search || url.hash)
    throw new ProviderError(400,'AGENT_PROVIDER_INVALID_SETTINGS','Anthropic Endpoint 不得包含认证信息、查询参数或片段')
  const pathname = url.pathname.replace(/\/+$/,'')
  url.pathname = `${pathname}/v1/messages`
  return url.toString()
}

function abortError(signal,error,abortReason) {
  if(abortReason === 'cancelled' || (signal?.aborted && !abortReason))
    return new ProviderError(499,'AGENT_CANCELLED','Agent 请求已取消')
  if(abortReason === 'timeout')return new ProviderError(504,'AGENT_TIMEOUT','Agent 请求超时')
  if(error?.name === 'TimeoutError')return new ProviderError(504,'AGENT_TIMEOUT','Agent 请求超时')
  if(error?.name === 'AbortError')return new ProviderError(504,'AGENT_TIMEOUT','Agent 请求超时')
  return error
}

async function readResponseText(response) {
  if(!response.body)throw invalid()
  const reader = response.body.getReader()
  const chunks = []
  let size = 0
  try {
    while(true) {
      const {done,value} = await reader.read()
      if(done)break
      size += value.byteLength
      if(size > 2_000_000) {
        await reader.cancel()
        throw outputLimit()
      }
      chunks.push(value)
    }
    return new TextDecoder().decode(Buffer.concat(chunks.map(chunk=>Buffer.from(chunk))))
  } finally {
    reader.releaseLock()
  }
}

function redactMessage(value,apiKey) {
  let message = String(value)
  if(apiKey)message = message.split(String(apiKey)).join('[REDACTED]')
  return message
    .replace(/\bauthorization\s*[:=].*$/gi,'authorization: [REDACTED]')
    .replace(/\b(?:bearer|token)\s*(?:[:=]|\s)\s*[^\s,;]+/gi,'[REDACTED]')
}

function redactError(error,apiKey) {
  if(error instanceof Error) {
    error.message = redactMessage(error.message,apiKey)
    if(error.details?.type !== undefined)error.details.type = redactMessage(error.details.type,apiKey)
    return error
  }
  return new Error(redactMessage(error,apiKey))
}

function apiError(status,type,message,apiKey) {
  return new ProviderError(status,'AGENT_PROVIDER_API_ERROR',
    redactMessage(message,apiKey),{ type:redactMessage(type,apiKey) })
}

function normalizeTimeout(value,defaultValue) {
  if(value === undefined)return defaultValue
  if(typeof value !== 'number' || !Number.isFinite(value) || value <= 0 || value > 300000)
    throw new ProviderError(400,'AGENT_PROVIDER_INVALID_SETTINGS','timeoutMs 必须是 300000 以内的正数')
  return value
}

function cliError(error,signal) {
  if(error?.code === 'CLAUDE_TIMEOUT' || error?.name === 'TimeoutError')
    return new ProviderError(504,'AGENT_TIMEOUT','Agent 请求超时')
  if(signal?.aborted && (error?.code === 'DIAGNOSIS_CANCELLED' || error?.name === 'AbortError'))
    return new ProviderError(499,'AGENT_CANCELLED','Agent 请求已取消')
  if(error?.code === 'CLAUDE_OUTPUT_LIMIT')
    return new ProviderError(502,'AGENT_OUTPUT_LIMIT','Agent 模型响应超过大小限制')
  const causeCode = ['CLAUDE_CLI_START_FAILED','CLAUDE_CLI_FAILED'].includes(error?.code)
    ? error.code : undefined
  return new ProviderError(503,'AGENT_PROVIDER_UNAVAILABLE',
    redactMessage(error?.message || 'Claude CLI 不可用'),
    causeCode ? { causeCode } : undefined)
}

export function createAgentProvider({
  runProcess,
  fetchImpl=globalThis.fetch,
  apiKeyProvider=() => process.env.ANTHROPIC_API_KEY,
}) {
  return {
    async probe(settings={}) {
      if(settings.provider === 'api') {
        settings = { ...settings, apiKey:settings.apiKey || apiKeyProvider() }
        if(!settings.apiKey)return{ ready:false, kind:'misconfigured', message:'请配置 ANTHROPIC_API_KEY' }
        try{endpointUrl(settings.endpoint)}catch(error){return{ ready:false, kind:'misconfigured', message:error.message }}
        return{ ready:true, kind:'ready', message:'Anthropic API 已配置' }
      }
      const command = String(settings.cliPath || 'claude')
      try {
        const versionResult = await runProcess(command,['--version'],'',10000)
        const version = String(versionResult.stdout || '').trim()
        if(!/claude/i.test(version))return{ ready:false, kind:'not_installed', version, message:'指定路径不是 Claude Code 命令' }
        try {
          const authResult = await runProcess(command,['auth','status','--json'],'',15000)
          const auth = parseJson(authResult.stdout)
          const ready = Boolean(auth.loggedIn ?? auth.authenticated ?? false)
          return{ ready, kind:ready?'ready':'not_authenticated', version, message:ready?'Claude CLI 已安装并登录':'Claude CLI 尚未登录' }
        } catch {
          return{ ready:false, kind:'authentication_unknown', version, message:'Claude CLI 登录状态无法确认' }
        }
      } catch(error) {
        return{ ready:false, kind:'not_installed', message:error instanceof Error?error.message:'未检测到 Claude CLI' }
      }
    },

    async complete(request,signal) {
      if(request.provider === 'cli') {
        const settings = request.settings || {}
        const timeoutMs = normalizeTimeout(settings.timeoutMs,90000)
        const prompt = JSON.stringify({ system:request.system, messages:request.messages || [], tools:request.tools || [] })
        try {
          const output = await runProcess(String(settings.cliPath || 'claude'),[
            '-p','--tools','','--permission-mode','dontAsk','--no-session-persistence',
            '--output-format','json','--json-schema',JSON.stringify(RESPONSE_SCHEMA),
          ],prompt,timeoutMs,signal)
          const envelope = parseJson(output.stdout)
          return normalize(envelope?.structured_output ?? envelope?.result ?? envelope)
        } catch(error) {
          if(error instanceof ProviderError)throw error
          throw cliError(error,signal)
        }
      }

      const settings = {
        ...(request.settings || {}),
        apiKey:request.settings?.apiKey || apiKeyProvider(),
      }
      if(!settings.apiKey)throw new ProviderError(400,'AGENT_PROVIDER_MISCONFIGURED','请配置 API Key')
      const timeoutMs = normalizeTimeout(settings.timeoutMs,60000)
      const body = {
        model:settings.model,
        max_tokens:settings.maxTokens || 4096,
        messages:request.messages || [],
        tools:request.tools || [],
      }
      if(request.system)body.system = request.system
      const controller = new AbortController()
      let abortReason
      const cancel = () => {
        if(!abortReason)abortReason = 'cancelled'
        controller.abort()
      }
      if(signal?.aborted)cancel()
      else signal?.addEventListener('abort',cancel,{ once:true })
      const timer = setTimeout(()=>{
        if(!controller.signal.aborted) {
          abortReason = 'timeout'
          controller.abort()
        }
      },timeoutMs)
      try {
        const response = await fetchImpl(endpointUrl(settings.endpoint),{
          method:'POST',
          headers:{ 'content-type':'application/json', 'x-api-key':settings.apiKey, 'anthropic-version':'2023-06-01' },
          body:JSON.stringify(body),
          signal:controller.signal,
        })
        const responseText = await readResponseText(response)
        if(!response.ok) {
          let payload
          try{payload = JSON.parse(responseText)}catch{}
          const type = payload?.error?.type || 'api_error'
          const message = payload?.error?.message || `Anthropic API HTTP ${response.status}`
          throw apiError(response.status,type,message,settings.apiKey)
        }
        let payload
        try{payload = JSON.parse(responseText)}catch{throw invalid()}
        if(!Array.isArray(payload?.content))throw invalid()
        const usage = payload.usage ? { inputTokens:Number(payload.usage.input_tokens || 0), outputTokens:Number(payload.usage.output_tokens || 0) } : undefined
        const text = payload.content.filter(block=>block?.type === 'text').map(block=>block.text).join('')
        const toolUses = payload.content.filter(block=>block?.type === 'tool_use')
        if(toolUses.length > 1)throw invalid()
        const tool = toolUses[0]
        return tool
          ? normalize({ kind:'tool_call', content:text, callId:tool.id, tool:tool.name, input:tool.input },usage)
          : normalize({ kind:payload.stop_reason === 'end_turn'?'final':'assistant_message', content:text },usage)
      } catch(error) {
        throw redactError(abortError(signal,error,abortReason),settings.apiKey)
      } finally {
        clearTimeout(timer)
        signal?.removeEventListener('abort',cancel)
      }
    },
  }
}

export { ProviderError, RESPONSE_SCHEMA }
