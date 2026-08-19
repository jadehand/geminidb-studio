import assert from 'node:assert/strict'
import test from 'node:test'
import { applyMeasurementGrid, columnValue, uniqueColumnValues } from './measurement-grid.ts'

const points = [
  { id:'1', measurement:'m', timestampNs:'100', time:'100', tags:{ domain_id:'222' }, fields:{ count:2, model:'Kixl' } },
  { id:'2', measurement:'m', timestampNs:'200', time:'200', tags:{ domain_id:'111' }, fields:{ count:10, model:'A' } },
  { id:'3', measurement:'m', timestampNs:'300', time:'300', tags:{ domain_id:'222' }, fields:{ count:null, model:'Kixl' } },
]

test('column values are unique, searchable, and keep empty values', () => {
  assert.deepEqual(uniqueColumnValues(points, { key:'domain_id', kind:'tag' }, '2'), ['222'])
  assert.deepEqual(uniqueColumnValues(points, { key:'count', kind:'field' }, ''), ['(空)', '2', '10'])
})

test('grid filtering combines columns with AND and values with OR', () => {
  const result = applyMeasurementGrid(points, {
    filters:{ domain_id:['222'], model:['Kixl'] },
    sort:null,
    columns:[{ key:'domain_id', kind:'tag' }, { key:'model', kind:'field' }],
  })
  assert.deepEqual(result.map(point => point.id), ['1', '3'])
})

test('grid sorting compares numbers numerically and timestamps as integers', () => {
  assert.equal(columnValue(points[0], { key:'count', kind:'field' }), 2)
  assert.deepEqual(applyMeasurementGrid(points, { filters:{}, sort:{ key:'count', direction:'asc' }, columns:[{ key:'count', kind:'field' }] }).map(point => point.id), ['1', '2', '3'])
  assert.deepEqual(applyMeasurementGrid(points, { filters:{}, sort:{ key:'time', direction:'desc' }, columns:[{ key:'time', kind:'time' }] }).map(point => point.id), ['3', '2', '1'])
})
