import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

test('learning center exposes topics, progress, reset, and release news',async()=>{
  const source=await readFile(new URL('./LearningCenter.tsx',import.meta.url),'utf8')
  for(const text of ['学习中心','推荐开始','实用功能','v0.7 新功能','重置学习进度','重新体验'])assert.match(source,new RegExp(text))
  assert.match(source,/role="dialog"/)
  assert.match(source,/event\.key==='Escape'/)
})
test('context hints cover the four complex feature entrances',async()=>{
  const app=await readFile(new URL('./App.tsx',import.meta.url),'utf8')
  for(const id of ['measurement-data','knowledge','bulk-data','claude-assistant'])assert.match(app,new RegExp(`showGuideHint\\('${id}'\\)`))
  assert.match(app,/查看专题引导/)
})
