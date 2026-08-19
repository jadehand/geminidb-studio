import test from 'node:test'
import assert from 'node:assert/strict'
import { appendSqlToNote, noteTags, noteTitle, parseMarkdown, safeNoteFilename, searchNotes } from './notes.ts'

test('derives safe unique markdown filenames', () => {
  assert.equal(safeNoteFilename('查询/排障:*?', ['查询排障.md']), '查询排障 (2).md')
})

test('extracts title and tags and searches body', () => {
  const note={path:'ops/a.md',content:'# 延迟排查\n检查 #InfluxQL 的时间范围',modifiedMs:1}
  assert.equal(noteTitle(note.content,note.path),'延迟排查')
  assert.deepEqual(noteTags(note.content),['InfluxQL'])
  assert.equal(searchNotes([note],'时间范围').length,1)
})

test('appends current query as an influxql code block', () => {
  assert.match(appendSqlToNote('# 查询','SELECT * FROM cpu'),/```influxql\nSELECT \* FROM cpu\n```/)
})

test('parses useful markdown without interpreting raw html', () => {
  const blocks=parseMarkdown('# 标题\n\n|字段|说明|\n|---|---|\n|time|时间|\n\n```influxql\nSELECT 1\n```\n\n<script>alert(1)</script>')
  assert.deepEqual(blocks.map(block=>block.type),['heading','table','code','paragraph'])
  assert.equal(blocks.at(-1).text,'<script>alert(1)</script>')
})
