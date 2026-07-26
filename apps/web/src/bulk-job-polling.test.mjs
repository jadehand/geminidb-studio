import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import { nextPollDelay } from './app-close.ts'

test('未完成任务每秒轮询，终态停止', () => {
  for (const status of ['queued','running','retrying','paused','cancelling']) assert.equal(nextPollDelay(status), 1000)
  for (const status of ['cancelled','succeeded','failed']) assert.equal(nextPollDelay(status), null)
})

test('向导按任务 ID 串行轮询并在启动后进入任务状态', () => {
  const source = readFileSync(new URL('./BulkDataWizard.tsx', import.meta.url), 'utf8')
  assert.match(source, /bridge\.bulkJob\(activeJob\.id\)/)
  assert.match(source, /window\.setTimeout\(\(\) => void poll\(\), delay\)/)
  assert.doesNotMatch(source, /setInterval\([^)]*bulkJob/)
  assert.match(source, /bridge\.createBulkJob/)
  assert.match(source, /onJobChange\(job\)/)
})
