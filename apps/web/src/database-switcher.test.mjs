import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const source=readFileSync(new URL('./App.tsx',import.meta.url),'utf8')

test('顶部明确标注 Database，并提示无需执行 USE',()=>{
  assert.match(source,/<span>Database<\/span>/)
  assert.match(source,/aria-label="当前 Database"/)
  assert.match(source,/无需执行 <code>USE database_xxx<\/code>/)
})

test('首次提示只在多个 Database 时显示，并可永久关闭',()=>{
  assert.match(source,/databaseHintOpen&&databases\.length>1/)
  assert.match(source,/save\('gdb\.databaseSwitcherSeen',true\)/)
  assert.match(source,/onClick=\{dismissDatabaseHint\}>知道了/)
  assert.match(source,/async function changeDatabase[\s\S]*dismissDatabaseHint\(\)/)
})
