import assert from 'node:assert/strict'
import test from 'node:test'
import { assertEnvironmentWritable, isEnvironmentWritable } from './write-policy.mjs'

test('only test and development environments are writable', () => {
  assert.equal(isEnvironmentWritable('test'), true)
  assert.equal(isEnvironmentWritable('dev'), true)
  assert.equal(isEnvironmentWritable('prod'), false)
  assert.equal(isEnvironmentWritable(undefined), false)
})

test('bridge rejects production writes', () => {
  assert.throws(
    () => assertEnvironmentWritable({ environment:'prod' }),
    error => error.code === 'PRODUCTION_READ_ONLY' && error.status === 403,
  )
})
