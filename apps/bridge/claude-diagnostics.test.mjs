import test from 'node:test'
import assert from 'node:assert/strict'
import { createClaudeDiagnostics, normalizeClaudeDiagnosis } from './claude-diagnostics.mjs'

test('CLI diagnosis uses provider request shape with no tools',async()=>{
  let request
  const diagnostics=createClaudeDiagnostics({provider:{probe:async()=>{},complete:async value=>{
    request=value
    return{content:'```json\n{"summary":"ok","problems":[],"fixedSql":"SELECT 1","performanceAdvice":[],"risk":"read"}\n```'}
  }}})
  const result=await diagnostics.diagnose({settings:{provider:'cli',cliPath:'custom'},context:{sql:'SELECT 1'}})
  assert.equal(request.provider,'cli')
  assert.equal(request.settings.cliPath,'custom')
  assert.deepEqual(request.messages,[{role:'user',content:'{"sql":"SELECT 1"}'}])
  assert.deepEqual(request.tools,[])
  assert.match(request.system,/不得调用工具/)
  assert.deepEqual(result,{
    summary:'ok',
    problems:[],
    fixedSql:'SELECT 1',
    performanceAdvice:[],
    risk:'read',
    usage:{},
  })
})

test('API diagnosis merges top-level API key and preserves usage',async()=>{
  let request
  const diagnostics=createClaudeDiagnostics({provider:{probe:async()=>{},complete:async value=>{
    request=value
    return{content:'{"summary":"api","risk":"write"}',usage:{inputTokens:2,outputTokens:3}}
  }}})
  const result=await diagnostics.diagnose({apiKey:'secret',settings:{provider:'api'},context:{sql:'WRITE x'}})
  assert.equal(request.provider,'api')
  assert.equal(request.settings.apiKey,'secret')
  assert.equal(request.settings.endpoint,'https://api.anthropic.com')
  assert.deepEqual(request.tools,[])
  assert.deepEqual(result.usage,{inputTokens:2,outputTokens:3})
})

test('normalizes the legacy Claude diagnosis shape',()=>{
  assert.deepEqual(normalizeClaudeDiagnosis({},'SELECT *'),{
    summary:'诊断完成',problems:[],fixedSql:'SELECT *',performanceAdvice:[],risk:'read',usage:undefined,
  })
})

test('maps provider failures to legacy errors',async()=>{
  const cases=[
    ['AGENT_PROVIDER_MISCONFIGURED','CLAUDE_KEY_REQUIRED'],
    ['AGENT_PROVIDER_INVALID_SETTINGS','CLAUDE_ENDPOINT_INVALID'],
    ['AGENT_CANCELLED','DIAGNOSIS_CANCELLED'],
    ['AGENT_TIMEOUT','CLAUDE_TIMEOUT'],
    ['AGENT_PROVIDER_API_ERROR','CLAUDE_API_ERROR'],
    ['AGENT_MODEL_INVALID_RESPONSE','CLAUDE_INVALID_RESPONSE'],
    ['AGENT_OUTPUT_LIMIT','CLAUDE_OUTPUT_LIMIT'],
    ['INVALID','CLAUDE_INVALID_RESPONSE'],
    ['TIMEOUT','CLAUDE_TIMEOUT'],
    ['CANCELLED','DIAGNOSIS_CANCELLED'],
    ['API','CLAUDE_API_ERROR'],
  ]
  for(const [source,expected] of cases) {
    const diagnostics=createClaudeDiagnostics({provider:{complete:async()=>{throw Object.assign(new Error('safe'),{code:source,status:418})}}})
    await assert.rejects(()=>diagnostics.diagnose({settings:{provider:'api'},apiKey:'x'}),error=>error.code===expected)
  }
})

test('probe returns legacy shape and treats unknown authentication as ready',async()=>{
  for(const [providerResult,ready] of [
    [{ready:false,kind:'authentication_unknown',version:'1.0',message:'opaque message'},true],
    [{ready:false,kind:'not_authenticated',version:'1.0',message:'Claude CLI 登录状态无法确认'},false],
    [{ready:false,kind:'not_authenticated',version:'1.0',message:'Claude CLI 尚未登录'},false],
  ]) {
    const diagnostics=createClaudeDiagnostics({provider:{probe:async()=>providerResult}})
    assert.deepEqual(await diagnostics.probe({provider:'cli'}),{
      ready,version:'1.0',message:providerResult.message,
    })
  }
})

test('diagnosis defaults and clamps maxTokens',async()=>{
  for(const [maxTokens,expected] of [[undefined,2048],[1,512],[99999,8192]]) {
    let actual
    const diagnostics=createClaudeDiagnostics({provider:{complete:async request=>{
      actual=request.settings.maxTokens
      return{content:'{}'}
    }}})
    await diagnostics.diagnose({settings:{provider:'api',maxTokens},apiKey:'x'})
    assert.equal(actual,expected)
  }
})

test('maps safe CLI unavailable cause codes without leaking messages',async()=>{
  for(const causeCode of ['CLAUDE_CLI_START_FAILED','CLAUDE_CLI_FAILED']) {
    const diagnostics=createClaudeDiagnostics({provider:{complete:async()=>{
      throw Object.assign(new Error('authorization: Bearer secret'),{
        code:'AGENT_PROVIDER_UNAVAILABLE',details:{causeCode},
      })
    }}})
    await assert.rejects(()=>diagnostics.diagnose({settings:{provider:'cli'}}),error=>{
      assert.equal(error.code,causeCode)
      assert.doesNotMatch(error.message,/secret/)
      return true
    })
  }
})
