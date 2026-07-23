import assert from 'node:assert/strict'
import test from 'node:test'
import { csvContent, excelContent, jsonContent } from './result-export.ts'

const rows = [
  { time: 1784794080000, api: '/v2/chat/completions', note: '逗号,引号"与<&>' },
  { time: 1784794020000, api: '/v1/chat/completions', note: null },
]

test('CSV 包含 UTF-8 BOM、全部行并正确转义', () => {
  const content = csvContent(rows)
  assert.ok(content.startsWith('\ufeff'))
  assert.match(content, /"逗号,引号""与<&>"/)
  assert.equal(content.trim().split('\n').length, 3)
})

test('Excel XML 包含工作表、全部行并正确转义', () => {
  const content = excelContent(rows)
  assert.match(content, /Excel\.Sheet/)
  assert.match(content, /1784794080000/)
  assert.match(content, /逗号,引号"与&lt;&amp;&gt;/)
  assert.equal((content.match(/<Row>/g) || []).length, 3)
})

test('JSON 保留字段和值', () => {
  assert.deepEqual(JSON.parse(jsonContent(rows)), rows)
})
