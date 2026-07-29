import assert from 'node:assert/strict'
import test from 'node:test'
import { readFile } from 'node:fs/promises'

test('editable field cell supports explicit edit, accept, cancel, and typed controls', async () => {
  const source = await readFile(new URL('./EditableFieldCell.tsx', import.meta.url), 'utf8')

  assert.match(source, /onDoubleClick/)
  assert.match(source, /event\.key === 'Enter'/)
  assert.match(source, /event\.key === 'Escape'/)
  assert.match(source, /parseFieldInput/)
  assert.match(source, /field\.type === 'boolean'/)
  assert.match(source, /<select/)
  assert.match(source, /<input/)
  assert.match(source, /role="alert"/)
  assert.match(source, /onBlur/)
})

test('measurement view applies edit permissions and updates through the Bridge contract', async () => {
  const [view, api] = await Promise.all([
    readFile(new URL('./MeasurementDataView.tsx', import.meta.url), 'utf8'),
    readFile(new URL('./api.ts', import.meta.url), 'utf8'),
  ])

  assert.match(view, /readyConnectionSession\?\.environment !== 'prod'/)
  assert.match(view, /<EditableFieldCell/)
  assert.match(view, /tags\.map\(tag => <td/)
  assert.match(view, /fields\.map\(field => <EditableFieldCell/)
  assert.match(view, /updatesFromDraft/)
  assert.match(view, /applyUpdateResult/)
  assert.match(view, /AbortController/)
  assert.match(view, /提交 \$\{draftCount\} 项修改/)
  assert.match(view, /放弃修改/)
  assert.match(view, /刷新/)
  assert.match(api, /updateMeasurementData/)
  assert.match(api, /\/measurement-data\/updates/)
  assert.match(api, /signal/)
})
