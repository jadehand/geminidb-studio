import assert from 'node:assert/strict'
import test from 'node:test'
import { readFile } from 'node:fs/promises'
import * as measurementData from './measurement-data.ts'

const tab = { connectionId:'connection-1', database:'metrics', measurement:'cpu_1784995200' }

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

test('App publishes readiness only after the current login catalog has fully loaded', async () => {
  const [app, view] = await Promise.all([
    readFile(new URL('./App.tsx', import.meta.url), 'utf8'),
    readFile(new URL('./MeasurementDataView.tsx', import.meta.url), 'utf8'),
  ])

  assert.match(app, /const \[readyConnectionSession,\s*setReadyConnectionSession\]/)
  assert.match(app, /const sessionGeneration = \+\+connectionSession\.current[\s\S]*setReadyConnectionSession\(null\)[\s\S]*await bridge\.login/)
  assert.match(app, /const nextTables=await bridge\.tables\(nextDb\)[\s\S]*if \(sessionGeneration !== connectionSession\.current\) return[\s\S]*setReadyConnectionSession\(\{connectionId:connection\.id,generation:sessionGeneration\}\)/)
  assert.match(app, /<MeasurementDataView[\s\S]*readyConnectionSession=\{readyConnectionSession\}/)
  assert.match(view, /measurementDataRequestKey/)
  assert.match(view, /\[requestKey, options, reload\]/)
  assert.doesNotMatch(view, /currentConnectionId/)
})
