import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const css=await readFile(new URL('./responsive-layout.css',import.meta.url),'utf8')

function declarations(selector) {
  const escaped=selector.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')
  return[...css.matchAll(new RegExp(`${escaped}\\{([^}]*)\\}`,'g'))].map(match=>match[1]).join(';')
}

test('result toolbar lets the export menu extend over the scrollable result body',()=>{
  const toolbar=declarations('.result-tabs')
  const body=declarations('.result-body')
  assert.match(toolbar,/overflow:visible/)
  assert.match(toolbar,/position:relative/)
  assert.match(toolbar,/z-index:\d+/)
  assert.match(body,/position:relative/)
  assert.match(body,/z-index:\d+/)
})
