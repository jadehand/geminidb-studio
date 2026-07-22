import test from 'node:test'
import assert from 'node:assert/strict'

const data=new Map()
globalThis.localStorage={getItem:key=>data.get(key)??null,setItem:(key,value)=>data.set(key,value),removeItem:key=>data.delete(key)}
const workspace=await import('./workspace.ts')

test('工作区快照可保存、恢复并保留最近三份',()=>{
  for(let i=0;i<4;i++)workspace.writeWorkspace({database:'db',measurement:'m',dayRange:'all',resultView:'result',activeConnection:'mock',activeTabId:String(i),queryTabs:[{id:String(i),name:'查询',sql:`SELECT ${i}`}],sideTool:'catalog',sideOpen:true})
  assert.equal(workspace.readWorkspace().queryTabs[0].sql,'SELECT 3')
  assert.equal(workspace.readRecent().length,3)
})

test('检测异常退出并支持清空',()=>{
  workspace.endSession();assert.equal(workspace.beginSession(),false);assert.equal(workspace.beginSession(),true)
  workspace.clearWorkspace();assert.equal(workspace.readWorkspace(),null)
})
