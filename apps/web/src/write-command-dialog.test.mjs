import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const source = readFileSync(new URL('./WriteCommandDialog.tsx', import.meta.url), 'utf8')

test('write command dialog shows database, server-validated count, and actions', () => {
  assert.match(source, /database/)
  assert.match(source, /statementCount/)
  assert.match(source, /服务端验证/)
  assert.match(source, /取消/)
  assert.match(source, /执行写入/)
  assert.match(source, /onCancel/)
  assert.match(source, /onConfirm/)
  assert.match(source, /executing/)
  assert.match(source, /disabled=\{executing\}/)
  assert.match(source, /正在执行/)
})
