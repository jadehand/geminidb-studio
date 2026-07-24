import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const source=readFileSync(new URL('./App.tsx',import.meta.url),'utf8')

test('执行记录整行没有单击跳转行为',()=>{
  const historyBranch=source.slice(source.indexOf("view === 'history'"),source.indexOf("view === 'messages'"))
  assert.doesNotMatch(historyBranch,/<tr key=\{item\.id\} onClick=/)
  assert.match(historyBranch,/<tr key=\{item\.id\}>/)
})

test('只有双击命令语句才恢复到当前查询窗口',()=>{
  assert.match(source,/className=\"history-sql\"[^>]+onDoubleClick=\{\(\)=>onRestoreSql\(item\.sql\)\}/)
  assert.match(source,/双击命令语句，放入当前查询窗口/)
  assert.match(source,/onRestoreSql=\{value=>\{setSql\(value\);toast\('已放入当前查询窗口'\)\}\}/)
})
