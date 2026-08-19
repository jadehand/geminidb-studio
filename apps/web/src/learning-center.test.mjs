import assert from 'node:assert/strict'
import test from 'node:test'
import { CURRENT_LEARNING_RELEASE, GUIDE_TOPICS, dismissGuideHint, initialLearningProgress, markReleaseSeen, setTopicStatus } from './learning-center.ts'

test('migrates the old quick-start status and initializes every topic',()=>{
  const completed=initialLearningProgress(null,'completed')
  assert.equal(completed.topics['quick-start'],'completed')
  assert.equal(completed.topics['claude-assistant'],'new')
  assert.equal(GUIDE_TOPICS.length,6)
  assert.ok(GUIDE_TOPICS.every(topic=>topic.steps.length>=3&&topic.steps.length<=6))
})
test('normalizes corrupt progress without losing valid topic values',()=>{
  const progress=initialLearningProgress({version:1,topics:{agent:'completed','quick-start':'broken'},hints:null,seenRelease:7},'skipped')
  assert.equal(progress.topics['claude-assistant'],'completed')
  assert.equal(progress.topics['quick-start'],'skipped')
  assert.deepEqual(progress.hints,{})
  assert.equal(progress.seenRelease,'')
})
test('progress operations only update their own fields',()=>{
  const start=initialLearningProgress(null,'new')
  const done=setTopicStatus(start,'knowledge','completed')
  assert.equal(done.topics.knowledge,'completed')
  assert.equal(done.topics['claude-assistant'],'new')
  const hinted=dismissGuideHint(done,'knowledge')
  assert.equal(hinted.hints.knowledge,'dismissed')
  assert.equal(markReleaseSeen(hinted).seenRelease,CURRENT_LEARNING_RELEASE)
})
