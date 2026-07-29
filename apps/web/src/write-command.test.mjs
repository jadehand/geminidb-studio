import assert from 'node:assert/strict'
import test from 'node:test'
import { formatCommandSummary, isWriteScript } from './write-command.ts'

test('recognizes INSERT, INSERT INTO, and WRITE scripts', () => {
  assert.equal(isWriteScript('INSERT cpu value=1 1'), true)
  assert.equal(isWriteScript('  INSERT INTO cpu value=1 1'), true)
  assert.equal(isWriteScript('WRITE cpu value=1 1'), true)
})

test('keeps SELECT on the query execution path', () => {
  assert.equal(isWriteScript('SELECT * FROM cpu'), false)
})

test('formats complete command batch results exactly', () => {
  assert.equal(
    formatCommandSummary({ total:3, succeeded:1, failed:1, skipped:1 }),
    '成功 1 条 · 失败 1 条 · 未执行 1 条',
  )
})
