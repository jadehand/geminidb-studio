import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

import { createClaudeAssistantApi } from './claude-assistant-api.mjs'
import { createClaudeAssistantStore } from './claude-assistant-store.mjs'

const owner=bulkIdentity=>({bulkIdentity})
const connectionSession={bulkIdentity:'one',endpoint:'https://db.example:8635',username:'alice',password:'swordfish'}
const temporary=()=>mkdtemp(join(tmpdir(),'gdb-claude-api-'))

async function setup(t,chat=async()=>({content:'建议',usage:{}})) {
  const dataDir=await temporary()
  t.after(()=>rm(dataDir,{recursive:true,force:true}))
  const store=createClaudeAssistantStore({dataDir})
  await store.init()
  return{store,api:createClaudeAssistantApi({store,cli:{chat}})}
}

test('creates, lists, renames, reads, and deletes an owned session',async t=>{
  const {api}=await setup(t)
  const created=await api.handle({pathname:'/claude/sessions',method:'POST',session:owner('one'),payload:{title:'会话'}})
  assert.equal(created.status,201)
  const id=created.payload.id
  assert.deepEqual((await api.handle({pathname:'/claude/sessions',method:'GET',session:owner('one')})).payload.map(item=>item.id),[id])
  assert.equal((await api.handle({pathname:`/claude/sessions/${id}`,method:'PATCH',session:owner('one'),payload:{title:'新标题'}})).payload.title,'新标题')
  assert.equal((await api.handle({pathname:`/claude/sessions/${id}`,method:'GET',session:owner('one')})).payload.title,'新标题')
  assert.equal((await api.handle({pathname:`/claude/sessions/${id}`,method:'DELETE',session:owner('one')})).status,204)
})

test('message submission persists the user message and assistant reply',async t=>{
  let received
  const {api}=await setup(t,async request=>{received=request;return{content:'建议',usage:{}}})
  const session=(await api.handle({pathname:'/claude/sessions',method:'POST',session:owner('one'),payload:{title:'会话'}})).payload
  const result=await api.handle({
    pathname:`/claude/sessions/${session.id}/messages`,method:'POST',session:owner('one'),
    payload:{content:'帮我解释',attachments:{sql:'SELECT 1'}},
  })
  assert.equal(result.status,200)
  assert.deepEqual(result.payload.messages.map(message=>message.role),['user','assistant'])
  assert.deepEqual(received.messages.map(message=>message.content),['帮我解释'])
  assert.deepEqual(received.attachments,{sql:'SELECT 1'})
})

test('keeps the user message but no assistant message when Claude fails',async t=>{
  const {api}=await setup(t,async()=>{throw Object.assign(new Error('failed'),{code:'CLAUDE_CLI_FAILED'})})
  const session=(await api.handle({pathname:'/claude/sessions',method:'POST',session:owner('one'),payload:{}})).payload
  await assert.rejects(()=>api.handle({
    pathname:`/claude/sessions/${session.id}/messages`,method:'POST',session:owner('one'),payload:{content:'保留我'},
  }))
  const restored=(await api.handle({pathname:`/claude/sessions/${session.id}`,method:'GET',session:owner('one')})).payload
  assert.deepEqual(restored.messages.map(message=>message.role),['user'])
})

test('keeps local history across login sessions and rejects a second in-flight message',async t=>{
  let release,started
  const wait=new Promise(resolve=>{release=resolve})
  const entered=new Promise(resolve=>{started=resolve})
  const {api}=await setup(t,async()=>{started();await wait;return{content:'done',usage:{}}})
  const session=(await api.handle({pathname:'/claude/sessions',method:'POST',session:owner('one'),payload:{}})).payload
  assert.equal(
    (await api.handle({pathname:`/claude/sessions/${session.id}`,method:'GET',session:owner('two')})).payload.id,
    session.id,
  )
  const first=api.handle({pathname:`/claude/sessions/${session.id}/messages`,method:'POST',session:owner('one'),payload:{content:'first'}})
  await entered
  await assert.rejects(
    ()=>api.handle({pathname:`/claude/sessions/${session.id}/messages`,method:'POST',session:owner('one'),payload:{content:'second'}}),
    error=>error.code==='CLAUDE_SESSION_BUSY'&&error.status===409,
  )
  release()
  await first
})

test('claims the in-flight session lock before the first await',async t=>{
  let release
  const wait=new Promise(resolve=>{release=resolve})
  const {api}=await setup(t,async()=>{await wait;return{content:'done',usage:{}}})
  const session=(await api.handle({pathname:'/claude/sessions',method:'POST',session:owner('one'),payload:{}})).payload
  const path=`/claude/sessions/${session.id}/messages`
  const resultsPromise=Promise.allSettled([
    api.handle({pathname:path,method:'POST',session:owner('one'),payload:{content:'first'}}),
    api.handle({pathname:path,method:'POST',session:owner('one'),payload:{content:'second'}}),
  ])
  await new Promise(resolve=>setImmediate(resolve))
  release()
  const results=await resultsPromise
  assert.equal(results.filter(item=>item.status==='fulfilled').length,1)
  assert.equal(results.filter(item=>item.status==='rejected'&&item.reason.code==='CLAUDE_SESSION_BUSY').length,1)
})

test('removes connection secrets before persistence and Claude invocation',async t=>{
  let received
  const {api}=await setup(t,async request=>{received=request;return{content:'safe',usage:{}}})
  const session=(await api.handle({pathname:'/claude/sessions',method:'POST',session:connectionSession,payload:{title:'会话'}})).payload
  const result=await api.handle({
    pathname:`/claude/sessions/${session.id}/messages`,method:'POST',session:connectionSession,
    payload:{content:'endpoint https://db.example:8635 user alice password swordfish',attachments:{error:'https://db.example:8635'}},
  })
  const encoded=JSON.stringify({received,result})
  for(const secret of ['db.example','alice','swordfish'])assert.equal(encoded.includes(secret),false)
})

test('rejects per-request executable overrides',async t=>{
  const {api}=await setup(t)
  const session=(await api.handle({pathname:'/claude/sessions',method:'POST',session:owner('one'),payload:{}})).payload
  await assert.rejects(()=>api.handle({
    pathname:`/claude/sessions/${session.id}/messages`,method:'POST',session:owner('one'),
    payload:{content:'hello',cliPath:'powershell'},
  }),error=>error.code==='CLAUDE_INPUT_INVALID')
})

test('bounds long session history before invoking Claude',async t=>{
  let received
  const {api,store}=await setup(t,async request=>{received=request;return{content:'done',usage:{}}})
  const session=(await api.handle({pathname:'/claude/sessions',method:'POST',session:owner('one'),payload:{}})).payload
  for(let index=0;index<100;index++)await store.append('local',session.id,{role:index%2?'assistant':'user',content:`message-${index}`})
  await api.handle({pathname:`/claude/sessions/${session.id}/messages`,method:'POST',session:owner('one'),payload:{content:'latest'}})
  assert.ok(received.messages.length<=100)
  assert.equal(received.messages.at(-1).content,'latest')
})
