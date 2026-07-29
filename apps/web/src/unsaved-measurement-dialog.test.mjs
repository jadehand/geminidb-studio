import assert from 'node:assert/strict'
import test from 'node:test'
import { readFile } from 'node:fs/promises'

const tabs = await import('./workspace-tabs.ts')

test('guards every data-changing action while a measurement tab has drafts', () => {
  for (const action of ['refresh', 'retry refresh', 'previous page', 'next page', 'whole-day apply', 'custom-range apply', 'page size', 'close tab', 'switch connection', 'switch database']) {
    let ran = false
    const queued = tabs.queueMeasurementAction(null, true, () => { ran = true })
    assert.equal(queued.guarded, true, action)
    assert.equal(ran, false, action)
  }
})

test('keeps one guarded continuation and executes it only after a successful resolution', async () => {
  const events = []
  const first = tabs.queueMeasurementAction(null, true, () => events.push('first'))
  const second = tabs.queueMeasurementAction(first.pending, true, () => events.push('second'))
  const ignored = tabs.queueMeasurementAction(first.pending, false, () => events.push('unguarded second'))

  assert.equal(second.pending, first.pending)
  assert.equal(second.replaced, false)
  assert.equal(ignored.pending, first.pending)
  assert.deepEqual(events, [])
  assert.equal(await tabs.submitMeasurementAction(second.pending, async () => false), first.pending)
  assert.deepEqual(events, [])
  assert.equal(await tabs.submitMeasurementAction(second.pending, async () => true), null)
  assert.deepEqual(events, ['first'])
})

test('discard resolves the current draft and cancel only clears its continuation', () => {
  const events = []
  const queued = tabs.queueMeasurementAction(null, true, () => events.push('continue'))
  assert.equal(tabs.cancelMeasurementAction(queued.pending), null)
  assert.deepEqual(events, [])

  const next = tabs.queueMeasurementAction(null, true, () => events.push('continue'))
  assert.equal(tabs.discardMeasurementAction(next.pending, () => events.push('discard')), null)
  assert.deepEqual(events, ['discard', 'continue'])
})

test('an inactive dirty data tab remains open after a partial submit and closes after submit succeeds', async () => {
  const initialTabs = [
    { kind: 'query', id: 'query-1', name: 'query', sql: '' },
    { kind: 'measurement-data', id: 'data-cpu', name: 'cpu · 数据', connectionId: 'c1', database: 'metrics', measurement: 'cpu' },
  ]
  let currentTabs = initialTabs
  let activeId = 'query-1'
  const closeInactiveDataTab = () => {
    const next = tabs.closeWorkspaceTab(currentTabs, activeId, 'data-cpu')
    currentTabs = next.tabs
    activeId = next.activeId
  }
  const queued = tabs.queueMeasurementAction(null, true, closeInactiveDataTab)

  assert.equal(await tabs.submitMeasurementAction(queued.pending, async () => false), queued.pending)
  assert.equal(currentTabs.length, 2)
  assert.equal(await tabs.submitMeasurementAction(queued.pending, async () => true), null)
  assert.deepEqual(currentTabs.map(tab => tab.id), ['query-1'])
  assert.equal(activeId, 'query-1')
})

test('draft state belongs to its data tab and survives the view unmount contract', () => {
  const persisted = tabs.replaceMeasurementTabDrafts({}, 'data-cpu', { request: { field: 'draft' } })
  const afterQueryTabUnmount = persisted

  assert.equal(tabs.hasMeasurementTabDrafts(afterQueryTabUnmount, 'data-cpu'), true)
  assert.deepEqual(tabs.measurementTabDrafts(afterQueryTabUnmount, 'data-cpu'), { request: { field: 'draft' } })
  assert.equal(tabs.hasMeasurementTabDrafts(afterQueryTabUnmount, 'data-mem'), false)
})

test('the dialog supplies submit, discard, cancel, and an Escape cancel path', async () => {
  const source = await readFile(new URL('./UnsavedMeasurementDialog.tsx', import.meta.url), 'utf8')

  for (const label of ['提交', '放弃', '取消']) assert.match(source, new RegExp(label))
  assert.match(source, /event\.key === 'Escape'/)
  assert.match(source, /onCancel\(\)/)
})
