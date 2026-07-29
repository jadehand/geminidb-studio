import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import { appCloseStep, isUnfinishedBulkJob } from './app-close.ts'

test('app close resolves measurement drafts before bulk work and closes only when neither guard remains', () => {
  assert.equal(appCloseStep({ hasMeasurementDrafts: true, bulkStatus: undefined }), 'measurement')
  assert.equal(appCloseStep({ hasMeasurementDrafts: false, bulkStatus: 'running' }), 'bulk')
  assert.equal(appCloseStep({ hasMeasurementDrafts: true, bulkStatus: 'running' }), 'measurement')
  assert.equal(appCloseStep({ hasMeasurementDrafts: false, bulkStatus: undefined }), 'close')
})

test('运行、重试、暂停和取消中均保护应用关闭', () => {
  for (const status of ['queued','running','retrying','paused','cancelling']) assert.equal(isUnfinishedBulkJob(status), true)
})

test('桌面和 Web 均接入关闭保护', () => {
  const app = readFileSync(new URL('./App.tsx', import.meta.url), 'utf8')
  const desktop = readFileSync(new URL('./desktop.ts', import.meta.url), 'utf8')
  assert.match(app, /beforeunload/)
  assert.match(app, /停止任务并退出/)
  assert.match(app, /waitForBulkJobTerminal/)
  assert.match(desktop, /onCloseRequested/)
  assert.match(desktop, /event\.preventDefault\(\)/)
})

test('终态和空状态不阻止关闭', () => {
  for (const status of [undefined,'cancelled','succeeded','failed']) assert.equal(isUnfinishedBulkJob(status), false)
})

test('App close wiring uses latest measurement state and resumes desktop close through the same coordinator', () => {
  const app = readFileSync(new URL('./App.tsx', import.meta.url), 'utf8')
  assert.match(app, /requestAppCloseRef\.current\(\)/)
  assert.match(app, /appCloseStep\(\{ hasMeasurementDrafts:/)
  assert.match(app, /guardAllMeasurementDrafts\(\(\) => requestAppCloseRef\.current\(\)\)/)
  assert.match(app, /measurementDraftsRef\.current/)
})
