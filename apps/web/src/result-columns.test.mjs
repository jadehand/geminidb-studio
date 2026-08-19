import assert from 'node:assert/strict'
import test from 'node:test'

import { pinnedResultColumn } from './result-columns.ts'

test('time column stays pinned even when it is not the first visible column',()=>{
  assert.equal(pinnedResultColumn(['503_cnt','time','504_cnt']),'time')
  assert.equal(pinnedResultColumn(['503_cnt','TIME','504_cnt']),'TIME')
})

test('falls back to the first visible column when time is hidden or absent',()=>{
  assert.equal(pinnedResultColumn(['503_cnt','504_cnt']),'503_cnt')
  assert.equal(pinnedResultColumn([]),undefined)
})
