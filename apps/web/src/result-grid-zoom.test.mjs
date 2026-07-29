import assert from 'node:assert/strict'
import test from 'node:test'
import { normalizeGridZoom, stepGridZoom } from './result-grid-zoom.ts'

test('grid zoom clamps and rounds to ten percent steps', () => {
  assert.equal(normalizeGridZoom(73), 80)
  assert.equal(normalizeGridZoom(126), 130)
  assert.equal(normalizeGridZoom(999), 160)
})

test('grid zoom steps between 80 and 160', () => {
  assert.equal(stepGridZoom(100, 1), 110)
  assert.equal(stepGridZoom(80, -1), 80)
  assert.equal(stepGridZoom(160, 1), 160)
})
