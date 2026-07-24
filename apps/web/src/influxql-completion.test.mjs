import assert from 'node:assert/strict'
import test from 'node:test'
import { completionContext, measurementFromQuery, shouldAutoSuggest } from './influxql-completion.ts'

test('识别光标所在的 InfluxQL 子句', () => {
  assert.equal(completionContext('SELECT ').clause, 'SELECT')
  assert.equal(completionContext('SELECT mean("usage") FROM ').clause, 'FROM')
  assert.equal(completionContext('SELECT * FROM "cpu" WHERE host').clause, 'WHERE')
  assert.equal(completionContext('SELECT * FROM "cpu" GROUP BY ').clause, 'GROUP BY')
})

test('从当前语句识别 FROM Measurement', () => {
  assert.equal(measurementFromQuery('SELECT * FROM "cpu_usage_20260724"'), 'cpu_usage_20260724')
  assert.equal(measurementFromQuery('SHOW DATABASES; SELECT * FROM metrics'), 'metrics')
  assert.equal(measurementFromQuery('SELECT * FROM "a"; SELECT * FROM "b"'), 'b')
})

test('识别当前输入前缀和双引号标识符', () => {
  assert.deepEqual(completionContext('SELECT usa'), { clause:'SELECT', prefix:'usa', measurement:'', insideIdentifier:false })
  assert.deepEqual(completionContext('SELECT "usa'), { clause:'SELECT', prefix:'usa', measurement:'', insideIdentifier:true })
})

test('关键词、字段输入和子句空格会自动触发补全', () => {
  assert.equal(shouldAutoSuggest('sel', 'l'), true)
  assert.equal(shouldAutoSuggest('SELECT ', ' '), true)
  assert.equal(shouldAutoSuggest('SELECT "us', 's'), true)
  assert.equal(shouldAutoSuggest('SELECT *\n', '\n'), false)
})

