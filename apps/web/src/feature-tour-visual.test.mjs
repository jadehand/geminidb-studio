import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const css = readFileSync(new URL('./feature-tour.css', import.meta.url), 'utf8')

test('引导遮罩不模糊底层界面并保持聚焦区域清晰', () => {
  assert.doesNotMatch(css, /backdrop-filter/)
  assert.match(css, /\.feature-tour-shade\{[^}]*background:transparent/)
  assert.match(css, /0 0 0 9999px #1119272e/)
})

test('深色主题使用独立的低强度聚焦遮罩', () => {
  assert.match(css, /0 0 0 9999px #05080d52/)
})
