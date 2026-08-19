import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
const source=readFileSync(new URL('./App.tsx',import.meta.url),'utf8')
test('results export is one menu with three formats and separate settings',()=>{
  assert.match(source,/<summary>导出<\/summary>/)
  for(const format of ['导出 CSV','导出 Excel','导出 JSON']) assert.match(source,new RegExp(format))
  assert.match(source,/导出设置/)
  assert.doesNotMatch(source,/className="wide-export-action" onClick=\{exportCsv\}/)
})

test('export settings show the resolved current directory instead of an example placeholder',()=>{
  const desktop=readFileSync(new URL('./desktop.ts',import.meta.url),'utf8')
  assert.match(desktop,/currentExportDirectory/)
  assert.match(source,/currentExportDirectory\(exportDirectory\)/)
  assert.doesNotMatch(source,/placeholder="例如：D:\\\\geminidb-exports"/)
})
