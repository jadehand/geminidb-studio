import assert from 'node:assert/strict'
import test from 'node:test'
import { readFile } from 'node:fs/promises'

test('catalog group buttons do not generate query success feedback while a data tab is active',async()=>{
  const source=await readFile(new URL('./App.tsx',import.meta.url),'utf8')

  assert.doesNotMatch(source,/onDoubleClick=\{\(\)=>queryGroup\(prefix,group\)\}/)
  assert.doesNotMatch(source,/function queryGroup\(/)
})
