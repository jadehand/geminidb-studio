const SYSTEM='诊断显式提供的 GeminiDB InfluxQL、错误与 Schema。只返回 JSON：summary 字符串、problems 数组、fixedSql 字符串、performanceAdvice 字符串数组、risk(read/write/danger)。不得调用工具、读取文件、执行命令或执行数据库操作。'

export class ClaudeDiagnosticsError extends Error {
  constructor(status,code,message) {
    super(message)
    this.name='ClaudeDiagnosticsError'
    this.status=status
    this.code=code
  }
}

function extractJson(text) {
  const source=String(text).match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1]||String(text)
  try{return JSON.parse(source)}catch{
    throw new ClaudeDiagnosticsError(502,'CLAUDE_INVALID_RESPONSE','Claude 未返回有效的诊断 JSON')
  }
}

export function normalizeClaudeDiagnosis(result,sql='',usage) {
  if(!result||typeof result!=='object'||Array.isArray(result))
    throw new ClaudeDiagnosticsError(502,'CLAUDE_INVALID_RESPONSE','Claude 未返回有效的诊断 JSON')
  return{
    summary:String(result.summary||'诊断完成'),
    problems:Array.isArray(result.problems)?result.problems:[],
    fixedSql:String(result.fixedSql||sql||''),
    performanceAdvice:Array.isArray(result.performanceAdvice)?result.performanceAdvice:[],
    risk:['read','write','danger'].includes(result.risk)?result.risk:'read',
    usage,
  }
}

function diagnosisError(error) {
  if(error instanceof ClaudeDiagnosticsError)return error
  const mapping={
    CLAUDE_CANCELLED:[499,'DIAGNOSIS_CANCELLED','诊断已取消'],
    DIAGNOSIS_CANCELLED:[499,'DIAGNOSIS_CANCELLED','诊断已取消'],
    CLAUDE_TIMEOUT:[504,'CLAUDE_TIMEOUT','Claude 请求超时'],
    CLAUDE_CLI_START_FAILED:[502,'CLAUDE_CLI_START_FAILED','Claude CLI 启动失败'],
    CLAUDE_CLI_FAILED:[502,'CLAUDE_CLI_FAILED','Claude CLI 执行失败'],
    CLAUDE_OUTPUT_LIMIT:[502,'CLAUDE_OUTPUT_LIMIT','Claude 输出超过限制'],
    CLAUDE_EMPTY_RESPONSE:[502,'CLAUDE_INVALID_RESPONSE','Claude 未返回内容'],
    CLAUDE_INPUT_INVALID:[400,'CLAUDE_INPUT_INVALID','诊断上下文无效'],
  }
  const mapped=mapping[error?.code]||[502,'CLAUDE_CLI_FAILED','Claude CLI 执行失败']
  return new ClaudeDiagnosticsError(...mapped)
}

export function createClaudeDiagnostics({cli}) {
  if(!cli)throw new TypeError('cli is required')
  return{
    probe() {
      return cli.probe()
    },

    async diagnose(data={},signal,secrets=[]) {
      const context=data.context&&typeof data.context==='object'&&!Array.isArray(data.context)?data.context:{}
      try{
        const response=await cli.chat({
          messages:[{role:'user',content:SYSTEM}],
          attachments:{
            ...(typeof context.sql==='string'&&context.sql.trim()?{sql:context.sql}:{}),
            ...(typeof context.error==='string'&&context.error.trim()?{error:context.error}:{}),
            ...(context.schema&&typeof context.schema==='object'?{schema:context.schema}:{}),
          },
          secrets,
          signal,
        })
        return normalizeClaudeDiagnosis(extractJson(response.content),context.sql,response.usage??{})
      }catch(error){throw diagnosisError(error)}
    },
  }
}

export { SYSTEM }
