import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const source=readFileSync(new URL('./App.tsx',import.meta.url),'utf8')

test('未连接时不再伪造 monitoring Database',()=>{
  assert.match(source,/load\('gdb\.workspace\.database',''\)/)
  assert.doesNotMatch(source,/load\('gdb\.workspace\.database','monitoring'\)/)
  assert.match(source,/setDatabase\(''\)/)
})

test('空 Database 使用明确的未连接状态',()=>{
  assert.match(source,/\{database\|\|'未连接'\}<span>·<\/span>/)
  assert.match(source,/\{database\|\|'未连接'\} \/ \{selectedTable \|\| '未选表'\}/)
})
