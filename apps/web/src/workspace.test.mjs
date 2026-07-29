import test from 'node:test'
import assert from 'node:assert/strict'

const data=new Map()
globalThis.localStorage={getItem:key=>data.get(key)??null,setItem:(key,value)=>data.set(key,value),removeItem:key=>data.delete(key)}
const workspace=await import('./workspace.ts')
const workspaceTabs=await import('./workspace-tabs.ts')

test('migrates legacy query tabs in persisted workspace snapshots',()=>{
  data.set('gdb.workspace.snapshot',JSON.stringify({
    version:1,database:'metrics',measurement:'cpu',dayRange:'all',resultView:'result',activeConnection:'c1',activeTabId:'query-1',
    queryTabs:[{id:'query-1',name:'query 1',sql:'SHOW DATABASES'}],sideTool:'catalog',sideOpen:true,savedAt:1,
  }))

  assert.deepEqual(workspace.readWorkspace().tabs,[{kind:'query',id:'query-1',name:'query 1',sql:'SHOW DATABASES'}])
})

test('persists measurement data tab descriptors without loaded rows',()=>{
  workspace.writeWorkspace({
    database:'metrics',measurement:'cpu',dayRange:'all',resultView:'result',activeConnection:'c1',activeTabId:'data-1',
    tabs:[{kind:'measurement-data',id:'data-1',name:'cpu · 数据',connectionId:'c1',database:'metrics',measurement:'cpu',rows:[{time:'1'}]}],sideTool:'catalog',sideOpen:true,
  })

  const snapshot=JSON.parse(data.get('gdb.workspace.snapshot'))
  assert.deepEqual(snapshot.tabs,[{kind:'measurement-data',id:'data-1',name:'cpu · 数据',connectionId:'c1',database:'metrics',measurement:'cpu'}])
})

test('round-trips the fallback query tab after closing the only measurement data tab',()=>{
  const closed=workspaceTabs.closeWorkspaceTab([{
    kind:'measurement-data',id:'data-1',name:'cpu · 数据',connectionId:'c1',database:'metrics',measurement:'cpu',
  }],'data-1','data-1')
  workspace.writeWorkspace({database:'metrics',measurement:'cpu',dayRange:'all',resultView:'result',activeConnection:'c1',activeTabId:closed.activeId,tabs:closed.tabs,sideTool:'catalog',sideOpen:true})

  const snapshot=workspace.readWorkspace()
  assert.deepEqual(snapshot.tabs,closed.tabs)
  assert.equal(snapshot.activeTabId,'query-1')
})

test('工作区快照可保存、恢复并保留最近三份',()=>{
  for(let i=0;i<4;i++)workspace.writeWorkspace({database:'db',measurement:'m',dayRange:'all',resultView:'result',activeConnection:'mock',activeTabId:String(i),tabs:[{kind:'query',id:String(i),name:'查询',sql:`SELECT ${i}`}],sideTool:'catalog',sideOpen:true})
  assert.equal(workspace.readWorkspace().tabs[0].sql,'SELECT 3')
  assert.equal(workspace.readRecent().length,3)
})

test('检测异常退出并支持清空',()=>{
  workspace.endSession();assert.equal(workspace.beginSession(),false);assert.equal(workspace.beginSession(),true)
  workspace.clearWorkspace();assert.equal(workspace.readWorkspace(),null)
})
