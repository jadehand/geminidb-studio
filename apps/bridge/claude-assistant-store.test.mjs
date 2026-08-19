import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

import { ClaudeAssistantStoreError, createClaudeAssistantStore } from './claude-assistant-store.mjs'

const temp=()=>mkdtemp(join(tmpdir(),'gdb-claude-store-'))
const ids=()=>{
  let value=0
  return()=>`00000000-0000-4000-8000-${String(++value).padStart(12,'0')}`
}

test('persists sessions and messages across store instances', async t => {
  const dataDir=await temp()
  t.after(()=>rm(dataDir,{recursive:true,force:true}))
  const randomUUID=ids()
  const first=createClaudeAssistantStore({dataDir,randomUUID,now:()=>1_700_000_000_000})
  await first.init()
  const session=await first.create('owner-1',{title:'查询诊断'})
  await first.append('owner-1',session.id,{
    role:'user',content:'看看这个 SQL',attachments:{sql:'SELECT 1',error:'timeout',schema:{fields:[],tags:[]}},
  })
  await first.append('owner-1',session.id,{role:'assistant',content:'建议增加时间条件'})

  const second=createClaudeAssistantStore({dataDir})
  await second.init()
  const restored=await second.get('owner-1',session.id)
  assert.equal(restored.title,'查询诊断')
  assert.deepEqual(restored.messages.map(message=>message.role),['user','assistant'])
  assert.equal(restored.messages[0].attachments.sql,'SELECT 1')
  assert.deepEqual((await second.list('owner-1')).map(item=>item.id),[session.id])
})

test('isolates owners and supports rename and delete', async t => {
  const dataDir=await temp()
  t.after(()=>rm(dataDir,{recursive:true,force:true}))
  const store=createClaudeAssistantStore({dataDir,randomUUID:ids()})
  await store.init()
  const first=await store.create('owner-1',{title:'First'})
  const second=await store.create('owner-2',{title:'Second'})
  await assert.rejects(()=>store.get('owner-1',second.id),error=>error.code==='CLAUDE_SESSION_NOT_FOUND')
  assert.equal((await store.rename('owner-1',first.id,'重命名')).title,'重命名')
  await store.remove('owner-1',first.id)
  assert.deepEqual(await store.list('owner-1'),[])
  assert.equal((await store.get('owner-2',second.id)).title,'Second')
})

test('rejects credentials, invalid roles, and oversized text before writing', async t => {
  const dataDir=await temp()
  t.after(()=>rm(dataDir,{recursive:true,force:true}))
  const store=createClaudeAssistantStore({dataDir,randomUUID:ids()})
  await store.init()
  const session=await store.create('owner-1',{title:'安全测试'})
  for(const message of [
    {role:'tool',content:'unsafe'},
    {role:'user',content:'x'.repeat(40_001)},
    {role:'user',content:'hello',attachments:{password:'secret'}},
    {role:'user',content:'hello',attachments:{schema:{apiKey:'secret'}}},
  ]) {
    await assert.rejects(
      ()=>store.append('owner-1',session.id,message),
      error=>error instanceof ClaudeAssistantStoreError && error.code==='CLAUDE_HISTORY_INVALID',
    )
  }
  assert.deepEqual((await store.get('owner-1',session.id)).messages,[])
})

test('redacts credentials from titles, messages, and error attachments',async t=>{
  const dataDir=await temp()
  t.after(()=>rm(dataDir,{recursive:true,force:true}))
  const store=createClaudeAssistantStore({dataDir,randomUUID:ids()})
  await store.init()
  const session=await store.create('owner-1',{title:'https://alice:swordfish@db.example:8635'})
  await store.append('owner-1',session.id,{
    role:'user',content:'password=swordfish at https://alice:swordfish@db.example:8635',
    attachments:{error:'endpoint=https://db.example:8635 password=swordfish'},
  })
  const encoded=JSON.stringify(await store.get('owner-1',session.id))
  for(const secret of ['alice','swordfish','db.example'])assert.equal(encoded.includes(secret),false)
})

test('quarantines a corrupt session without hiding valid history', async t => {
  const dataDir=await temp()
  t.after(()=>rm(dataDir,{recursive:true,force:true}))
  const store=createClaudeAssistantStore({dataDir,randomUUID:ids()})
  await store.init()
  const valid=await store.create('owner-1',{title:'Valid'})
  const corrupt=await store.create('owner-1',{title:'Corrupt'})
  await writeFile(join(dataDir,'claude-assistant','sessions',`${corrupt.id}.json`),'{broken','utf8')

  const restored=createClaudeAssistantStore({dataDir})
  await restored.init()
  assert.deepEqual((await restored.list('owner-1')).map(item=>item.id),[valid.id])
  const directory=await readFile(join(dataDir,'claude-assistant','index.json'),'utf8')
  assert.equal(directory.includes(corrupt.id),false)
})
