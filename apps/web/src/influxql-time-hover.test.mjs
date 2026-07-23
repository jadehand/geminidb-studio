import assert from 'node:assert/strict'
import test from 'node:test'
import { findTimeHover } from './influxql-time-hover.ts'

function hoverOn(line, value) {
  return findTimeHover(line, line.indexOf(value) + 2)
}

test('UTC 时间悬停显示北京时间', () => {
  const line = "WHERE time >= '2026-07-23T04:59:00Z'"
  assert.equal(hoverOn(line, '2026-07-23')?.beijing, '2026-07-23 12:59:00')
})

test('带时区时间悬停显示北京时间', () => {
  const line = "WHERE time >= '2026-07-23T13:29:00+08:00'"
  assert.equal(hoverOn(line, '2026-07-23')?.beijing, '2026-07-23 13:29:00')
})

test('秒和毫秒时间戳悬停显示北京时间', () => {
  assert.equal(hoverOn('WHERE time >= 1784782740s', '1784782740')?.beijing, '2026-07-23 12:59:00')
  assert.equal(hoverOn('WHERE time >= 1784782740000ms', '1784782740000')?.beijing, '2026-07-23 12:59:00')
})

test('无单位的 10 位和 13 位时间戳可自动识别', () => {
  assert.equal(hoverOn('WHERE time >= 1784782740', '1784782740')?.beijing, '2026-07-23 12:59:00')
  assert.equal(hoverOn('WHERE time >= 1784782740000', '1784782740000')?.beijing, '2026-07-23 12:59:00')
})

test('普通数字和 Measurement 名称不会被误判', () => {
  assert.equal(hoverOn('LIMIT 100', '100'), null)
  assert.equal(hoverOn('FROM "metrics_1784782740"', '1784782740'), null)
})

test('无效日期不显示悬停', () => {
  assert.equal(hoverOn("WHERE time >= '2026-02-30T04:59:00Z'", '2026-02-30'), null)
})
