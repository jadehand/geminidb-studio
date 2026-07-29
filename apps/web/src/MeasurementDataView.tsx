import { useEffect, useMemo, useState } from 'react'
import type { CSSProperties } from 'react'
import { bridge } from './api'
import { findTimeHover } from './influxql-time-hover'
import { measurementDay, measurementRangeFromBeijingTime, normalizeMeasurementDataOptions, type MeasurementDataOptions, type MeasurementDataPage } from './measurement-data'
import { ResultGridZoomControls } from './ResultGridZoomControls'
import { DEFAULT_GRID_ZOOM, GRID_ZOOM_STORAGE_KEY, normalizeGridZoom, stepGridZoom } from './result-grid-zoom'
import type { MeasurementDataWorkspaceTab } from './types'

type Props = {
  tab: MeasurementDataWorkspaceTab
  currentConnectionId: string | undefined
  currentDatabase: string
}

const PAGE_SIZES = [50, 100, 200, 500] as const

function timeTitle(value: string) {
  const hover = findTimeHover(`time = '${value}'`, 10)
  return hover ? `北京时间：${hover.beijing}` : `精确纳秒时间：${value}`
}

export default function MeasurementDataView({ tab, currentConnectionId, currentDatabase }: Props) {
  const day = useMemo(() => measurementDay(tab.measurement), [tab.measurement])
  const available = tab.connectionId === currentConnectionId && tab.database === currentDatabase
  const [options, setOptions] = useState<MeasurementDataOptions>(() => normalizeMeasurementDataOptions())
  const [page, setPage] = useState<MeasurementDataPage | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [reload, setReload] = useState(0)
  const [rangeMode, setRangeMode] = useState<'whole' | 'custom'>('whole')
  const [startTime, setStartTime] = useState('00:00:00')
  const [endTime, setEndTime] = useState('23:59:59.999999999')
  const [rangeError, setRangeError] = useState('')
  const [zoom, setZoom] = useState(() => normalizeGridZoom(localStorage.getItem(GRID_ZOOM_STORAGE_KEY) ?? DEFAULT_GRID_ZOOM))

  useEffect(() => {
    localStorage.setItem(GRID_ZOOM_STORAGE_KEY, String(zoom))
  }, [zoom])

  useEffect(() => {
    setOptions(normalizeMeasurementDataOptions())
    setPage(null)
    setError('')
    setRangeMode('whole')
  }, [tab.id])

  useEffect(() => {
    if (tab.connectionId !== currentConnectionId || tab.database !== currentDatabase) {
      setLoading(false)
      return
    }
    const controller = new AbortController()
    let disposed = false
    setLoading(true)
    setError('')
    void bridge.measurementData(tab.database, tab.measurement, options, controller.signal)
      .then(next => {
        if (disposed || controller.signal.aborted) return
        setPage(next)
      })
      .catch(reason => {
        if (disposed || controller.signal.aborted) return
        setError(reason instanceof Error ? reason.message : '读取 Measurement 数据失败')
      })
      .finally(() => {
        if (!disposed && !controller.signal.aborted) setLoading(false)
      })
    return () => {
      disposed = true
      controller.abort()
    }
  }, [currentConnectionId, currentDatabase, options, reload, tab.connectionId, tab.database, tab.measurement])

  const tags = page?.schema.tags ?? []
  const fields = page?.schema.fields ?? []
  const points = page?.points ?? []
  const pageOffset = page?.page.offset ?? options.offset
  const hasMore = page?.page.hasMore ?? false

  function setWholeDay() {
    setRangeMode('whole')
    setRangeError('')
    setOptions(current => normalizeMeasurementDataOptions({ limit: current.limit, offset: 0 }))
  }

  function applyCustomRange() {
    try {
      const range = measurementRangeFromBeijingTime(day, startTime, endTime)
      setRangeMode('custom')
      setRangeError('')
      setOptions(current => normalizeMeasurementDataOptions({ ...current, offset: 0, day, ...range }))
    } catch (reason) {
      setRangeError(reason instanceof Error ? reason.message : '自定义时段无效')
    }
  }

  if (!available) return <section className="measurement-data-unavailable" role="status"><div><h1>数据上下文不可用</h1><p>此数据页签属于 {tab.database} / {tab.measurement}，当前连接或 Database 已变化；不会使用当前上下文读取其他数据。</p></div></section>

  return <section className="measurement-data-view" style={{ '--grid-zoom': zoom / 100 } as CSSProperties} onWheel={event => {
    if (!event.ctrlKey) return
    event.preventDefault()
    setZoom(current => stepGridZoom(current, event.deltaY < 0 ? 1 : -1))
  }}>
    <header className="measurement-data-head">
      <div><h1>{tab.measurement}</h1><p>{tab.database} · 只读数据视图 · 服务端按时间倒序</p></div>
      <ResultGridZoomControls zoom={zoom} onChange={value => setZoom(normalizeGridZoom(value))}/>
    </header>
    <div className="measurement-data-toolbar">
      <div className="measurement-range-controls" role="group" aria-label="时间范围">
        <button type="button" className={rangeMode === 'whole' ? 'active' : ''} onClick={setWholeDay}>全天</button>
        <button type="button" className={rangeMode === 'custom' ? 'active' : ''} onClick={() => setRangeMode('custom')} disabled={!day}>自定义时段</button>
        {rangeMode === 'custom' && <div className="measurement-custom-range">
          <label>北京时间 <input value={startTime} onChange={event => setStartTime(event.target.value)} placeholder="00:00:00" aria-label="开始北京时间"/></label>
          <span>至</span>
          <label><input value={endTime} onChange={event => setEndTime(event.target.value)} placeholder="23:59:59.999999999" aria-label="结束北京时间"/></label>
          <button type="button" onClick={applyCustomRange}>应用</button>
        </div>}
      </div>
      <label className="measurement-page-size">每页 <select value={options.limit} onChange={event => setOptions(current => normalizeMeasurementDataOptions({ ...current, limit: Number(event.target.value) as MeasurementDataOptions['limit'], offset: 0 }))}>{PAGE_SIZES.map(size => <option key={size} value={size}>{size}</option>)}</select> 行</label>
      <button type="button" onClick={() => setReload(value => value + 1)} disabled={loading}>刷新</button>
    </div>
    {rangeMode === 'custom' && <p className="measurement-range-hint">自定义时段按北京自然日 {day?.date ?? '不可用'} 解析，范围不会跨日。</p>}
    {rangeError && <p className="measurement-range-error" role="alert">{rangeError}</p>}
    {error && <div className="measurement-data-error" role="alert"><span>{error}</span><button type="button" onClick={() => setReload(value => value + 1)}>重试</button></div>}
    <div className="measurement-data-grid" aria-busy={loading}>
      {loading && !page ? <div className="measurement-data-loading">正在读取数据…</div> : <div className="measurement-data-scroll" tabIndex={0} aria-label="Measurement 数据表格"><table>
        <thead><tr><th rowSpan={2} className="pinned">时间<small>精确时间</small></th>{tags.length > 0 && <th colSpan={tags.length}>Tags</th>}{fields.length > 0 && <th colSpan={fields.length}>Fields</th>}</tr><tr>{tags.map(tag => <th key={`tag-${tag}`}>{tag}</th>)}{fields.map(field => <th key={`field-${field.name}`}>{field.name}<small>{field.type}</small></th>)}</tr></thead>
        <tbody>{points.map(point => <tr key={point.id}><td className="pinned measurement-time" title={timeTitle(point.time)}>{point.time}</td>{tags.map(tag => <td key={`tag-${tag}`}>{point.tags[tag] ?? ''}</td>)}{fields.map(field => <td key={`field-${field.name}`} className={point.fields[field.name] == null ? 'measurement-missing-field' : ''}>{point.fields[field.name] ?? ''}</td>)}</tr>)}</tbody>
      </table>{!loading && points.length === 0 && <div className="measurement-data-empty">当前时段没有数据。</div>}</div>}
    </div>
    <footer className="measurement-data-pagination"><span>{loading ? '正在更新…' : `偏移 ${pageOffset} · ${points.length} 行`}</span><div><button type="button" disabled={loading || pageOffset === 0} onClick={() => setOptions(current => normalizeMeasurementDataOptions({ ...current, offset: Math.max(0, current.offset - current.limit) }))}>上一页</button><button type="button" disabled={loading || !hasMore} onClick={() => setOptions(current => normalizeMeasurementDataOptions({ ...current, offset: current.offset + current.limit }))}>下一页</button></div></footer>
  </section>
}
