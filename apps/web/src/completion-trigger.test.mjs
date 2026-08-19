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

test('自动补全由默认开启的开关控制，移除 Ctrl+Space 提示',()=>{
  assert.match(source,/editor\.trigger\('geminidb-studio','editor\.action\.triggerSuggest',\{\}\)/)
  assert.doesNotMatch(source,/getAction\('editor\.action\.triggerSuggest'\)/)
  assert.doesNotMatch(source,/KeyCode\.Space/)
  assert.match(source,/completionEnabled:boolean/)
  assert.match(source,/completionEnabledRef\.current/)
  assert.match(source,/hideSuggestWidget/)
  assert.match(source,/completionEnabled\?'补全：开':'补全：关'/)
})
