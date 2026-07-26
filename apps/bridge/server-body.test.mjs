import assert from 'node:assert/strict'
import { Readable } from 'node:stream'
import test from 'node:test'
import { readJsonBody } from './server-body.mjs'

function request(parts) {
  return Readable.from(parts)
}

test('readJsonBody parses valid JSON below the limit', async () => {
  assert.deepEqual(await readJsonBody(request(['{"database":"monitoring"}'])), { database:'monitoring' })
})

test('readJsonBody rejects malformed JSON', async () => {
  await assert.rejects(readJsonBody(request(['{bad'])), error => error.code === 'INVALID_JSON')
})

test('readJsonBody rejects a body above 1 MiB without retaining the oversized chunk', async () => {
  let destroyed = false
  const oversized = request([Buffer.alloc(1_048_577, 'x')])
  oversized.destroy = () => { destroyed = true }
  await assert.rejects(readJsonBody(oversized), error => error.code === 'REQUEST_BODY_TOO_LARGE')
  assert.equal(destroyed, true)
})
