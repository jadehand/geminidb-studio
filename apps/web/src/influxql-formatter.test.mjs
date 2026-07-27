import assert from 'node:assert/strict'
import test from 'node:test'
import { formatInfluxQL } from './influxql-formatter.ts'

test('格式化 InfluxQL 关键字、逗号和主要子句', () => {
  assert.equal(
    formatInfluxQL('select mean(value),max(value) from "cpu" where time >= now() - 1h group by time(5m),host order by time desc limit 20'),
    'SELECT mean(value), max(value)\nFROM "cpu"\nWHERE time >= now() - 1h\nGROUP BY time(5m), host\nORDER BY time desc\nLIMIT 20'
  )
})

test('字符串、双引号标识符和正则表达式中的关键字不会被改写', () => {
  const sql = `select value from "select" where host =~ /from|where/ and note = 'order by'`
  assert.equal(formatInfluxQL(sql), `SELECT value\nFROM "select"\nWHERE host =~ /from|where/ and note = 'order by'`)
})

test('WRITE Line Protocol 保持原文', () => {
  const sql = 'WRITE cpu,host=node-01 value=1i 1780000000000'
  assert.equal(formatInfluxQL(sql), sql)
})

test('格式化结果幂等', () => {
  const once = formatInfluxQL('select value from cpu where time >= now() - 1h limit 10')
  assert.equal(formatInfluxQL(once), once)
})
