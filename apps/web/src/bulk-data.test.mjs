import assert from 'node:assert/strict'
import test from 'node:test'
import { BULK_ACTIVE_KEY, BULK_DRAFT_KEY, BULK_HISTORY_KEY, appendBulkHistory, bulkEntryState, clearActiveBulkRun, clearBulkDraft, copyHistoryToDraft, estimateBulkDraft, loadActiveBulkRun, loadBulkDraft, loadBulkHistory, saveActiveBulkRun, saveBulkDraft, stepForBulkError } from './bulk-data.ts'

const draft = (overrides = {}) => ({ prefix:'cpu', database:'monitoring', sourceMeasurement:'cpu_1784563200', retentionPolicy:'autogen', dates:['2026-07-26'], startTime:'00:00:00', endTime:'00:01:00', intervalSeconds:60, tags:[{ name:'host', generator:{ kind:'list', values:['node-01','node-02'] } }], fields:[{ name:'usage', type:'float', generator:{ kind:'random-number', min:0, max:100 } }], constraints:[], ...overrides })

function withStorage(run) {
  const original = globalThis.localStorage, values = new Map()
  globalThis.localStorage = { getItem:key => values.get(key) ?? null, setItem:(key, value) => values.set(key, value), removeItem:key => values.delete(key) }
  try { run(values) } finally { globalThis.localStorage = original }
}

test('only writable test connections with a live session and database enable bulk entry', () => {
  assert.equal(bulkEntryState({ connection:{ environment:'test', readOnly:false }, connected:true, database:'db' }).enabled, true)
  assert.match(bulkEntryState({ connection:{ environment:'prod', readOnly:false }, connected:true, database:'db' }).reason, /测试环境/)
  assert.match(bulkEntryState({ connection:{ environment:'test', readOnly:true }, connected:true, database:'db' }).reason, /只读/)
  assert.match(bulkEntryState({ connection:{ environment:'test', readOnly:false }, connected:false, database:'db' }).reason, /连接/)
  assert.match(bulkEntryState({ connection:{ environment:'test', readOnly:false }, connected:true, database:'' }).reason, /数据库/)
})

test('versioned draft storage omits sensitive preview data and invalid versions are ignored', () => withStorage(values => {
  assert.equal(BULK_DRAFT_KEY, 'gdb.bulkData.draft.v1')
  saveBulkDraft({ ...draft(), previewId:'expired-preview', seed:'secret', preview:{ previewId:'preview', samples:[{ lineProtocol:'full line protocol' }] } })
  const stored = JSON.parse(values.get(BULK_DRAFT_KEY))
  assert.equal(stored.version, 1); assert.equal('seed' in stored.draft, false); assert.equal('preview' in stored.draft, false); assert.equal('previewId' in stored.draft, false)
  assert.deepEqual(loadBulkDraft(), draft())
  values.set(BULK_DRAFT_KEY, JSON.stringify({ version:2, draft:draft() })); assert.equal(loadBulkDraft(), null)
  clearBulkDraft(); assert.equal(values.has(BULK_DRAFT_KEY), false)
}))

test('history keeps twenty newest safe summaries and copy removes execution state', () => withStorage(values => {
  assert.equal(BULK_HISTORY_KEY, 'gdb.bulkData.history.v1')
  for (let index = 0; index < 21; index += 1) appendBulkHistory({ ...draft({ dates:[`2026-07-${String(index + 1).padStart(2, '0')}`] }), jobId:`job-${index}`, status:'succeeded', previewId:'expired-preview', seed:'secret', progress:{ completedBatches:index }, preview:{ samples:[{ lineProtocol:'complete LP' }] }, completedAt:index })
  const history = loadBulkHistory(); assert.equal(history.length, 20); assert.equal(history[0].jobId, 'job-20'); assert.equal('seed' in history[0], false); assert.equal('preview' in history[0], false); assert.equal('previewId' in history[0], false)
  const copied = copyHistoryToDraft({ ...history[0], previewId:'expired-preview', seed:'secret', preview:{ samples:[{ lineProtocol:'complete LP' }] } })
  for (const key of ['jobId','status','seed','progress','preview','previewId','completedAt']) assert.equal(key in copied, false)
  assert.equal(copied.prefix, 'cpu')
  values.set(BULK_HISTORY_KEY, JSON.stringify({ version:2, items:history })); assert.deepEqual(loadBulkHistory(), [])
}))

test('active run summary survives remount without secrets and history is idempotent by job id', () => withStorage(values => {
  saveActiveBulkRun('job-1', { ...draft(), previewId:'expired', seed:'secret' })
  assert.equal(BULK_ACTIVE_KEY, 'gdb.bulkData.active.v1')
  assert.deepEqual(loadActiveBulkRun(), { jobId:'job-1', draft:draft() })
  const item = { ...draft(), jobId:'job-1', status:'succeeded', completedAt:1 }
  appendBulkHistory(item); appendBulkHistory({ ...item, completedAt:2 })
  assert.equal(loadBulkHistory().filter(current => current.jobId === 'job-1').length, 1)
  assert.equal(loadBulkHistory()[0].completedAt, 2)
  clearActiveBulkRun('other'); assert.equal(values.has(BULK_ACTIVE_KEY), true)
  clearActiveBulkRun('job-1'); assert.equal(values.has(BULK_ACTIVE_KEY), false)
}))

test('instantaneous estimate enforces thirty dates and calculates points and worst case series', () => {
  assert.deepEqual(estimateBulkDraft(draft()), { pointCount:4, maxNewSeries:2, tagCombinationCount:2 })
  assert.throws(() => estimateBulkDraft(draft({ dates:Array.from({ length:31 }, (_, index) => `2026-07-${String(index + 1).padStart(2, '0')}`) })), /30/)
})

test('bulk error codes lead back to the relevant wizard step', () => {
  assert.equal(stepForBulkError('BULK_TEST_CONNECTION_REQUIRED'), 1); assert.equal(stepForBulkError('RP_MISSING'), 1); assert.equal(stepForBulkError('POINT_LIMIT_EXCEEDED'), 2); assert.equal(stepForBulkError('CONSTRAINT_UNSATISFIABLE'), 3); assert.equal(stepForBulkError('STALE_BULK_PREVIEW'), 4); assert.equal(stepForBulkError('UNKNOWN'), 4)
})
