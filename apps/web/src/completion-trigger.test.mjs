import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const source=readFileSync(new URL('./QueryEditor.tsx',import.meta.url),'utf8')

test('自动补全监听当前 Monaco 支持的真实键盘事件',()=>{
  assert.match(source,/contrib\/suggest\/browser\/suggestController/)
  assert.match(source,/editor\.onKeyUp\(event=>/)
  assert.match(source,/const text=event\.browserEvent\.key/)
  assert.match(source,/shouldAutoSuggest\(beforeCursor,text\)/)
})

test('自动、按钮和快捷键统一触发 Monaco Suggest',()=>{
  assert.match(source,/editor\.trigger\('geminidb-studio','editor\.action\.triggerSuggest',\{\}\)/)
  assert.doesNotMatch(source,/getAction\('editor\.action\.triggerSuggest'\)/)
  assert.match(source,/monaco\.KeyMod\.CtrlCmd \| monaco\.KeyCode\.Space/)
  assert.match(source,/>显示补全<\/button>/)
})
