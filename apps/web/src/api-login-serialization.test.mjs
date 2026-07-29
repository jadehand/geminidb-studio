import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const source = readFileSync(new URL('./api.ts', import.meta.url), 'utf8')

test('only the latest login request may replace the global Bridge session', () => {
  assert.match(source, /let loginRequest = 0/)
  assert.match(source, /const requestId = \+\+loginRequest/)
  assert.match(source, /if \(requestId !== loginRequest\) throw new BridgeError\(/)
  assert.match(source, /sessionId = result\.sessionId/)
})
