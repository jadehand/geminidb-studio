import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'

const source = readFileSync(new URL('./BulkDataWizard.tsx', import.meta.url), 'utf8')

test('Tag 与各 Field 类型只提供约定的生成方式', () => {
  assert.match(source, /TAG_MODES\s*=\s*\[[\s\S]*?'list'[\s\S]*?'sequence'[\s\S]*?'existing'/)
  assert.match(source, /NUMERIC_MODES\s*=\s*\[[\s\S]*?'fixed'[\s\S]*?'random-number'[\s\S]*?'increment'/)
  assert.match(source, /STRING_MODES\s*=\s*\[[\s\S]*?'fixed'[\s\S]*?'string-list'/)
  assert.match(source, /BOOLEAN_MODES\s*=\s*\[[\s\S]*?'fixed'[\s\S]*?'random-boolean'/)
})

test('约束操作符按类型过滤并使用自绘菜单', () => {
  assert.match(source, /NUMERIC_OPERATORS\s*=\s*\['>','>=','<','<=','=','!='\]/)
  assert.match(source, /EQUALITY_OPERATORS\s*=\s*\['=','!='\]/)
  assert.doesNotMatch(source, /<select[^>]+className="constraint-operator"/)
  assert.match(source, /aria-haspopup="listbox"/)
  assert.match(source, /className="operator-symbol"/)
  assert.match(source, /className="operator-chevron"/)
})

test('生成参数随模式变化，不保留无意义横线占位', () => {
  assert.doesNotMatch(source, />—<\/span>/)
  assert.match(source, /generator\.kind === 'sequence'/)
  assert.match(source, /generator\.kind === 'random-number'/)
  assert.match(source, /generator\.kind === 'random-boolean'/)
})

test('时间配置和弹窗键盘行为完整', () => {
  assert.match(source, /\[1,2,3,4,5,6,7\]\.map/)
  assert.match(source, /自定义秒数/)
  assert.match(source, /event\.key === 'Escape'/)
  assert.match(source, /aria-current=\{step === index \+ 1 \? 'step'/)
})
