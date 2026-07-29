import assert from 'node:assert/strict'
import test from 'node:test'
import { readFile } from 'node:fs/promises'

test('catalog group interaction only expands or collapses its measurement leaves', async () => {
  const source = await readFile(new URL('./App.tsx', import.meta.url), 'utf8')

  assert.match(source, /onClick=\{\(\)=>toggleGroup\(prefix\)\}/)
  assert.doesNotMatch(source, /queryGroup\(/)
  assert.doesNotMatch(source, /onDoubleClick=\{\(\)=>queryGroup\(prefix,group\)\}/)
})
