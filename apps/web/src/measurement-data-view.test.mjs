import assert from 'node:assert/strict'
import test from 'node:test'
import { readFile } from 'node:fs/promises'
import { formatMeasurementTime, measurementDay, measurementRangeFromBeijingTime } from './measurement-data.ts'

test('formats exact nanosecond timestamps as raw, UTC, or Beijing time', () => {
  const timestamp = '1785400800123456789'

  assert.equal(formatMeasurementTime(timestamp, 'timestamp'), timestamp)
  assert.equal(formatMeasurementTime(timestamp, 'utc'), '2026-07-30 08:40:00.123456789 UTC')
  assert.equal(formatMeasurementTime(timestamp, 'beijing'), '2026-07-30 16:40:00.123456789 UTC+8')
})

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
  for (const label of ['时间显示', '时间戳', 'UTC', '北京时间']) assert.match(source, new RegExp(label))
  assert.match(source, /formatMeasurementTime\(point\.time, timeDisplay\)/)
  assert.match(source, /localStorage\.setItem\(TIME_DISPLAY_STORAGE_KEY, next\)/)
  assert.match(source, /ResultGridZoomControls/)
  assert.match(source, /AbortController/)
  assert.match(source, /controller\.signal\.aborted/)
  assert.match(source, /measurementDataRequestKey/)
  assert.match(source, /measurementRangeFromBeijingTime/)
  assert.match(source, /measurementNanosecondsToBeijing/)
  assert.match(source, /aria-pressed=\{rangeMode === 'whole'\}/)
  assert.match(source, /aria-pressed=\{rangeMode === 'custom'\}/)
  assert.match(source, /normalizeMeasurementDataOptions\(\{\s*day\s*\}\)/)
  assert.match(source, /normalizeMeasurementDataOptions\(\{\s*limit:\s*current\.limit,\s*offset:\s*0,\s*day\s*\}\)/)
  assert.match(css, /main:has\(> \.measurement-data-view\)>\.editor\{display:block/)
  assert.doesNotMatch(css, /main:has\(> \.measurement-data-view\)>\.editor\{display:none/)
  assert.doesNotMatch(source, /onDoubleClick/)
  assert.doesNotMatch(source, /contentEditable/)
})

test('measurement data view has complete dark theme surfaces', async () => {
  const [css, theme] = await Promise.all([
    readFile(new URL('./measurement-data-view.css', import.meta.url), 'utf8'),
    readFile(new URL('./theme.css', import.meta.url), 'utf8'),
  ])

  for (const surface of [
    'measurement-data-view',
    'measurement-data-toolbar',
    'measurement-data-scroll',
    'measurement-data-pagination',
    'measurement-data-error',
  ]) {
    assert.match(css, new RegExp(`:root\\[data-theme="dark"\\] \\.${surface}`))
  }
  assert.match(css, /:root\[data-theme="dark"\] \.measurement-data-scroll \.pinned/)
  assert.match(theme, /:root\[data-theme="dark"\] \.workspace-tabs/)
})

test('measurement data view searches the currently loaded page without issuing another request', async () => {
  const source = await readFile(new URL('./MeasurementDataView.tsx', import.meta.url), 'utf8')

  assert.match(source, /placeholder="搜索当前页"/)
  assert.match(source, /measurementPointMatchesSearch/)
  assert.match(source, /当前页匹配/)
})

test('app gives an active measurement data tab the full main workspace', async () => {
  const source = await readFile(new URL('./App.tsx', import.meta.url), 'utf8')

  assert.match(source, /MeasurementDataView/)
  assert.match(source, /activeMeasurementDataTab/)
})
