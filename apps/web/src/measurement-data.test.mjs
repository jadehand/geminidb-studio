import assert from 'node:assert/strict'
import test from 'node:test'
import { measurementDay, normalizeMeasurementDataOptions } from './measurement-data.ts'

test('derives Beijing natural-day nanosecond bounds from a ten-digit suffix', () => {
  assert.deepEqual(measurementDay('cpu_1784995200'), {
    date: '2026-07-26',
    startNs: '1784995200000000000',
    endNs: '1785081599999999999',
  })
  assert.equal(measurementDay('cpu'), null)
})

test('defaults to a whole-day page of fifty rows', () => {
  assert.deepEqual(normalizeMeasurementDataOptions({}), {
    limit: 50,
    offset: 0,
    startNs: null,
    endNs: null,
  })
})

test('keeps supported page options and canonicalizes custom nanosecond bounds', () => {
  const day = measurementDay('cpu_1784995200')
  assert.deepEqual(normalizeMeasurementDataOptions({
    limit: 100,
    offset: 200,
    startNs: '01784995200000000000',
    endNs: '1784998800000000000',
    day,
  }), {
    limit: 100,
    offset: 200,
    startNs: '1784995200000000000',
    endNs: '1784998800000000000',
  })
})

test('rejects unsupported page options', () => {
  assert.throws(() => normalizeMeasurementDataOptions({ limit: 25 }), /limit/i)
  assert.throws(() => normalizeMeasurementDataOptions({ limit: 50, offset: -1 }), /offset/i)
})

test('rejects custom ranges that are incomplete, reversed, or outside the selected day', () => {
  const day = measurementDay('cpu_1784995200')
  assert.throws(() => normalizeMeasurementDataOptions({ startNs: day.startNs, day }), /both/i)
  assert.throws(() => normalizeMeasurementDataOptions({
    startNs: day.startNs,
    endNs: day.endNs,
  }), /selected day/i)
  assert.throws(() => normalizeMeasurementDataOptions({
    startNs: '1784998800000000000',
    endNs: '1784995200000000000',
    day,
  }), /start/i)
  assert.throws(() => normalizeMeasurementDataOptions({
    startNs: '1784995199999999999',
    endNs: day.endNs,
    day,
  }), /selected day/i)
  assert.throws(() => normalizeMeasurementDataOptions({
    startNs: day.startNs,
    endNs: '1785081600000000000',
    day,
  }), /selected day/i)
})
