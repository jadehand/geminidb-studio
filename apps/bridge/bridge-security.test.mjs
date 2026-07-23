import assert from 'node:assert/strict'
import test from 'node:test'
import { isAllowedBridgeOrigin } from './bridge-security.mjs'

test('Bridge 只接受桌面客户端和本地开发来源', () => {
  assert.equal(isAllowedBridgeOrigin('tauri://localhost'), true)
  assert.equal(isAllowedBridgeOrigin('http://127.0.0.1:8791'), true)
  assert.equal(isAllowedBridgeOrigin(undefined), true)
  assert.equal(isAllowedBridgeOrigin('https://attacker.example'), false)
})
