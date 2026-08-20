import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const css=readFileSync(new URL('./data-grid.css',import.meta.url),'utf8')
const responsive=readFileSync(new URL('./responsive-layout.css',import.meta.url),'utf8')
const table=readFileSync(new URL('./ResultsTable.tsx',import.meta.url),'utf8')

test('横向滚动时左上角表头位于普通表头和固定数据列之上',()=>{
  assert.match(css,/\.grid-scroll thead th\{[^}]*z-index:3/)
  assert.match(css,/\.grid-scroll tbody td\.pinned\{[^}]*left:0;z-index:2/)
  assert.match(css,/\.grid-scroll thead th\.pinned\{[^}]*left:0;z-index:4/)
})

test('列筛选面板不被表头裁剪且表头仍可固定',()=>{
  const measurementCss=readFileSync(new URL('./measurement-data-view.css',import.meta.url),'utf8')
  assert.match(css,/\.grid-scroll th\.result-column-head\{overflow:visible\}/)
  assert.doesNotMatch(css,/\.grid-scroll th\{[^}]*overflow:auto/)
  assert.match(measurementCss,/\.grid-scroll thead th\.result-column-head\{position:sticky!important\}/)
  assert.match(table,/openColumn===column\?'menu-open'/)
  assert.match(css,/\.grid-scroll thead th\.menu-open\{z-index:6\}/)
})

test('窄工作区仍保持表头和数据列固定',()=>{
  assert.doesNotMatch(responsive,/\.grid-scroll \.pinned\{position:static/)
  assert.match(responsive,/\.grid-scroll thead th\.pinned\{[^}]*position:sticky[^}]*top:0[^}]*left:0/)
})
