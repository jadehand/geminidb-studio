import assert from 'node:assert/strict'
import test from 'node:test'
import { peSubsystemOffset } from './pe-subsystem.mjs'

test('locates the Windows PE subsystem field', () => {
  const header = Buffer.alloc(512)
  header.write('MZ', 0, 'ascii')
  header.writeUInt32LE(0x80, 0x3c)
  header.write('PE\0\0', 0x80, 'ascii')
  header.writeUInt16LE(0x20b, 0x80 + 24)
  assert.equal(peSubsystemOffset(header), 0x80 + 24 + 68)
})

test('rejects a non-PE file', () => {
  assert.throws(() => peSubsystemOffset(Buffer.alloc(128)), /MZ/)
})
