import assert from 'node:assert/strict'
import test from 'node:test'
import { nextTheme, resolveTheme } from './theme.ts'

test('跟随系统时解析为系统当前颜色', () => {
  assert.equal(resolveTheme('system', false), 'light')
  assert.equal(resolveTheme('system', true), 'dark')
})

test('主题按钮按系统、浅色、深色循环', () => {
  assert.equal(nextTheme('system'), 'light')
  assert.equal(nextTheme('light'), 'dark')
  assert.equal(nextTheme('dark'), 'system')
})
