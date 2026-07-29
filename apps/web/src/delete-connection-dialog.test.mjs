import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const source = readFileSync(new URL('./DeleteConnectionDialog.tsx', import.meta.url), 'utf8')

test('delete dialog exposes required content and keyboard behavior', () => {
  assert.match(source, /connection\.name/)
  assert.match(source, /connection\.endpoint/)
  assert.match(source, /取消/)
  assert.match(source, /确认删除/)
  assert.match(source, /event\.key === 'Escape'/)
  assert.match(source, /autoFocus/)
})
