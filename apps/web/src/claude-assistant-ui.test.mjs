import assert from 'node:assert/strict'
import { readFile, readdir } from 'node:fs/promises'
import test from 'node:test'

import { buildClaudeAttachments, extractInfluxqlBlocks, shouldRenameSession } from './claude-assistant.ts'

const schema={fields:[{name:'usage',type:'float'}],tags:['host']}

test('context attachments are empty until each source is explicitly selected',()=>{
  const context={sql:'SELECT * FROM cpu',error:'timeout',schema}
  assert.deepEqual(buildClaudeAttachments(context,{sql:false,error:false,schema:false}),{})
  assert.deepEqual(buildClaudeAttachments(context,{sql:true,error:false,schema:true}),{
    sql:'SELECT * FROM cpu',schema,
  })
})

test('diagnosis context includes only available SQL error and Schema values',()=>{
  assert.deepEqual(buildClaudeAttachments({sql:'SELECT 1',error:'',schema},{sql:true,error:true,schema:true}),{
    sql:'SELECT 1',schema,
  })
})

test('extracts InfluxQL code blocks for copy and new-query actions',()=>{
  assert.deepEqual(extractInfluxqlBlocks('说明\n```influxql\nSELECT * FROM cpu\n```\n结束'),['SELECT * FROM cpu'])
  assert.deepEqual(extractInfluxqlBlocks('```sql\nSHOW DATABASES\n```'),['SHOW DATABASES'])
})

test('renames a session only when a non-empty draft differs from the stored title',()=>{
  assert.equal(shouldRenameSession('旧标题',' 新标题 '),true)
  assert.equal(shouldRenameSession('旧标题','旧标题'),false)
  assert.equal(shouldRenameSession('旧标题','   '),false)
})

test('drawer exposes chat history, explicit context, diagnosis, cancellation, and no execution action',async()=>{
  const source=await readFile(new URL('./ClaudeAssistantDrawer.tsx',import.meta.url),'utf8')
  for(const label of ['搜索历史','新建会话','附加当前 SQL','附加最近错误','附加 Schema','诊断当前查询','停止','打开到新查询'])
    assert.match(source,new RegExp(label))
  assert.doesNotMatch(source,/>执行 SQL<|onExecute/)
  assert.match(source,/autoFocus/)
  assert.match(source,/event\.key==='Escape'/)
  assert.match(source,/loadSession\(resolvedSessionId\)/)
})

test('runtime web source contains no obsolete Agent workbench implementation',async()=>{
  const root=new URL('./',import.meta.url)
  const files=(await readdir(root,{recursive:true})).filter(file=>
    /\.(?:ts|tsx|css)$/.test(file)&&!file.endsWith('.test.ts')&&!file.endsWith('.test.tsx'),
  )
  const runtime=(await Promise.all(files.map(file=>readFile(new URL(file.replaceAll('\\','/'),root),'utf8')))).join('\n')
  for(const obsolete of [/AgentWorkbench/,/AgentExecutionPanel/,/\/agent\//,/agent-active/,/Agent 工作台/,/Anthropic API/])
    assert.doesNotMatch(runtime,obsolete)
})
