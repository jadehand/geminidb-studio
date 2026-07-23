import assert from 'node:assert/strict'
import test from 'node:test'
import {
  conversionFromMilliseconds,
  parseDateTime,
  parseUnixTimestamp,
} from './time-converter.ts'

test('自动识别秒、毫秒、微秒和纳秒时间戳', () => {
  assert.equal(parseUnixTimestamp('1784782740'), 1784782740000)
  assert.equal(parseUnixTimestamp('1784782740000'), 1784782740000)
  assert.equal(parseUnixTimestamp('1784782740000000'), 1784782740000)
  assert.equal(parseUnixTimestamp('1784782740000000000'), 1784782740000)
  assert.equal(parseUnixTimestamp('not-a-time'), null)
})

test('北京时间和 UTC 输入指向同一时刻', () => {
  const beijing = parseDateTime('2026-07-23 12:59:00', 'beijing')
  const utc = parseDateTime('2026-07-23 04:59:00', 'utc')
  assert.equal(beijing, utc)
  assert.equal(beijing, 1784782740000)
})

test('拒绝被 Date 自动进位的无效日期', () => {
  assert.equal(parseDateTime('2026-02-30 12:00:00', 'beijing'), null)
  assert.equal(parseDateTime('2026-07-23 25:00:00', 'utc'), null)
})

test('统一生成北京时间、UTC、时间戳和 InfluxQL 时间', () => {
  assert.deepEqual(conversionFromMilliseconds(1784782740000), {
    beijing:'2026-07-23 12:59:00',
    utc:'2026-07-23T04:59:00Z',
    unixSeconds:'1784782740',
    unixMilliseconds:'1784782740000',
    influxQL:"'2026-07-23T04:59:00Z'",
  })
})
