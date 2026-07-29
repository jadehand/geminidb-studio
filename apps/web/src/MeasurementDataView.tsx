import { useEffect, useMemo, useRef, useState } from 'react'
import type { CSSProperties } from 'react'
import { bridge } from './api'
import { measurementDataPageForRequest, measurementDataRequestKey, measurementDay, measurementNanosecondsToBeijing, measurementRangeFromBeijingTime, nextMeasurementOffset, normalizeMeasurementDataOptions, type MeasurementDataOptions, type MeasurementDataResult, type ReadyConnectionSession } from './measurement-data'
import EditableFieldCell from './EditableFieldCell'
import { applyUpdateResult, setDraftValue, updatesFromDraft, type MeasurementDraftState } from './measurement-editing'
import { beginSubmission, emptySubmissionState, isCurrentSubmission, resetSubmissionForRequest, submissionCanBegin, type Submission } from './measurement-submission'
import { ResultGridZoomControls } from './ResultGridZoomControls'
import { stepGridZoom, useGridZoom } from './result-grid-zoom'
import type { MeasurementDataWorkspaceTab } from './types'

type Props = {
  tab: MeasurementDataWorkspaceTab
  readyConnectionSession: ReadyConnectionSession | null
  currentDatabase: string
  draftsByRequest: Record<string, MeasurementDraftState>
  onDraftsByRequestChange: (next: Record<string, MeasurementDraftState> | ((current: Record<string, MeasurementDraftState>) => Record<string, MeasurementDraftState>)) => void
  onGuardedAction: (tabId: string, hasDrafts: boolean, continuation: () => void) => void
  onSubmitReady: (tabId: string, submit: (() => Promise<boolean>) | null) => void
}

const PAGE_SIZES = [50, 100, 200, 500] as const

function timeTitle(value: string) {
  const beijing = measurementNanosecondsToBeijing(value)
  return beijing ? '北京时间：' + beijing : '精确纳秒时间：' + value
}

export default function MeasurementDataView({ tab, readyConnectionSession, currentDatabase, draftsByRequest, onDraftsByRequestChange, onGuardedAction, onSubmitReady }: Props) {
  const day = useMemo(() => measurementDay(tab.measurement), [tab.measurement])
  const requestKey = measurementDataRequestKey(tab, readyConnectionSession, currentDatabase)
  const available = requestKey !== null
  const [options, setOptions] = useState<MeasurementDataOptions>(() => normalizeMeasurementDataOptions())
  const [result, setResult] = useState<MeasurementDataResult | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [reload, setReload] = useState(0)
  const [rangeMode, setRangeMode] = useState<'whole' | 'custom'>('whole')
  const [startTime, setStartTime] = useState('00:00:00')
  const [endTime, setEndTime] = useState('23:59:59.999999999')
  const [rangeError, setRangeError] = useState('')
  const [zoom, setZoom] = useGridZoom()
  const [submitting, setSubmitting] = useState(false)
  const [submitStatus, setSubmitStatus] = useState<{ message: string; error: boolean } | null>(null)
  const submissionState = useRef(emptySubmissionState())
  const submitController = useRef<{ submission: Submission; controller: AbortController } | null>(null)
  const requestKeyRef = useRef(requestKey)
  requestKeyRef.current = requestKey

  useEffect(() => {
    setOptions(normalizeMeasurementDataOptions())
    setResult(null)
    setError('')
    setRangeMode('whole')
  }, [tab.id])

  useEffect(() => {
    const active = submitController.current
    if (active && active.submission.requestKey !== requestKey) {
      active.controller.abort()
      submitController.current = null
    }
    submissionState.current = resetSubmissionForRequest(submissionState.current)
    setSubmitting(false)
    setSubmitStatus(null)
    return () => {
      const current = submitController.current
      if (!current || current.submission.requestKey !== requestKey) return
      current.controller.abort()
      submitController.current = null
      submissionState.current = resetSubmissionForRequest(submissionState.current)
      setSubmitting(false)
    }
  }, [requestKey])

  useEffect(() => {
    if (!requestKey) {
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
        setResult({ requestKey, page:next })
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
  }, [requestKey, options, reload])

  const page = measurementDataPageForRequest(result, requestKey)
  const tags = page?.schema.tags ?? []
  const fields = page?.schema.fields ?? []
  const points = page?.points ?? []
  const displayedPage = page?.page ?? null
  const pageOffset = displayedPage?.offset ?? 0
  const hasMore = displayedPage?.hasMore ?? false
  const editable = available && readyConnectionSession?.environment !== 'prod'
  const drafts = requestKey ? draftsByRequest[requestKey] ?? {} : {}
  const draftCount = Object.keys(drafts).length
  const hasDrafts = draftCount > 0

  function runGuarded(continuation: () => void) {
    onGuardedAction(tab.id, hasDrafts, continuation)
  }

  function setWholeDay() {
    runGuarded(() => {
      setRangeMode('whole')
      setRangeError('')
      setOptions(current => normalizeMeasurementDataOptions({ limit: current.limit, offset: 0 }))
    })
  }

  function applyCustomRange() {
    try {
      const range = measurementRangeFromBeijingTime(day, startTime, endTime)
      runGuarded(() => {
        setRangeMode('custom')
        setRangeError('')
        setOptions(current => normalizeMeasurementDataOptions({ ...current, offset: 0, day, ...range }))
      })
    } catch (reason) {
      setRangeError(reason instanceof Error ? reason.message : '自定义时段无效')
    }
  }

  function movePage(direction: -1 | 1) {
    runGuarded(() => setOptions(current => normalizeMeasurementDataOptions({
      ...current,
      offset: nextMeasurementOffset(displayedPage, direction),
    })))
  }

  function updateDraft(point: typeof points[number], field: typeof fields[number], value: string | number | boolean) {
    if (!requestKey) return
    onDraftsByRequestChange(current => ({ ...current, [requestKey]: setDraftValue(current[requestKey] ?? {}, point, field, value) }))
  }

  function discardDrafts() {
    if (!requestKey) return
    onDraftsByRequestChange(current => ({ ...current, [requestKey]: {} }))
    setSubmitStatus(null)
  }

  async function submitDrafts(): Promise<boolean> {
    if (!requestKey || !page || submitting || !editable || !submissionCanBegin(submissionState.current)) return false
    const updates = updatesFromDraft(drafts, points, page.schema)
    if (updates.length === 0) {
      setSubmitStatus({ message: '没有可提交的修改。请刷新后检查仍保留的草稿。', error: true })
      return false
    }
    const started = beginSubmission(submissionState.current, requestKey)
    submissionState.current = started.state
    const controller = new AbortController()
    submitController.current?.controller.abort()
    submitController.current = { submission: started.submission, controller }
    setSubmitting(true)
    setSubmitStatus(null)
    try {
      const next = await bridge.updateMeasurementData({ database: tab.database, measurement: tab.measurement, updates }, controller.signal)
      if (controller.signal.aborted || !isCurrentSubmission(submissionState.current, started.submission, requestKeyRef.current)) return false
      const remaining = applyUpdateResult(drafts, next)
      onDraftsByRequestChange(current => ({ ...current, [started.submission.requestKey]: applyUpdateResult(current[started.submission.requestKey] ?? {}, next) }))
      const partial = next.summary.failed > 0 || next.summary.skipped > 0
      setSubmitStatus({ message: `成功 ${next.summary.succeeded} 项 · 失败 ${next.summary.failed} 项 · 未执行 ${next.summary.skipped} 项${next.failed ? ` · ${next.failed.message}` : ''}`, error: partial })
      setReload(value => value + 1)
      return Object.keys(remaining).length === 0
    } catch (reason) {
      if (!controller.signal.aborted && isCurrentSubmission(submissionState.current, started.submission, requestKeyRef.current)) setSubmitStatus({ message: reason instanceof Error ? `提交失败：${reason.message}` : '提交失败', error: true })
      return false
    } finally {
      if (!controller.signal.aborted && isCurrentSubmission(submissionState.current, started.submission, requestKeyRef.current)) {
        submissionState.current = resetSubmissionForRequest(submissionState.current)
        if (submitController.current?.submission.token === started.submission.token) submitController.current = null
        setSubmitting(false)
      }
    }
  }

  const submitDraftsRef = useRef(submitDrafts)
  submitDraftsRef.current = submitDrafts
  useEffect(() => {
    onSubmitReady(tab.id, () => submitDraftsRef.current())
    return () => onSubmitReady(tab.id, null)
  }, [onSubmitReady, tab.id])

  if (!available) {
    return <section className="measurement-data-unavailable" role="status"><div><h1>数据上下文不可用</h1><p>此数据页签属于 {tab.database} / {tab.measurement}，当前连接或 Database 已变化；不会使用当前上下文读取其他数据。</p></div></section>
  }

  return <section className="measurement-data-view" style={{ '--grid-zoom': zoom / 100 } as CSSProperties} onWheel={event => {
    if (!event.ctrlKey) return
    event.preventDefault()
    setZoom(stepGridZoom(zoom, event.deltaY < 0 ? 1 : -1))
  }}>
    <header className="measurement-data-head">
      <div><h1>{tab.measurement}</h1><p>{tab.database} · {editable ? '可编辑数据视图' : '生产环境只读'} · 服务端按时间倒序</p></div>
      <ResultGridZoomControls zoom={zoom} onChange={setZoom}/>
    </header>
    <div className="measurement-data-toolbar">
      <div className="measurement-range-controls" role="group" aria-label="时间范围">
        <button type="button" className={rangeMode === 'whole' ? 'active' : ''} aria-pressed={rangeMode === 'whole'} onClick={setWholeDay}>全天</button>
        <button type="button" className={rangeMode === 'custom' ? 'active' : ''} aria-pressed={rangeMode === 'custom'} onClick={() => setRangeMode('custom')} disabled={!day}>自定义时段</button>
        {rangeMode === 'custom' && <div className="measurement-custom-range">
          <label>北京时间 <input value={startTime} onChange={event => setStartTime(event.target.value)} placeholder="00:00:00" aria-label="开始北京时间"/></label>
          <span>至</span>
          <label><input value={endTime} onChange={event => setEndTime(event.target.value)} placeholder="23:59:59.999999999" aria-label="结束北京时间"/></label>
          <button type="button" onClick={applyCustomRange}>应用</button>
        </div>}
      </div>
      <label className="measurement-page-size">每页 <select value={options.limit} onChange={event => runGuarded(() => setOptions(current => normalizeMeasurementDataOptions({ ...current, limit: Number(event.target.value) as MeasurementDataOptions['limit'], offset: 0 })))}>{PAGE_SIZES.map(size => <option key={size} value={size}>{size}</option>)}</select> 行</label>
      <button type="button" onClick={() => runGuarded(() => setReload(value => value + 1))} disabled={loading}>刷新</button>
      {editable && hasDrafts && <><button type="button" onClick={discardDrafts} disabled={submitting}>放弃修改</button><button type="button" className="primary measurement-submit" onClick={submitDrafts} disabled={submitting}>{submitting ? '正在提交…' : `↑ 提交 ${draftCount} 项修改`}</button></>}
    </div>
    {rangeMode === 'custom' && <p className="measurement-range-hint">自定义时段按北京自然日 {day?.date ?? '不可用'} 解析，范围不会跨日。</p>}
    {rangeError && <p className="measurement-range-error" role="alert">{rangeError}</p>}
    {error && <div className="measurement-data-error" role="alert"><span>{error}</span><button type="button" onClick={() => runGuarded(() => setReload(value => value + 1))}>重试</button></div>}
    {submitStatus && <p className="measurement-submit-status" role={submitStatus.error ? 'alert' : 'status'}>{submitStatus.message}</p>}
    <div className="measurement-data-grid" aria-busy={loading}>
      {loading && !page ? <div className="measurement-data-loading">正在读取数据…</div> : <div className="measurement-data-scroll" tabIndex={0} aria-label="Measurement 数据表格"><table>
        <thead><tr><th rowSpan={2} className="pinned">时间<small>精确时间</small></th>{tags.length > 0 && <th colSpan={tags.length}>Tags</th>}{fields.length > 0 && <th colSpan={fields.length}>Fields</th>}</tr><tr>{tags.map(tag => <th key={'tag-' + tag}>{tag}</th>)}{fields.map(field => <th key={'field-' + field.name}>{field.name}<small>{field.type}</small></th>)}</tr></thead>
        <tbody>{points.map(point => <tr key={point.id}><td className="pinned measurement-time" title={timeTitle(point.time)}>{point.time}</td>{tags.map(tag => <td key={'tag-' + tag}>{point.tags[tag] ?? ''}</td>)}{fields.map(field => <EditableFieldCell key={'field-' + field.name} value={point.fields[field.name] ?? null} field={field} editable={editable && !submitting} draft={drafts[`${point.id}\u0000${field.name}`]} onChange={value => updateDraft(point, field, value)}/>)}</tr>)}</tbody>
      </table>{!loading && points.length === 0 && <div className="measurement-data-empty">当前时段没有数据。</div>}</div>}
    </div>
    <footer className="measurement-data-pagination"><span>{loading ? '正在更新…' : '偏移 ' + pageOffset + ' · ' + points.length + ' 行'}</span><div><button type="button" disabled={loading || pageOffset === 0} onClick={() => movePage(-1)}>上一页</button><button type="button" disabled={loading || !hasMore} onClick={() => movePage(1)}>下一页</button></div></footer>
  </section>
}
