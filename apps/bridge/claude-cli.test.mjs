import assert from 'node:assert/strict'
import test from 'node:test'

import { buildClaudeChatPrompt, ClaudeCliError, createClaudeCli, createClaudeStreamParser } from './claude-cli.mjs'

test('stream parser forwards real text deltas and keeps the final answer',()=>{
  const deltas=[]
  const parser=createClaudeStreamParser({onDelta:chunk=>deltas.push(chunk)})
  parser.push('{"type":"system","subtype":"init"}\n{"type":"stream_event","event":{"type":"content_block_delta","delta":{"type":"text_delta","text":"前半"}}}\n')
  parser.push('{"type":"stream_event","event":{"type":"content_block_delta","delta":{"type":"text_delta","text":"后半"}}}\n{"type":"result","subtype":"success","result":"前半后半"}\n')
  assert.deepEqual(deltas,['前半','后半'])
  assert.equal(parser.finish(),'前半后半')
})

test('stream parser handles JSON lines split across process chunks',()=>{
  const parser=createClaudeStreamParser()
  parser.push('{"type":"result","result":"完整')
  parser.push('回答"}\n')
  assert.equal(parser.finish(),'完整回答')
})

test('chat invokes only the local Claude executable with explicit attachments', async () => {
  const calls=[]
  const cli=createClaudeCli({runProcess:async (...args)=>{calls.push(args);return{stdout:'回答',stderr:''}}})

  const result=await cli.chat({
    messages:[{role:'user',content:'解释这个查询'}],
    attachments:{sql:'SELECT * FROM cpu',error:'timeout',schema:{fields:[{name:'usage',type:'float'}],tags:['host']}},
  })

  assert.deepEqual(result,{content:'回答',usage:{}})
  assert.equal(calls[0][0],'claude')
  assert.deepEqual(calls[0][1],[
    '-p','--tools','','--permission-mode','dontAsk','--no-session-persistence','--output-format','text',
  ])
  const prompt=JSON.parse(calls[0][2])
  assert.deepEqual(prompt.conversation,[{role:'user',content:'解释这个查询'}])
  assert.deepEqual(prompt.attachments,{sql:'SELECT * FROM cpu',error:'timeout',schema:{fields:[{name:'usage',type:'float'}],tags:['host']}})
  assert.equal(JSON.stringify(calls[0]).includes('apiKey'),false)
})
test('chat omits unselected attachments and rejects invalid message roles', async () => {
  let prompt
  const cli=createClaudeCli({runProcess:async (_command,_args,input)=>{prompt=JSON.parse(input);return{stdout:'ok'}}})
  await cli.chat({messages:[{role:'user',content:'hello'}]})
  assert.deepEqual(prompt.attachments,{})
  await assert.rejects(
    ()=>cli.chat({messages:[{role:'tool',content:'unsafe'}]}),
    error=>error instanceof ClaudeCliError && error.code==='CLAUDE_INPUT_INVALID' && error.status===400,
  )
})

test('prompt redacts connection secrets and rejects sensitive Schema keys',()=>{
  const prompt=JSON.parse(buildClaudeChatPrompt(
    [{role:'user',content:'连接 https://alice:swordfish@db.example:8635，用户 alice'}],
    {error:'endpoint=https://db.example:8635'},
    {secrets:['https://db.example:8635','alice','swordfish']},
  ))
  const encoded=JSON.stringify(prompt)
  for(const secret of ['db.example','alice','swordfish'])assert.equal(encoded.includes(secret),false)
  assert.throws(
    ()=>buildClaudeChatPrompt([{role:'user',content:'检查'}],{schema:{endpoint:'https://db.example'}}),
    error=>error instanceof ClaudeCliError&&error.code==='CLAUDE_INPUT_INVALID',
  )
})

test('prompt keeps ordinary URLs and SQL literals when credentials are short',()=>{
  const prompt=JSON.parse(buildClaudeChatPrompt(
    [{role:'user',content:'SELECT 1 FROM cpu WHERE value >= 10，参考 https://docs.example/query'}],
    {},
    {secrets:[{kind:'username',value:'a'},{kind:'password',value:'1'}]},
  ))
  assert.equal(prompt.conversation[0].content,'SELECT 1 FROM cpu WHERE value >= 10，参考 https://docs.example/query')
})

test('chat always uses the Bridge-configured Claude command',async()=>{
  const calls=[]
  const cli=createClaudeCli({command:'C:/Claude/claude.exe',runProcess:async(...args)=>{calls.push(args);return{stdout:'ok'}}})
  await cli.chat({messages:[{role:'user',content:'hello'}],cliPath:'powershell'})
  assert.equal(calls[0][0],'C:/Claude/claude.exe')
})

test('probe and chat resolve the latest application-level Claude command',async()=>{
  const calls=[]
  let command='claude'
  const cli=createClaudeCli({command:()=>command,runProcess:async(executable,args)=>{
    calls.push([executable,args])
    if(args[0]==='--version')return{stdout:'Claude Code 1.2.3'}
    if(args[0]==='auth')return{stdout:'{"loggedIn":true}'}
    return{stdout:'ok'}
  }})

  await cli.probe()
  command='C:/Tools/claude.exe'
  await cli.chat({messages:[{role:'user',content:'hello'}]})

  assert.equal(calls[0][0],'claude')
  assert.equal(calls.at(-1)[0],'C:/Tools/claude.exe')
})

test('probe reports ready, not authenticated, and not installed states', async () => {
  const ready=createClaudeCli({runProcess:async (_command,args)=>args[0]==='--version'
    ? {stdout:'Claude Code 1.2.3'}
    : {stdout:'{"loggedIn":true}'}})
  assert.deepEqual(await ready.probe(),{
    ready:true,kind:'ready',version:'Claude Code 1.2.3',message:'Claude CLI 已安装并登录',
  })

  const loggedOut=createClaudeCli({runProcess:async (_command,args)=>args[0]==='--version'
    ? {stdout:'Claude Code 1.2.3'}
    : {stdout:'{"loggedIn":false}'}})
  assert.equal((await loggedOut.probe()).kind,'not_authenticated')

  const missing=createClaudeCli({runProcess:async ()=>{throw Object.assign(new Error('secret path'),{code:'CLAUDE_CLI_START_FAILED'})}})
  assert.deepEqual(await missing.probe(),{
    ready:false,kind:'not_installed',message:'未检测到 Claude CLI',
  })
})

test('chat maps cancellation, timeout, process failure, and output limit safely', async () => {
  for(const [sourceCode,wantCode,wantStatus] of [
    ['DIAGNOSIS_CANCELLED','CLAUDE_CANCELLED',499],
    ['CLAUDE_TIMEOUT','CLAUDE_TIMEOUT',504],
    ['CLAUDE_CLI_FAILED','CLAUDE_CLI_FAILED',502],
  ]) {
    const cli=createClaudeCli({runProcess:async()=>{throw Object.assign(new Error('contains password=secret'),{code:sourceCode})}})
    await assert.rejects(
      ()=>cli.chat({messages:[{role:'user',content:'hello'}]}),
      error=>error.code===wantCode && error.status===wantStatus && !error.message.includes('secret'),
    )
  }

  const limited=createClaudeCli({maxOutputBytes:3,runProcess:async()=>({stdout:'four'})})
  await assert.rejects(
    ()=>limited.chat({messages:[{role:'user',content:'hello'}]}),
    error=>error.code==='CLAUDE_OUTPUT_LIMIT' && error.status===502,
  )

  const defaultLimited=createClaudeCli({runProcess:async()=>({stdout:'x'.repeat(40_001)})})
  await assert.rejects(
    ()=>defaultLimited.chat({messages:[{role:'user',content:'hello'}]}),
    error=>error.code==='CLAUDE_OUTPUT_LIMIT'&&error.status===502,
  )
})
