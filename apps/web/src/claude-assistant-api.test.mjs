import assert from 'node:assert/strict'
import test from 'node:test'

import { BridgeError } from './api.ts'
import { createClaudeAssistantClient } from './claude-assistant-api.ts'

function response(body,status=200) {
  return new Response(status===204?null:JSON.stringify(body),{
    status,headers:{'Content-Type':'application/json'},
  })
}

test('uses the Claude session CRUD routes with bearer authentication',async()=>{
  const calls=[]
  const client=createClaudeAssistantClient({
    fetchImpl:async (url,init)=>{calls.push({url,init});return response(url.endsWith('/sessions')?[]:{id:'one'})},
    apiBase:()=>'/api',sessionId:()=> 'token',
  })
  await client.listSessions()
  await client.createSession('新会话')
  await client.getSession('one')
  await client.renameSession('one','新标题')
  await client.deleteSession('one')
  assert.deepEqual(calls.map(call=>call.url),[
    '/api/claude/sessions','/api/claude/sessions','/api/claude/sessions/one',
    '/api/claude/sessions/one','/api/claude/sessions/one',
  ])
  assert.equal(calls.every(call=>call.init.headers.Authorization==='Bearer token'),true)
  assert.equal(calls[4].init.method,'DELETE')
})

test('sendMessage posts only content and explicit attachments and forwards cancellation',async()=>{
  let call
  const controller=new AbortController()
  const client=createClaudeAssistantClient({
    fetchImpl:async (url,init)=>{call={url,init};return response({id:'one',messages:[]})},
    apiBase:()=>'/api',sessionId:()=> 'token',
  })
  await client.sendMessage('one',{content:'解释',attachments:{sql:'SELECT 1'}},controller.signal)
  assert.equal(call.url,'/api/claude/sessions/one/messages')
  assert.deepEqual(JSON.parse(call.init.body),{content:'解释',attachments:{sql:'SELECT 1'}})
  assert.equal(call.init.signal,controller.signal)
})

test('returns undefined for delete and redacts the bearer token from structured errors',async()=>{
  const deleted=createClaudeAssistantClient({fetchImpl:async()=>response(null,204),apiBase:()=>'',sessionId:()=> 'secret'})
  assert.equal(await deleted.deleteSession('one'),undefined)

  const failing=createClaudeAssistantClient({
    fetchImpl:async()=>response({message:'failed secret',code:'BAD',details:{nested:'secret'}},400),
    apiBase:()=>'',sessionId:()=> 'secret',
  })
  await assert.rejects(()=>failing.listSessions(),error=>{
    assert.equal(error instanceof BridgeError,true)
    assert.equal(error.message,'failed [REDACTED]')
    assert.deepEqual(error.details,{nested:'[REDACTED]'})
    return true
  })
})

test('sendMessageStream consumes NDJSON progress, deltas, and completion',async()=>{
  const events=[]
  const encoder=new TextEncoder()
  const body=new ReadableStream({start(controller){
    controller.enqueue(encoder.encode('{"type":"stage","stage":"generating"}\n{"type":"delta","text":"你好"}\n'))
    controller.enqueue(encoder.encode('{"type":"complete","session":{"id":"one","messages":[]}}\n'))
    controller.close()
  }})
  const client=createClaudeAssistantClient({
    fetchImpl:async()=>new Response(body,{status:200,headers:{'Content-Type':'application/x-ndjson'}}),
    apiBase:()=>'/api',sessionId:()=>'',
  })
  const session=await client.sendMessageStream('one',{content:'解释'},event=>events.push(event))
  assert.deepEqual(events.map(event=>event.type),['stage','delta','complete'])
  assert.equal(session.id,'one')
})

test('loads and saves the application-level Claude CLI path',async()=>{
  const calls=[]
  const client=createClaudeAssistantClient({
    fetchImpl:async (url,init)=>{calls.push({url,init});return response({cliPath:'C:/Tools/claude.exe'})},
    apiBase:()=>'/api',sessionId:()=>'',
  })
  assert.deepEqual(await client.getSettings(),{cliPath:'C:/Tools/claude.exe'})
  await client.saveSettings('C:/Tools/claude.exe')
  assert.deepEqual(calls.map(call=>[call.url,call.init.method??'GET']),[
    ['/api/claude/settings','GET'],['/api/claude/settings','PATCH'],
  ])
  assert.deepEqual(JSON.parse(calls[1].init.body),{cliPath:'C:/Tools/claude.exe'})
})
