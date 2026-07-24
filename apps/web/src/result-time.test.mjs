import assert from 'node:assert/strict'
import test from 'node:test'
import { resultCell } from './result-time.ts'

test('time 毫秒时间戳默认显示 UTC，并在悬停中保留北京时间与原值',()=>{
  const cell=resultCell('time',1784516040000)
  assert.equal(cell.text,'2026-07-20 02:54:00.000 UTC')
  assert.match(cell.title,/北京时间：2026-07-20 10:54:00.000 UTC\+8/)
  assert.match(cell.title,/时间戳：1784516040000 ms/)
})

test('秒时间戳可识别，其他字段保持原值',()=>{
  assert.equal(resultCell('TIME','1784516040').text,'2026-07-20 02:54:00.000 UTC')
  assert.deepEqual(resultCell('value',1784516040000),{text:'1784516040000',title:'1784516040000'})
})
