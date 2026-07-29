import assert from 'node:assert/strict'
import test from 'node:test'
import { effectiveReadOnly } from './write-policy.ts'

test('only production is read-only', () => {
  assert.equal(effectiveReadOnly('prod'), true)
  assert.equal(effectiveReadOnly('test'), false)
  assert.equal(effectiveReadOnly('dev'), false)
})
