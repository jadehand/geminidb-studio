import assert from 'node:assert/strict'
import test from 'node:test'

import { ClaudeCliError } from './claude-cli.mjs'
import { createClaudeDiagnostics, normalizeClaudeDiagnosis } from './claude-diagnostics.mjs'

test('diagnosis delegates to local CLI with SQL error and Schema attachments',async()=>{
  let request
  const diagnostics=createClaudeDiagnostics({cli:{
    probe:async()=>({ready:true,kind:'ready',version:'1.0',message:'ok'}),
    chat:async value=>{
      request=value
      return{content:'```json\n{"summary":"ok","problems":[],"fixedSql":"SELECT 1","performanceAdvice":[],"risk":"read"}\n```',usage:{}}
    },
  }})
  const context={sql:'SELECT 1',error:'timeout',schema:{fields:[],tags:[]}}
  const result=await diagnostics.diagnose({settings:{cliPath:'powershell'},context})
  assert.equal('cliPath' in request,false)
  assert.deepEqual(request.attachments,context)
  assert.equal(request.messages.length,1)
  assert.match(request.messages[0].content,/诊断/)
  assert.deepEqual(result,{
    summary:'ok',problems:[],fixedSql:'SELECT 1',performanceAdvice:[],risk:'read',usage:{},
  })
})

test('probe preserves local CLI readiness details',async()=>{
  const diagnostics=createClaudeDiagnostics({cli:{probe:async()=>({
    ready:false,kind:'not_authenticated',version:'1.0',message:'Claude CLI 尚未登录',
  })}})
  assert.deepEqual(await diagnostics.probe({cliPath:'powershell'}),{
    ready:false,kind:'not_authenticated',version:'1.0',message:'Claude CLI 尚未登录',
  })
})

test('normalizes the existing Claude diagnosis response shape',()=>{
  assert.deepEqual(normalizeClaudeDiagnosis({},'SELECT *'),{
    summary:'诊断完成',problems:[],fixedSql:'SELECT *',performanceAdvice:[],risk:'read',usage:undefined,
  })
})

test('maps local CLI errors to stable diagnosis errors',async()=>{
  for(const [source,expected] of [
    ['CLAUDE_CANCELLED','DIAGNOSIS_CANCELLED'],
    ['CLAUDE_TIMEOUT','CLAUDE_TIMEOUT'],
    ['CLAUDE_CLI_START_FAILED','CLAUDE_CLI_START_FAILED'],
    ['CLAUDE_CLI_FAILED','CLAUDE_CLI_FAILED'],
    ['CLAUDE_OUTPUT_LIMIT','CLAUDE_OUTPUT_LIMIT'],
  ]) {
    const diagnostics=createClaudeDiagnostics({cli:{chat:async()=>{throw new ClaudeCliError(502,source,'safe')}}})
    await assert.rejects(()=>diagnostics.diagnose({context:{sql:'SELECT 1'}}),error=>error.code===expected)
  }
})
