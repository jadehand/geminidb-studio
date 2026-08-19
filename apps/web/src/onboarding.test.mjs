import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import { GUIDE_TOPICS } from './learning-center.ts'

test('quick start is a six-step shortest successful query path',()=>{
  const quick=GUIDE_TOPICS.find(topic=>topic.id==='quick-start')
  assert.equal(quick.steps.length,6)
  assert.deepEqual(quick.steps.map(step=>step.target),['new-connection','database-switcher','catalog','query-editor','execute-query','query-results'])
})
test('six focused guides cover the practical feature set',()=>{
  assert.deepEqual(GUIDE_TOPICS.map(topic=>topic.id),['quick-start','query-efficiency','measurement-data','knowledge','bulk-data','claude-assistant'])
  assert.ok(GUIDE_TOPICS.every(topic=>topic.steps.length>=3&&topic.steps.length<=6))
})
test('tour keeps keyboard navigation and provides a missing-target fallback',async()=>{
  const source=await readFile(new URL('./FeatureTour.tsx',import.meta.url),'utf8')
  assert.match(source,/event\.key === 'Escape'/)
  assert.match(source,/topicTitle/)
  assert.match(source,/box \? cardPosition\(box\)/)
  assert.match(source,/\{box&&<div className="feature-tour-focus"/)
})
test('top question mark opens learning center instead of replaying one long tour',async()=>{
  const app=await readFile(new URL('./App.tsx',import.meta.url),'utf8')
  assert.match(app,/title="打开学习中心"/)
  assert.match(app,/onClick=\{openLearning\}/)
  assert.match(app,/<LearningCenter/)
  assert.doesNotMatch(app,/title="重新查看功能导览"/)
})
