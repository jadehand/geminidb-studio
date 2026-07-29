import assert from 'node:assert/strict'
import test from 'node:test'
import { readFile } from 'node:fs/promises'
import { measurementDay, measurementRangeFromBeijingTime } from './measurement-data.ts'

test('converts Beijing intra-day time inputs to inclusive nanosecond bounds', () => {
  const day = measurementDay('cpu_1784995200')

  assert.deepEqual(measurementRangeFromBeijingTime(day, '00:00:00', '23:59:59.999999999'), {
    startNs: '1784995200000000000',
    endNs: '1785081599999999999',
  })
})

test('rejects reversed or invalid Beijing intra-day custom time inputs', () => {
  const day = measurementDay('cpu_1784995200')

  assert.throws(() => measurementRangeFromBeijingTime(day, '18:00', '08:00'), /start/i)
  assert.throws(() => measurementRangeFromBeijingTime(day, '24:00', '24:00'), /time/i)
})

test('measurement data client encodes its complete read-only page query', async () => {
  const source = await readFile(new URL('./api.ts', import.meta.url), 'utf8')

  assert.match(source, /measurementData\s*:/)
  assert.match(source, /\/measurement-data\?database=\$\{encodeURIComponent\(database\)\}/)
  assert.match(source, /measurement=\$\{encodeURIComponent\(measurement\)\}/)
  assert.match(source, /limit=\$\{encodeURIComponent\(String\(options\.limit\)\)\}/)
  assert.match(source, /offset=\$\{encodeURIComponent\(String\(options\.offset\)\)\}/)
  assert.match(source, /signal/)
})

test('data view provides the read-only toolbar, grouped columns, and request-safety guards', async () => {
  const [source, css] = await Promise.all([
    readFile(new URL('./MeasurementDataView.tsx', import.meta.url), 'utf8'),
    readFile(new URL('./measurement-data-view.css', import.meta.url), 'utf8'),
  ])

  for (const label of ['全天', '自定义时段', '每页', '刷新', '时间', 'Tags', 'Fields']) assert.match(source, new RegExp(label))
  assert.match(source, /ResultGridZoomControls/)
  assert.match(source, /AbortController/)
  assert.match(source, /controller\.signal\.aborted/)
  assert.match(source, /tab\.connectionId !== currentConnectionId \|\| tab\.database !== currentDatabase/)
  assert.match(source, /measurementRangeFromBeijingTime/)
  assert.match(source, /aria-pressed=\{rangeMode === 'whole'\}/)
  assert.match(source, /aria-pressed=\{rangeMode === 'custom'\}/)
  assert.match(css, /main:has\(> \.measurement-data-view\)>\.editor\{display:block/)
  assert.doesNotMatch(css, /main:has\(> \.measurement-data-view\)>\.editor\{display:none/)
  assert.doesNotMatch(source, /onDoubleClick/)
  assert.doesNotMatch(source, /contentEditable/)
})

test('app gives an active measurement data tab the full main workspace', async () => {
  const source = await readFile(new URL('./App.tsx', import.meta.url), 'utf8')

  assert.match(source, /MeasurementDataView/)
  assert.match(source, /activeMeasurementDataTab/)
})
