import { bridge, BridgeError } from './api'
import type { ClaudeDiagnosis, ClaudeSettings, MeasurementSchema } from './types'

export type DiagnosticContext={database:string;measurement:string;sql:string;error:string;schema:MeasurementSchema;localIssues:{level:string;message:string}[]}
export type ProviderStatus={ready:boolean;kind:'ready'|'not_installed'|'not_authenticated'|'rate_limited'|'quota_exhausted'|'misconfigured'|'network_error'|'unknown_error';message:string;version?:string}
export interface DiagnosticProvider{readonly id:'cli'|'api';probe():Promise<ProviderStatus>;diagnose(context:DiagnosticContext,signal:AbortSignal):Promise<ClaudeDiagnosis>}

export function classifyProviderError(error:unknown):ProviderStatus{
  const code=error instanceof BridgeError?error.code:'',message=error instanceof Error?error.message:'诊断服务不可用'
  if(/START_FAILED|not found|找不到|不是 Claude/i.test(`${code} ${message}`))return{ready:false,kind:'not_installed',message}
  if(/401|AUTH|登录/i.test(`${code} ${message}`))return{ready:false,kind:'not_authenticated',message}
  if(/429|RATE/i.test(`${code} ${message}`))return{ready:false,kind:'rate_limited',message}
  if(/credit|quota|额度|余额/i.test(message))return{ready:false,kind:'quota_exhausted',message}
  if(/KEY_REQUIRED|ENDPOINT_INVALID|400|403/i.test(`${code} ${message}`))return{ready:false,kind:'misconfigured',message}
  if(/fetch|network|网络|timeout|超时/i.test(`${code} ${message}`))return{ready:false,kind:'network_error',message}
  return{ready:false,kind:'unknown_error',message}
}

export function createDiagnosticProvider(settings:ClaudeSettings,apiKey=''):DiagnosticProvider{
  return{id:settings.provider,async probe(){if(settings.provider==='api')return apiKey?{ready:true,kind:'ready',message:'API Key 已配置'}:{ready:false,kind:'misconfigured',message:'请配置 API Key'};try{const result=await bridge.probeClaude(settings);return{...result,kind:result.ready?'ready':/登录/.test(result.message)?'not_authenticated':'not_installed'}}catch(error){return classifyProviderError(error)}},async diagnose(context,signal){try{return await bridge.ask(context,settings,apiKey,signal)}catch(error){const status=classifyProviderError(error);throw new BridgeError(status.message,status.kind,0)}}}
}
