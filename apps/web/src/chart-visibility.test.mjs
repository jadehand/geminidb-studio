import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const source = readFileSync(new URL('./App.tsx', import.meta.url), 'utf8')

test('未完成的图表页签不在结果区展示', () => {
  assert.match(source, /visibleResultViews[^=]*=\s*\['result', 'history', 'messages', 'favorites'\]/)
  assert.doesNotMatch(source, /\(\['result','chart','history','messages','favorites'\]/)
})

test('升级前停留在图表页的工作区自动回到执行结果', () => {
  assert.match(source, /view === 'chart' \? 'result' : view/)
  assert.match(source, /setView\(visibleResultView\(snapshot\.resultView\)\)/)
})
