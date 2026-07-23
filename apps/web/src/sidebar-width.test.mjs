import assert from 'node:assert/strict'
import test from 'node:test'
import { DEFAULT_SIDEBAR_WIDTH, MAX_SIDEBAR_WIDTH, MIN_SIDEBAR_WIDTH, clampSidebarWidth } from './sidebar-width.ts'

test('侧栏宽度限制在可用范围', () => {
  assert.equal(clampSidebarWidth(100), MIN_SIDEBAR_WIDTH)
  assert.equal(clampSidebarWidth(999), MAX_SIDEBAR_WIDTH)
  assert.equal(clampSidebarWidth(417.6), 418)
  assert.equal(clampSidebarWidth(DEFAULT_SIDEBAR_WIDTH), 340)
})
