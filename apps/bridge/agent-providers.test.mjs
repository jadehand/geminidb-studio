import test from 'node:test'
import assert from 'node:assert/strict'
import { createAgentProvider } from './agent-providers.mjs'

const tools=[{name:'get_schema',description:'Read schema',input_schema:{type:'object'}}]

test('CLI uses locked-down arguments and normalizes structured tool call',async()=>{
  const calls=[]
  const provider=createAgentProvider({runProcess:async(...args)=>{
    calls.push(args)
    return{stdout:JSON.stringify({structured_output:{kind:'tool_call',content:'read',callId:'c1',tool:'get_schema',input:{measurement:'cpu'}}})}
  }})
  const result=await provider.complete({provider:'cli',settings:{cliPath:'claude',timeoutMs:12345},messages:[],tools},new AbortController().signal)
  assert.deepEqual(result,{kind:'tool_call',content:'read',callId:'c1',tool:'get_schema',input:{measurement:'cpu'}})
  assert.deepEqual(calls[0][1].slice(0,9),['-p','--tools','','--permission-mode','dontAsk','--no-session-persistence','--output-format','json','--json-schema'])
  assert.equal(calls[0][3],12345)
  await provider.complete({provider:'cli',settings:{},messages:[]})
  assert.equal(calls[1][3],90000)
})

test('API normalizes Anthropic tool_use and usage',async()=>{
  const provider=createAgentProvider({runProcess:async()=>assert.fail(),fetchImpl:async(url,options)=>{
    assert.match(url,/^https:/)
    assert.equal(options.headers['x-api-key'],'secret')
    return new Response(JSON.stringify({content:[{type:'text',text:'先读取结构'},{type:'tool_use',id:'toolu_1',name:'get_schema',input:{measurement:'cpu'}}],usage:{input_tokens:10,output_tokens:4}}),{status:200})
  }})
  const result=await provider.complete({provider:'api',settings:{endpoint:'https://api.anthropic.com',apiKey:'secret',model:'claude'},messages:[],tools})
  assert.deepEqual(result.usage,{inputTokens:10,outputTokens:4})
  assert.equal(result.callId,'toolu_1')
})

test('API can read its key from the local Bridge environment provider',async()=>{
  let header
  const provider=createAgentProvider({
    runProcess:async()=>assert.fail(),
    apiKeyProvider:()=> 'local-key',
    fetchImpl:async(_url,options)=>{
      header=options.headers['x-api-key']
      return new Response('{"content":[],"stop_reason":"end_turn"}',{status:200})
    },
  })
  assert.equal((await provider.probe({provider:'api',endpoint:'https://api.anthropic.com'})).ready,true)
  await provider.complete({provider:'api',settings:{endpoint:'https://api.anthropic.com'},messages:[]})
  assert.equal(header,'local-key')
})

test('API normalizes assistant_message, final, and tool_call responses',async()=>{
  const payloads=[
    {content:[{type:'text',text:'继续'}],stop_reason:'max_tokens'},
    {content:[{type:'text',text:'完成'}],stop_reason:'end_turn'},
    {content:[{type:'tool_use',id:'c1',name:'get_schema',input:{name:'cpu'}}]},
  ]
  const provider=createAgentProvider({runProcess:async()=>{},fetchImpl:async()=>new Response(JSON.stringify(payloads.shift()),{status:200})})
  const request={provider:'api',settings:{endpoint:'https://example.com',apiKey:'key'},messages:[]}
  assert.equal((await provider.complete(request)).kind,'assistant_message')
  assert.equal((await provider.complete(request)).kind,'final')
  assert.deepEqual(await provider.complete(request),{kind:'tool_call',content:'',callId:'c1',tool:'get_schema',input:{name:'cpu'}})
})

test('API rejects HTTP endpoints',async()=>{
  const provider=createAgentProvider({runProcess:async()=>{},fetchImpl:async()=>assert.fail('fetch must not run')})
  await assert.rejects(provider.complete({provider:'api',settings:{endpoint:'http://example.com',apiKey:'key'},messages:[]}),{
    code:'AGENT_PROVIDER_INVALID_SETTINGS',
  })
  for(const providerName of ['cli','api']) {
    for(const timeoutMs of [NaN,0,-1,300001,'1000']) {
      await assert.rejects(provider.complete({provider:providerName,settings:{endpoint:'https://example.com',apiKey:'key',timeoutMs},messages:[]}),{
        code:'AGENT_PROVIDER_INVALID_SETTINGS',
      })
    }
  }
})

test('API rejects polluted endpoints and normalizes the messages URL',async()=>{
  for(const endpoint of ['https://user@example.com','https://example.com?x=1','https://example.com/#x']) {
    const provider=createAgentProvider({runProcess:async()=>{},fetchImpl:async()=>assert.fail('fetch must not run')})
    await assert.rejects(provider.complete({provider:'api',settings:{endpoint,apiKey:'key'},messages:[]}),{
      code:'AGENT_PROVIDER_INVALID_SETTINGS',
    })
  }
  let actual
  const provider=createAgentProvider({runProcess:async()=>{},fetchImpl:async url=>{
    actual=url
    return new Response('{"content":[]}',{status:200})
  }})
  await provider.complete({provider:'api',settings:{endpoint:'https://example.com/proxy///',apiKey:'key'},messages:[]})
  assert.equal(actual,'https://example.com/proxy/v1/messages')
  await provider.complete({provider:'api',settings:{endpoint:'https://example.com/',apiKey:'key'},messages:[]})
  assert.equal(actual,'https://example.com/v1/messages')
})

test('API bounds streamed responses and rejects non-JSON',async()=>{
  let cancelled=false
  const oversized=new ReadableStream({
    pull(controller) { controller.enqueue(new Uint8Array(1_000_001)) },
    cancel() { cancelled=true },
  })
  const payloads=[new Response(oversized,{status:200}),new Response('not json',{status:200})]
  const provider=createAgentProvider({runProcess:async()=>{},fetchImpl:async()=>payloads.shift()})
  const request={provider:'api',settings:{endpoint:'https://example.com',apiKey:'key'},messages:[]}
  await assert.rejects(provider.complete(request),{code:'AGENT_OUTPUT_LIMIT',status:502})
  assert.equal(cancelled,true)
  await assert.rejects(provider.complete(request),{code:'AGENT_MODEL_INVALID_RESPONSE',status:502})
})

test('API rejects multiple tool_use blocks',async()=>{
  const content=[
    {type:'tool_use',id:'c1',name:'get_schema',input:{}},
    {type:'tool_use',id:'c2',name:'get_schema',input:{}},
  ]
  const provider=createAgentProvider({runProcess:async()=>{},fetchImpl:async()=>new Response(JSON.stringify({content}),{status:200})})
  await assert.rejects(provider.complete({provider:'api',settings:{endpoint:'https://example.com',apiKey:'key'},messages:[]}),{
    code:'AGENT_MODEL_INVALID_RESPONSE',
  })
})

test('API rejects incomplete tool calls',async()=>{
  for(const tool of [
    {type:'tool_use',name:'get_schema',input:{}},
    {type:'tool_use',id:'c1',input:{}},
    {type:'tool_use',id:'c1',name:'get_schema'},
  ]) {
    const provider=createAgentProvider({runProcess:async()=>{},fetchImpl:async()=>new Response(JSON.stringify({content:[tool]}),{status:200})})
    await assert.rejects(provider.complete({provider:'api',settings:{endpoint:'https://example.com',apiKey:'key'},messages:[]}),{
      code:'AGENT_MODEL_INVALID_RESPONSE',
    })
  }
})

test('probe reports CLI not authenticated',async()=>{
  const provider=createAgentProvider({runProcess:async(_command,args)=>args[0]==='--version'?{stdout:'Claude Code 1.0'}:{stdout:'{"loggedIn":false}'}})
  assert.deepEqual(await provider.probe({provider:'cli'}),{
    ready:false,kind:'not_authenticated',version:'Claude Code 1.0',message:'Claude CLI 尚未登录',
  })
})

test('probe reports stable unknown authentication for command and JSON failures',async()=>{
  for(const failure of ['command','json']) {
    const provider=createAgentProvider({runProcess:async(_command,args)=>{
      if(args[0] === '--version')return{stdout:'Claude Code 1.0'}
      if(failure === 'command')throw new Error('auth status failed')
      return{stdout:'not json'}
    }})
    assert.deepEqual(await provider.probe({provider:'cli'}),{
      ready:false,
      kind:'authentication_unknown',
      version:'Claude Code 1.0',
      message:'Claude CLI 登录状态无法确认',
    })
  }
})

test('rejects bad CLI JSON and invalid tool input',async()=>{
  for(const stdout of ['bad json',JSON.stringify({kind:'tool_call',content:'',callId:'x',tool:'get_schema',input:[]})]) {
    const provider=createAgentProvider({runProcess:async()=>({stdout})})
    await assert.rejects(provider.complete({provider:'cli',settings:{},messages:[]}),{code:'AGENT_MODEL_INVALID_RESPONSE'})
  }
})

test('API returns structured HTTP errors without leaking key',async()=>{
  const provider=createAgentProvider({runProcess:async()=>{},fetchImpl:async()=>new Response(JSON.stringify({error:{type:'invalid_top-secret_error',message:'bad top-secret authorization: Bearer token-value'}}),{status:400})})
  await assert.rejects(provider.complete({provider:'api',settings:{endpoint:'https://example.com',apiKey:'top-secret'},messages:[]}),error=>{
    assert.equal(error.code,'AGENT_PROVIDER_API_ERROR')
    assert.equal(error.details.type,'invalid_[REDACTED]_error')
    assert.doesNotMatch(error.message,/top-secret/)
    assert.doesNotMatch(error.message,/token-value/)
    assert.match(error.message,/\[REDACTED\]/)
    assert.doesNotMatch(JSON.stringify(error.details),/top-secret/)
    return true
  })
})

test('API reports non-JSON HTTP errors as provider API errors',async()=>{
  const provider=createAgentProvider({runProcess:async()=>{},fetchImpl:async()=>new Response('<html>bad gateway</html>',{
    status:502,
    headers:{'content-type':'text/html'},
  })})
  await assert.rejects(provider.complete({provider:'api',settings:{endpoint:'https://example.com/proxy',apiKey:'key'},messages:[]}),{
    code:'AGENT_PROVIDER_API_ERROR',
    status:502,
    message:'Anthropic API HTTP 502',
    details:{type:'api_error'},
  })
})

test('distinguishes cancellation and timeout aborts',async()=>{
  const cancelled=new AbortController()
  cancelled.abort()
  const cli=createAgentProvider({runProcess:async()=>{throw Object.assign(new Error('aborted'),{name:'AbortError'})}})
  await assert.rejects(cli.complete({provider:'cli',settings:{},messages:[]},cancelled.signal),{code:'AGENT_CANCELLED'})
  const diagnosed=createAgentProvider({runProcess:async()=>{throw Object.assign(new Error('cancelled'),{code:'DIAGNOSIS_CANCELLED'})}})
  await assert.rejects(diagnosed.complete({provider:'cli',settings:{},messages:[]},cancelled.signal),{code:'AGENT_CANCELLED'})
  for(const error of [
    Object.assign(new Error('late'),{code:'CLAUDE_TIMEOUT'}),
    Object.assign(new Error('late'),{name:'TimeoutError'}),
  ]) {
    const timedOut=createAgentProvider({runProcess:async()=>{throw error}})
    await assert.rejects(timedOut.complete({provider:'cli',settings:{},messages:[]}),{code:'AGENT_TIMEOUT'})
  }
  const limited=createAgentProvider({runProcess:async()=>{throw Object.assign(new Error('large'),{code:'CLAUDE_OUTPUT_LIMIT'})}})
  await assert.rejects(limited.complete({provider:'cli',settings:{},messages:[]}),{code:'AGENT_OUTPUT_LIMIT'})
  const unavailable=createAgentProvider({runProcess:async()=>{throw Object.assign(new Error('authorization: Bearer secret-value'),{code:'CLAUDE_CLI_FAILED'})}})
  await assert.rejects(unavailable.complete({provider:'cli',settings:{},messages:[]}),error=>{
    assert.equal(error.code,'AGENT_PROVIDER_UNAVAILABLE')
    assert.equal(error.details.causeCode,'CLAUDE_CLI_FAILED')
    assert.doesNotMatch(error.message,/secret-value/)
    return true
  })
  const api=createAgentProvider({runProcess:async()=>{},fetchImpl:async(_url,{signal})=>new Promise((_resolve,reject)=>{
    signal.addEventListener('abort',()=>reject(Object.assign(new Error('aborted'),{name:'AbortError'})),{once:true})
  })})
  const external=new AbortController()
  const cancelledRequest=api.complete({provider:'api',settings:{endpoint:'https://example.com',apiKey:'key',timeoutMs:1000},messages:[]},external.signal)
  external.abort()
  await assert.rejects(cancelledRequest,{code:'AGENT_CANCELLED'})
  await assert.rejects(api.complete({provider:'api',settings:{endpoint:'https://example.com',apiKey:'key',timeoutMs:15},messages:[]}),{code:'AGENT_TIMEOUT'})
})

test('external cancellation remains the first abort reason through delayed rejection',async()=>{
  let aborts=0
  const api=createAgentProvider({runProcess:async()=>{},fetchImpl:async(_url,{signal})=>new Promise((_resolve,reject)=>{
    signal.addEventListener('abort',()=>{
      aborts++
      setTimeout(()=>reject(Object.assign(new Error('late abort'),{name:'AbortError'})),30)
    },{once:true})
  })})
  const external=new AbortController()
  const pending=api.complete({provider:'api',settings:{endpoint:'https://example.com',apiKey:'key',timeoutMs:10},messages:[]},external.signal)
  external.abort()
  await assert.rejects(pending,{code:'AGENT_CANCELLED'})
  external.abort()
  await new Promise(resolve=>setTimeout(resolve,20))
  assert.equal(aborts,1)
})
