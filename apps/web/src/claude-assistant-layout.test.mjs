import assert from 'node:assert/strict'
import test from 'node:test'

import { DEFAULT_CLAUDE_DRAWER_WIDTH, fitClaudeDrawerWidth } from './claude-assistant-layout.ts'

test('Claude drawer width is bounded by usability and the current viewport',()=>{
  assert.equal(fitClaudeDrawerWidth(200,1400),520)
  assert.equal(fitClaudeDrawerWidth(900,1400),900)
  assert.equal(fitClaudeDrawerWidth(2000,1400),1304)
  assert.equal(fitClaudeDrawerWidth(DEFAULT_CLAUDE_DRAWER_WIDTH,700),700)
})
