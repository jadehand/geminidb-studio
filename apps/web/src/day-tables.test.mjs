import assert from 'node:assert/strict'
import test from 'node:test'
import { dayTablePrefix, filterDayTables, multiTableQuery, tableTimestamp } from './day-tables.ts'

test('解析和筛选天表', () => {
  assert.equal(tableTimestamp('cpu_1784563200'),1784563200)
  assert.equal(tableTimestamp('cpu'),null)
  assert.deepEqual(filterDayTables(['cpu_1784563200','cpu'], 'all'), ['cpu_1784563200','cpu'])
})

test('extracts the shared logical prefix from a ten digit day-table suffix', () => {
  assert.equal(dayTablePrefix('cpu_1784563200'), 'cpu')
  assert.equal(dayTablePrefix('cpu'), 'cpu')
  assert.equal(dayTablePrefix('cpu_usage'), 'cpu_usage')
  assert.equal(dayTablePrefix('_1784563200'), null)
})

test('生成跨天 InfluxQL 正则查询', () => {
  const sql=multiTableQuery(['cpu_1784563200','cpu_1784649600'])
  assert.match(sql,/FROM \/\^\(\?:cpu_1784563200\|cpu_1784649600\)\$\//)
  assert.match(sql,/WHERE time >=/)
  assert.match(sql,/LIMIT 100/)
})
