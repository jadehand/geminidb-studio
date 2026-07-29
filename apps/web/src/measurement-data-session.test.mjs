import assert from 'node:assert/strict'
import test from 'node:test'
import { readFile } from 'node:fs/promises'
import * as measurementData from './measurement-data.ts'

const tab = { connectionId:'connection-1', database:'metrics', measurement:'cpu_1784995200' }
const page = {
  schema:{ tags:['host'], fields:[{ name:'usage', type:'float' }] },
  points:[{ id:'point-1', measurement:tab.measurement, timestampNs:'1784998800123456789', time:'1784998800123456789', tags:{ host:'db-1' }, fields:{ usage:42 } }],
  page:{ limit:50, offset:0, hasMore:false },
}

test('blocks measurement requests while the selected connection session is unconfirmed', () => {
  assert.equal(measurementData.measurementDataRequestKey?.(tab, null, 'metrics'), null)
})

test('changes the request key when a new confirmed session generation replaces the old one', () => {
  const first = measurementData.measurementDataRequestKey?.(tab, { connectionId:'connection-1', generation:1 }, 'metrics')
  const second = measurementData.measurementDataRequestKey?.(tab, { connectionId:'connection-1', generation:2 }, 'metrics')

  assert.equal(typeof first, 'string')
  assert.equal(typeof second, 'string')
  assert.notEqual(first, second)
})

test('blocks measurement requests for the wrong confirmed connection or database', () => {
  assert.equal(measurementData.measurementDataRequestKey?.(tab, { connectionId:'connection-2', generation:1 }, 'metrics'), null)
  assert.equal(measurementData.measurementDataRequestKey?.(tab, { connectionId:'connection-1', generation:1 }, 'other'), null)
})

test('converts exact nanoseconds to the hand-derived Beijing wall clock', () => {
  assert.equal(measurementData.measurementNanosecondsToBeijing?.('1784998800123456789'), '2026-07-26 01:00:00')
})

test('rejects malformed and out-of-range nanosecond values', () => {
  for (const value of ['', '-1', '1.2', 1784998800123456789n, '9007199254740992000000']) {
    assert.equal(measurementData.measurementNanosecondsToBeijing?.(value), null)
  }
})

test('shows a received measurement page only for its exact current request key', () => {
  const result = { requestKey:'session-generation-1', page }

  assert.equal(measurementData.measurementDataPageForRequest?.(result, 'session-generation-1'), page)
  assert.equal(measurementData.measurementDataPageForRequest?.(result, 'session-generation-2'), null)
  assert.equal(measurementData.measurementDataPageForRequest?.(result, null), null)
})

test('App publishes readiness only after the current login catalog has fully loaded', async () => {
  const [app, view] = await Promise.all([
    readFile(new URL('./App.tsx', import.meta.url), 'utf8'),
    readFile(new URL('./MeasurementDataView.tsx', import.meta.url), 'utf8'),
  ])

  assert.match(app, /const \[readyConnectionSession,\s*setReadyConnectionSession\]/)
  assert.match(app, /const sessionGeneration = invalidateConnectionSession\(\)[\s\S]*await bridge\.login/)
  assert.match(app, /const nextTables=await bridge\.tables\(nextDb\)[\s\S]*if \(sessionGeneration !== connectionSession\.current\) return[\s\S]*setReadyConnectionSession\(\{connectionId:connection\.id,generation:sessionGeneration\}\)/)
  assert.match(app, /<MeasurementDataView[\s\S]*readyConnectionSession=\{readyConnectionSession\}/)
  assert.match(view, /measurementDataRequestKey/)
  assert.match(view, /\[requestKey, options, reload\]/)
  assert.doesNotMatch(view, /currentConnectionId/)
})

test('deleting the active connection invalidates its pending session before selecting a replacement', async () => {
  const app = await readFile(new URL('./App.tsx', import.meta.url), 'utf8')

  assert.match(app, /function invalidateConnectionSession\(\)\s*\{[\s\S]*\+\+connectionSession\.current[\s\S]*setReadyConnectionSession\(null\)[\s\S]*return connectionSession\.current[\s\S]*\}/)
  assert.match(app, /if \(activeConnection === connection\.id\) \{[\s\S]*invalidateConnectionSession\(\)[\s\S]*setActiveConnection\(nextId\)[\s\S]*if \(next\[0\]\) void connect\(next\[0\]\)/)
})

test('data view stores request identity with each received page and filters stale results', async () => {
  const view = await readFile(new URL('./MeasurementDataView.tsx', import.meta.url), 'utf8')

  assert.match(view, /measurementDataPageForRequest/)
  assert.match(view, /setResult\(\{ requestKey, page:next \}\)/)
  assert.match(view, /const page = measurementDataPageForRequest\(result, requestKey\)/)
})
