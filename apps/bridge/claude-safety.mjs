const SENSITIVE_KEY=/password|passwd|token|secret|api.?key|authorization|credential|endpoint|username/i

export class ClaudeSafetyError extends Error {
  constructor(message) {
    super(message)
    this.name='ClaudeSafetyError'
  }
}

function escaped(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')
}

function secretEntry(secret) {
  if(secret&&typeof secret==='object')return{kind:String(secret.kind||''),value:String(secret.value||'')}
  const value=String(secret||'')
  return{kind:/^https?:\/\//i.test(value)?'endpoint':'credential',value}
}

export function redactSensitiveText(value,{secrets=[]}={}) {
  let text=String(value)
    .replace(/\bBearer\s+[A-Za-z0-9._~+/=-]+/gi,'Bearer [REDACTED]')
    .replace(/\b(password|passwd|token|secret|api[_-]?key|authorization|credential|endpoint|username)\s*[:=]\s*(?:"[^"]*"|'[^']*'|[^\s,;]+)/gi,'$1=[REDACTED]')
    .replace(/\bhttps?:\/\/[^\s<>()\[\]{}"'@/:]+:[^\s<>()\[\]{}"'@]+@[^\s<>()\[\]{}"']+/gi,'[REDACTED_URL]')
  const ordered=secrets.map(secretEntry).filter(entry=>entry.value)
    .sort((left,right)=>right.value.length-left.value.length)
  for(const {kind,value:secret} of ordered) {
    if(kind==='endpoint')text=text.split(secret).join('[REDACTED]')
    else if(secret.length>=4)text=text.replace(new RegExp(`(?<![\\p{L}\\p{N}_-])${escaped(secret)}(?![\\p{L}\\p{N}_-])`,'gu'),'[REDACTED]')
  }
  return text
}

export function sanitizeClaudeValue(value,{secrets=[],path='上下文'}={}) {
  if(value===null||typeof value==='boolean')return value
  if(typeof value==='string')return redactSensitiveText(value,{secrets})
  if(typeof value==='number') {
    if(!Number.isFinite(value))throw new ClaudeSafetyError(`${path}包含无效数字`)
    return value
  }
  if(Array.isArray(value))return value.map((item,index)=>sanitizeClaudeValue(item,{secrets,path:`${path}[${index}]`}))
  if(!value||typeof value!=='object'||Object.getPrototypeOf(value)!==Object.prototype)
    throw new ClaudeSafetyError(`${path}必须是普通 JSON 对象`)
  const result={}
  for(const key of Object.keys(value)) {
    if(SENSITIVE_KEY.test(key))throw new ClaudeSafetyError(`${path}包含敏感字段`)
    Object.defineProperty(result,key,{
      value:sanitizeClaudeValue(value[key],{secrets,path:`${path}.${key}`}),
      enumerable:true,writable:true,configurable:true,
    })
  }
  return result
}
