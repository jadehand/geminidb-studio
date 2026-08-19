import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const css=(await readFile(new URL('./responsive-layout.css',import.meta.url),'utf8'))
  +(await readFile(new URL('./theme.css',import.meta.url),'utf8'))

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

test('dark theme gives the export menu a readable surface and item states',()=>{
  const menu=declarations(':root[data-theme="dark"] .action-menu>div')
  const item=declarations(':root[data-theme="dark"] .action-menu>div button')
  const hover=declarations(':root[data-theme="dark"] .action-menu>div button:hover')

  assert.match(menu,/background:#202833/)
  assert.match(menu,/border-color:#465262/)
  assert.match(item,/color:#d4dde8/)
  assert.match(hover,/background:#2b3542/)
})
