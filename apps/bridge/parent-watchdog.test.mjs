import assert from 'node:assert/strict'
import test from 'node:test'
import { parseParentPid, startParentWatchdog } from './parent-watchdog.mjs'

test('parseParentPid accepts only a positive integer', () => {
  assert.equal(parseParentPid(['--parent-pid', '1234']), 1234)
  assert.equal(parseParentPid(['--parent-pid', 'bad']), null)
  assert.equal(parseParentPid([]), null)
})

test('watchdog ends the bridge after the parent disappears', () => {
  let callback
  let orphaned = false
  startParentWatchdog(1234, () => { orphaned = true }, {
    probe() { throw new Error('parent no longer exists') },
    schedule(next) { callback = next; return { unref() {} } },
  })
  callback()
  assert.equal(orphaned, true)
})

test('watchdog leaves the bridge running while the parent exists', () => {
  let callback
  let orphaned = false
  startParentWatchdog(1234, () => { orphaned = true }, {
    probe() {},
    schedule(next) { callback = next; return { unref() {} } },
  })
  callback()
  assert.equal(orphaned, false)
})
