import assert from 'node:assert/strict'
import test from 'node:test'
import { readFile } from 'node:fs/promises'

test('measurement leaf actions are offered through an accessible action menu', async () => {
  const [menu, app] = await Promise.all([
    readFile(new URL('./MeasurementActionMenu.tsx', import.meta.url), 'utf8'),
    readFile(new URL('./App.tsx', import.meta.url), 'utf8'),
  ])

  for (const label of ['查看数据', '新建查询', '查看 Schema']) assert.match(menu, new RegExp(label))
  assert.match(menu, /Escape/)
  assert.match(menu, /ArrowDown/)
  assert.match(menu, /ArrowUp/)
  assert.match(menu, /Enter/)
  assert.match(menu, /addEventListener\('pointerdown'/)
  assert.match(menu, /if \(!menuRef\.current\?\.contains\(event\.target as Node\)\) onClose\(false\)/)
  assert.match(menu, /if \(event\.key === 'Escape'\) \{\s+event\.preventDefault\(\)\s+onClose\(true\)/)
  assert.match(app, /onContextMenu/)
  assert.match(app, /openMeasurementDataTab/)
  assert.match(app, /waitForCurrentSchema/)
  assert.match(app, /requestAnimationFrame\(\(\) => \{ if \(!measurementActionTrigger\.current\) trigger\?\.focus\(\) \}\)/)
  assert.match(app, /onClick=\{event => openMeasurementActions\(table, event\.currentTarget\)\}/)
  assert.doesNotMatch(app, /onClick=\{\(\) => void chooseTable\(table\)\}/)
  assert.doesNotMatch(app, /onDoubleClick=\{\(\)=>queryGroup\(prefix,group\)\}/)
})

test('measurement action menu has coordinated dark theme surfaces', async () => {
  const css = await readFile(new URL('./sidebar-polish.css', import.meta.url), 'utf8')

  assert.match(css, /:root\[data-theme="dark"\] \.measurement-action-menu \{/)
  assert.match(css, /background: #202833/)
  assert.match(css, /border-color: #3d4856/)
  assert.match(css, /:root\[data-theme="dark"\] \.measurement-action-menu button:hover/)
})
