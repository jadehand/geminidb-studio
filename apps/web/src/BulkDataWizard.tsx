import { useEffect, useMemo, useRef, useState } from 'react'
import { bridge, BridgeError } from './api'
import {
  appendBulkHistory, clearActiveBulkRun, clearBulkDraft, copyHistoryToDraft, estimateBulkDraft,
  loadActiveBulkRun, loadBulkDraft, loadBulkHistory, saveActiveBulkRun, saveBulkDraft, stepForBulkError,
} from './bulk-data'
import { isUnfinishedBulkJob, nextPollDelay } from './app-close'
import { dayTablePrefix, tableTimestamp } from './day-tables'
import type {
  BulkConstraint, BulkDraft, BulkFieldDraft, BulkJobStatus, BulkPreview, BulkTagDraft,
  Connection, FieldGenerator, MeasurementSchema, TagGenerator,
} from './types'

export type BulkDataWizardProps = {
  open: boolean
  connection: Connection
  connections: Connection[]
  databases: string[]
  database: string
  tables: string[]
  activeJob: BulkJobStatus | null
  onConnectionChange(connection: Connection): void
  onDatabaseChange(database: string): void
  onClose(): void
  onJobChange(job: BulkJobStatus | null): void
  onNotify(message: string): void
}

const STEPS = ['目标与 RP', '时间与天表', '字段与约束', '预览与执行']
const TAG_MODES = ['list', 'sequence', 'existing'] as const
const NUMERIC_MODES = ['fixed', 'random-number', 'increment'] as const
const STRING_MODES = ['fixed', 'string-list'] as const
const BOOLEAN_MODES = ['fixed', 'random-boolean'] as const
const NUMERIC_OPERATORS = ['>','>=','<','<=','=','!='] as const
const EQUALITY_OPERATORS = ['=','!='] as const
const PRESET_INTERVALS = [[1,'1 秒'],[5,'5 秒'],[10,'10 秒'],[30,'30 秒'],[60,'1 分钟'],[300,'5 分钟'],[900,'15 分钟'],[1800,'30 分钟'],[3600,'1 小时']] as const
const OPERATOR_LABELS: Record<BulkConstraint['operator'], string> = { '>':'>', '>=':'≥', '<':'<', '<=':'≤', '=':'=', '!=':'≠' }
const formatDate = (date:Date) => new Intl.DateTimeFormat('en-CA', { timeZone:'Asia/Shanghai', year:'numeric', month:'2-digit', day:'2-digit' }).format(date)
const beijingDate = (value:string) => Math.floor(Date.parse(`${value}T00:00:00+08:00`) / 1000)
const duration = (ms:number) => ms === 0 ? '永久保留' : ms % 86400000 === 0 ? `${ms / 86400000} 天` : `${Math.round(ms / 3600000)} 小时`
const commaValues = (value:string) => value.split(/[\n,]/).map(item => item.trim()).filter(Boolean)
const numericType = (type:string) => ['float', 'integer'].includes(type.toLowerCase())

function initialField(name:string, type:string): BulkFieldDraft {
  const normalized = type.toLowerCase()
  const generator:FieldGenerator = normalized === 'boolean'
    ? { kind:'fixed', value:false }
    : normalized === 'string'
      ? { kind:'fixed', value:'' }
      : { kind:'random-number', min:0, max:100 }
  return { name, type, generator }
}

function tagValues(tag:BulkTagDraft) {
  if (tag.generator.kind === 'sequence') {
    const { prefix, start, count, padding } = tag.generator
    if (!Number.isSafeInteger(start) || !Number.isSafeInteger(count) || count < 1 || count > 1000 || !Number.isInteger(padding) || padding < 0 || padding > 12) return []
    return Array.from({ length:count }, (_, index) => `${prefix}${String(start + index).padStart(padding, '0')}`)
  }
  return tag.generator.values
}

function fieldModes(type:string) {
  const normalized = type.toLowerCase()
  if (normalized === 'string') return STRING_MODES
  if (normalized === 'boolean') return BOOLEAN_MODES
  return NUMERIC_MODES
}

function validField(field:BulkFieldDraft) {
  const generator = field.generator
  const integer = field.type.toLowerCase() === 'integer'
  if (generator.kind === 'fixed') return typeof generator.value === 'number' ? Number.isFinite(generator.value) && (!integer || Number.isInteger(generator.value)) : true
  if (generator.kind === 'random-number') return Number.isFinite(generator.min) && Number.isFinite(generator.max) && generator.min <= generator.max && (!integer || (Number.isInteger(generator.min) && Number.isInteger(generator.max)))
  if (generator.kind === 'increment') return Number.isFinite(generator.start) && Number.isFinite(generator.step) && (!integer || (Number.isInteger(generator.start) && Number.isInteger(generator.step)))
  if (generator.kind === 'string-list') return generator.values.length > 0 && generator.values.every(Boolean)
  return Number.isFinite(generator.truePercent) && generator.truePercent >= 0 && generator.truePercent <= 100
}

function generatorLabel(kind:TagGenerator['kind'] | FieldGenerator['kind']) {
  return {
    list:'候选列表', sequence:'序列', existing:'读取已有值',
    fixed:'固定值', 'random-number':'范围随机', increment:'递增',
    'string-list':'候选列表', 'random-boolean':'概率随机',
  }[kind]
}

function OperatorPicker({ value, operators, onChange }:{
  value:BulkConstraint['operator']
  operators:readonly BulkConstraint['operator'][]
  onChange(value:BulkConstraint['operator']):void
}) {
  const [open, setOpen] = useState(false)
  const root = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!open) return
    const outside = (event:MouseEvent) => { if (!root.current?.contains(event.target as Node)) setOpen(false) }
    document.addEventListener('mousedown', outside)
    return () => document.removeEventListener('mousedown', outside)
  }, [open])
  const select = (operator:BulkConstraint['operator']) => { onChange(operator); setOpen(false) }
  return <div className="operator-picker" ref={root}>
    <button type="button" aria-haspopup="listbox" aria-expanded={open} onClick={() => setOpen(value => !value)}
      onKeyDown={event => {
        if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); setOpen(false) }
        if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
          event.preventDefault()
          const delta = event.key === 'ArrowDown' ? 1 : -1
          select(operators[(operators.indexOf(value) + delta + operators.length) % operators.length])
        }
      }}>
      <span className="operator-symbol">{OPERATOR_LABELS[value]}</span><span className="operator-chevron">⌄</span>
    </button>
    {open && <div className="operator-menu" role="listbox" aria-label="比较操作符">
      {operators.map(operator => <button type="button" role="option" aria-selected={operator === value} key={operator} onClick={() => select(operator)}>{OPERATOR_LABELS[operator]}</button>)}
    </div>}
  </div>
}

export default function BulkDataWizard({ open, connection, connections, databases, database, tables, activeJob, onConnectionChange, onDatabaseChange, onClose, onJobChange, onNotify }:BulkDataWizardProps) {
  const dialogRef = useRef<HTMLElement>(null)
  const notifyRef = useRef(onNotify)
  const closeRef = useRef(onClose)
  notifyRef.current = onNotify
  closeRef.current = onClose
  const prefixes = useMemo(() => [...new Set(tables.map(dayTablePrefix).filter((item):item is string => Boolean(item)))].sort(), [tables])
  const [step, setStep] = useState(1)
  const [prefix, setPrefix] = useState('')
  const [sourceMeasurement, setSourceMeasurement] = useState('')
  const [retentionPolicy, setRetentionPolicy] = useState('')
  const [policies, setPolicies] = useState<{ name:string; durationMs:number; isDefault:boolean }[]>([])
  const [schema, setSchema] = useState<MeasurementSchema | null>(null)
  const [drift, setDrift] = useState('')
  const [dateInput, setDateInput] = useState(formatDate(new Date()))
  const [dates, setDates] = useState<string[]>([])
  const [startTime, setStartTime] = useState('00:00:00')
  const [endTime, setEndTime] = useState('23:59:00')
  const [intervalSeconds, setIntervalSeconds] = useState(60)
  const [tags, setTags] = useState<BulkTagDraft[]>([])
  const [fields, setFields] = useState<BulkFieldDraft[]>([])
  const [constraints, setConstraints] = useState<BulkConstraint[]>([])
  const [preview, setPreview] = useState<BulkPreview | null>(null)
  const [previewing, setPreviewing] = useState(false)
  const [showProtocol, setShowProtocol] = useState(false)
  const [confirmPrefix, setConfirmPrefix] = useState('')
  const [ackCreate, setAckCreate] = useState(false)
  const [ackOverwrite, setAckOverwrite] = useState(false)
  const [ackFuture, setAckFuture] = useState(false)
  const [stopConfirm, setStopConfirm] = useState(false)
  const [jobBusy, setJobBusy] = useState(false)
  const [resumeDraft, setResumeDraft] = useState<BulkDraft | null>(null)
  const [historyItems, setHistoryItems] = useState(loadBulkHistory)
  const offeredDraft = useRef(false)
  const jobDraft = useRef<BulkDraft | null>(null)
  const recordedJobs = useRef(new Set<string>())
  const previewAbort = useRef<AbortController | null>(null)
  const tagRequests = useRef(new Map<string, number>())

  const siblings = useMemo(() => tables.filter(table => dayTablePrefix(table) === prefix).toSorted((a,b) => (tableTimestamp(b) ?? 0) - (tableTimestamp(a) ?? 0)), [prefix, tables])
  const draft = useMemo<BulkDraft>(() => ({
    prefix, database, sourceMeasurement, retentionPolicy, dates, startTime, endTime, intervalSeconds, tags, fields, constraints,
  }), [constraints, database, dates, endTime, fields, intervalSeconds, prefix, retentionPolicy, sourceMeasurement, startTime, tags])
  const estimate = useMemo(() => { try { return estimateBulkDraft(draft) } catch { return null } }, [draft])
  const generatedRows = useMemo(() => dates.map(date => {
    const table = `${prefix}_${beijingDate(date)}`
    return { date, table, exists:tables.includes(table) }
  }), [dates, prefix, tables])
  const hasFuture = dates.some(date => date > formatDate(new Date()))
  const hasExisting = preview ? preview.requiredAcknowledgements.includes('acknowledgeOverwrite') : generatedRows.some(row => row.exists)
  const hasPending = preview ? preview.requiredAcknowledgements.includes('acknowledgeCreate') : generatedRows.some(row => !row.exists)
  const truncatedTag = tags.find(tag => tag.generator.kind === 'existing' && tag.generator.truncated)
  const validGenerators = tags.every(tag => {
    const values = tagValues(tag)
    return values.length > 0 && values.length <= 1000 && values.every(value => value.trim().length > 0)
  }) && fields.every(validField)

  useEffect(() => { if (!prefixes.includes(prefix)) setPrefix(prefixes[0] ?? '') }, [prefix, prefixes])
  useEffect(() => { if (!siblings.includes(sourceMeasurement)) setSourceMeasurement(siblings[0] ?? '') }, [siblings, sourceMeasurement])
  useEffect(() => {
    if (!open || !database) return
    let live = true
    void bridge.retentionPolicies(database).then(next => {
      if (!live) return
      setPolicies(next)
      setRetentionPolicy(current => next.some(item => item.name === current) ? current : (next.find(item => item.isDefault)?.name ?? next[0]?.name ?? ''))
    }).catch(error => live && notifyRef.current(error instanceof Error ? error.message : '无法读取 RP'))
    return () => { live = false }
  }, [database, open])
  useEffect(() => {
    if (!open || !sourceMeasurement) return
    let live = true
    tagRequests.current.clear()
    setSchema(null)
    void Promise.all([bridge.schema(database, sourceMeasurement), ...siblings.filter(table => table !== sourceMeasurement).map(table => bridge.schema(database, table))]).then(([reference, ...others]) => {
      if (!live) return
      setSchema(reference)
      setTags(current => reference.tags.map(name => current.find(item => item.name === name) ?? { name, generator:{ kind:'list', values:['value-01'] } }))
      setFields(current => reference.fields.map(field => current.find(item => item.name === field.name && item.type === field.type) ?? initialField(field.name, field.type)))
      setConstraints(current => current.filter(item => reference.fields.some(field => field.name === item.left)))
      const baseline = JSON.stringify(reference)
      setDrift(others.some(item => JSON.stringify(item) !== baseline) ? '检测到同前缀天表 Schema 存在差异，执行前将再次校验。' : `Schema 一致：${reference.tags.length} 个 Tag，${reference.fields.length} 个 Field。`)
    }).catch(error => live && notifyRef.current(error instanceof Error ? error.message : '无法读取 Schema'))
    return () => { live = false }
  }, [database, open, siblings, sourceMeasurement])
  useEffect(() => {
    if (!open) return
    const dialog = dialogRef.current
    const previousFocus = document.activeElement as HTMLElement | null
    dialog?.focus()
    const handleKey = (event:KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        closeRef.current()
        return
      }
      if (event.key !== 'Tab' || !dialog) return
      const focusable = [...dialog.querySelectorAll<HTMLElement>('button:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])')]
      if (!focusable.length) return
      const first = focusable[0], last = focusable[focusable.length - 1]
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus() }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus() }
    }
    document.addEventListener('keydown', handleKey)
    return () => { document.removeEventListener('keydown', handleKey); previousFocus?.focus() }
  }, [open])
  useEffect(() => {
    previewAbort.current?.abort()
    setPreviewing(false)
    setPreview(null)
    setConfirmPrefix('')
    setAckCreate(false)
    setAckOverwrite(false)
    setAckFuture(false)
  }, [draft])
  useEffect(() => {
    if (!preview) return
    const remaining = preview.expiresAt - Date.now()
    if (remaining <= 0) { setPreview(null); return }
    const timer = window.setTimeout(() => {
      setPreview(null)
      notifyRef.current('预览已过期，请重新生成')
    }, remaining)
    return () => window.clearTimeout(timer)
  }, [preview])
  useEffect(() => {
    if (!open || offeredDraft.current || activeJob) return
    offeredDraft.current = true
    setResumeDraft(loadBulkDraft())
  }, [activeJob, open])
  useEffect(() => {
    if (!open || activeJob || !prefix || !sourceMeasurement) return
    const timer = window.setTimeout(() => saveBulkDraft(draft), 500)
    return () => window.clearTimeout(timer)
  }, [activeJob, draft, open, prefix, sourceMeasurement])
  useEffect(() => {
    if (!activeJob || !isUnfinishedBulkJob(activeJob.status)) return
    if (!jobDraft.current) {
      const stored = loadActiveBulkRun()
      if (stored?.jobId === activeJob.id) jobDraft.current = stored.draft
    }
    let live = true
    let timer:number | undefined
    let failures = 0
    const poll = async () => {
      try {
        const next = await bridge.bulkJob(activeJob.id)
        if (!live) return
        failures = 0
        onJobChange(next)
        const delay = nextPollDelay(next.status)
        if (delay !== null) timer = window.setTimeout(() => void poll(), delay)
      } catch (error) {
        if (live) {
          failures += 1
          if (failures === 1) notifyRef.current(error instanceof Error ? error.message : '无法读取批量任务进度')
          timer = window.setTimeout(() => void poll(), Math.min(5000, 1000 * 2 ** (failures - 1)))
        }
      }
    }
    timer = window.setTimeout(() => void poll(), nextPollDelay(activeJob.status) ?? 1000)
    return () => { live = false; if (timer !== undefined) window.clearTimeout(timer) }
  }, [activeJob, onJobChange])
  useEffect(() => {
    if (!activeJob || isUnfinishedBulkJob(activeJob.status) || recordedJobs.current.has(activeJob.id)) return
    const stored = loadActiveBulkRun()
    const completedDraft = jobDraft.current ?? (stored?.jobId === activeJob.id ? stored.draft : null)
    if (!completedDraft) return
    recordedJobs.current.add(activeJob.id)
    const item = {
      ...completedDraft,
      jobId:activeJob.id,
      status:activeJob.status,
      completedAt:activeJob.updatedAt,
      progress:{
        completedPoints:activeJob.completedPoints, totalPoints:activeJob.totalPoints,
        completedBatches:activeJob.completedBatches, totalBatches:activeJob.totalBatches,
      },
    }
    appendBulkHistory(item)
    setHistoryItems(loadBulkHistory())
    clearActiveBulkRun(activeJob.id)
    jobDraft.current = null
    clearBulkDraft()
    notifyRef.current(activeJob.status === 'succeeded' ? '批量造数已完成' : activeJob.status === 'cancelled' ? '批量造数已停止' : '批量造数任务失败')
  }, [activeJob])

  if (!open) return null

  const addDate = () => {
    if (!dateInput || dates.includes(dateInput)) return
    if (dates.length >= 30) return onNotify('最多选择 30 天')
    setDates(current => [...current, dateInput].toSorted())
  }
  const recentDates = (count:number) => {
    const now = Date.now()
    setDates(Array.from({ length:Math.min(count, 30) }, (_, index) => formatDate(new Date(now - index * 86400000))).toSorted())
  }
  const updateTag = (name:string, generator:TagGenerator) => setTags(current => current.map(item => item.name === name ? { ...item, generator } : item))
  const changeTagMode = async (tag:BulkTagDraft, kind:typeof TAG_MODES[number]) => {
    const requestId = (tagRequests.current.get(tag.name) ?? 0) + 1
    tagRequests.current.set(tag.name, requestId)
    if (kind === 'list') return updateTag(tag.name, { kind, values:['value-01'] })
    if (kind === 'sequence') return updateTag(tag.name, { kind, prefix:`${tag.name}-`, start:1, count:2, padding:2 })
    updateTag(tag.name, { kind, values:[], truncated:false })
    try {
      const result = await bridge.tagValues(database, sourceMeasurement, tag.name)
      if (tagRequests.current.get(tag.name) !== requestId) return
      setTags(current => current.map(item => item.name === tag.name && item.generator.kind === 'existing' ? { ...item, generator:{ kind, values:result.values, truncated:result.truncated } } : item))
    } catch (error) {
      onNotify(error instanceof Error ? error.message : `无法读取 Tag ${tag.name} 的已有值`)
    }
  }
  const updateField = (name:string, generator:FieldGenerator) => setFields(current => current.map(item => item.name === name ? { ...item, generator } : item))
  const changeFieldMode = (field:BulkFieldDraft, kind:FieldGenerator['kind']) => {
    const generator:FieldGenerator = kind === 'fixed'
      ? { kind, value:field.type.toLowerCase() === 'boolean' ? false : field.type.toLowerCase() === 'string' ? '' : 0 }
      : kind === 'random-number' ? { kind, min:0, max:100 }
        : kind === 'increment' ? { kind, start:0, step:1 }
          : kind === 'string-list' ? { kind, values:['value-01', 'value-02'] }
            : { kind:'random-boolean', truePercent:50 }
    updateField(field.name, generator)
  }
  const addConstraint = () => {
    const left = fields[0]
    if (!left) return
    setConstraints(current => [...current, { left:left.name, operator:'=', right:{ kind:'fixed', value:numericType(left.type) ? 0 : left.type.toLowerCase() === 'boolean' ? false : '' } }])
  }
  const updateConstraint = (index:number, next:BulkConstraint) => setConstraints(current => current.map((item, itemIndex) => itemIndex === index ? next : item))
  const previewPlan = async () => {
    if (!schema) return onNotify('Schema 尚未读取完成')
    if (truncatedTag) return onNotify(`Tag ${truncatedTag.name} 的已有值超过 1000 个，请改用候选列表或序列缩小范围`)
    const controller = new AbortController()
    try {
      setPreviewing(true)
      previewAbort.current?.abort()
      previewAbort.current = controller
      const result = await bridge.previewBulkJob({
        ...draft,
        schema,
        tags:tags.map(tag => ({ name:tag.name, values:tagValues(tag) })),
        fields,
      }, controller.signal)
      if (previewAbort.current !== controller) return
      setPreview(result)
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') return
      const bridgeError = error instanceof BridgeError ? error : null
      setStep(stepForBulkError(bridgeError?.code))
      onNotify(error instanceof Error ? error.message : '无法生成预览')
    } finally {
      if (previewAbort.current === controller) setPreviewing(false)
    }
  }
  const applyDraft = (next:BulkDraft) => {
    setPrefix(next.prefix)
    setSourceMeasurement(next.sourceMeasurement)
    setRetentionPolicy(next.retentionPolicy)
    setDates(next.dates)
    setStartTime(next.startTime)
    setEndTime(next.endTime)
    setIntervalSeconds(next.intervalSeconds)
    setTags(next.tags)
    setFields(next.fields)
    setConstraints(next.constraints)
    setStep(1)
    setResumeDraft(null)
  }
  const executePlan = async () => {
    if (!preview) return
    try {
      setJobBusy(true)
      const job = await bridge.createBulkJob({
        previewId:preview.previewId,
        database,
        acknowledgeCreate:hasPending ? ackCreate : undefined,
        acknowledgeOverwrite:hasExisting ? ackOverwrite : undefined,
      })
      jobDraft.current = draft
      saveActiveBulkRun(job.id, draft)
      onJobChange(job)
      clearBulkDraft()
    } catch (error) {
      const bridgeError = error instanceof BridgeError ? error : null
      if (bridgeError?.code === 'STALE_BULK_PREVIEW' || bridgeError?.code === 'BULK_PREVIEW_REQUIRED') setPreview(null)
      onNotify(error instanceof Error ? error.message : '无法启动批量任务')
    } finally {
      setJobBusy(false)
    }
  }
  const resumeJob = async () => {
    if (!activeJob) return
    try { setJobBusy(true); onJobChange(await bridge.resumeBulkJob(activeJob.id)) }
    catch (error) { onNotify(error instanceof Error ? error.message : '无法继续批量任务') }
    finally { setJobBusy(false) }
  }
  const cancelJob = async () => {
    if (!activeJob) return
    try { setJobBusy(true); setStopConfirm(false); onJobChange(await bridge.cancelBulkJob(activeJob.id)) }
    catch (error) { onNotify(error instanceof Error ? error.message : '无法停止批量任务') }
    finally { setJobBusy(false) }
  }
  const targetReady = Boolean(prefix && sourceMeasurement && retentionPolicy && schema)
  const timeReady = Boolean(estimate && dates.length && estimate.pointCount <= 100000 && estimate.maxNewSeries <= 10000)
  const generatorsReady = Boolean(tags.length === (schema?.tags.length ?? -1) && fields.length === (schema?.fields.length ?? -1) && !truncatedTag && validGenerators)
  const canContinue = step === 1 ? targetReady : step === 2 ? timeReady : step === 3 ? generatorsReady : targetReady && timeReady && generatorsReady
  const jobPercent = activeJob?.totalPoints ? Math.min(100, Math.round(activeJob.completedPoints / activeJob.totalPoints * 100)) : 0

  return <div className="bulk-modal" role="presentation"><section ref={dialogRef} tabIndex={-1} className="bulk-wizard" role="dialog" aria-modal="true" aria-label="批量造数">
    <aside className="bulk-steps"><div><h2>批量造数</h2><p>先配置计划，再确认写入</p>{STEPS.map((label, index) => <button key={label} type="button" aria-current={step === index + 1 ? 'step' : undefined} className={step === index + 1 ? 'active' : step > index + 1 ? 'done' : ''} onClick={() => setStep(index + 1)}><span>{step > index + 1 ? '✓' : index + 1}</span>{label}</button>)}</div><div className="bulk-history"><b>最近任务</b>{activeJob && <button type="button" className="bulk-active-summary" onClick={() => setStep(4)}><span>{activeJob.status}</span><strong>{jobPercent}%</strong></button>}{historyItems.slice(0, 20).map(item => <button type="button" key={item.jobId} title="复制为新任务" onClick={() => applyDraft(copyHistoryToDraft(item))}><span>{item.prefix} · {item.dates.length} 天</span><small>{item.status} · 复制</small></button>)}{!activeJob && historyItems.length === 0 && <p>暂无历史任务</p>}</div></aside>
    <div className="bulk-content"><header className="bulk-header"><div><h1>{STEPS[step - 1]}</h1><p>{['选择目标、来源和保留策略', '选择日期与写入时间', '配置 Tag、Field 和约束', '检查样本并确认写入'][step - 1]}</p></div><button className="bulk-close" type="button" onClick={onClose} aria-label={activeJob && isUnfinishedBulkJob(activeJob.status) ? '最小化批量造数' : '关闭批量造数'} title={activeJob && isUnfinishedBulkJob(activeJob.status) ? '任务会继续在 Bridge 中运行' : '关闭'}>{activeJob && isUnfinishedBulkJob(activeJob.status) ? '—' : '×'}</button></header>
      <div className="bulk-body">
        {resumeDraft && <div className="bulk-resume-draft"><div><b>发现未完成的造数草稿</b><p>{resumeDraft.prefix} · {resumeDraft.dates.length} 天 · 保存的草稿会重新校验，不会沿用旧预览。</p></div><button type="button" onClick={() => { clearBulkDraft(); setResumeDraft(null) }}>丢弃</button><button type="button" className="primary" disabled={resumeDraft.database !== database} title={resumeDraft.database !== database ? `请先切换到 Database ${resumeDraft.database}` : ''} onClick={() => applyDraft(resumeDraft)}>继续配置</button></div>}
        {step === 1 && <div className="bulk-section"><div className="bulk-context"><label>连接<select value={connection.id} onChange={event => { const next = connections.find(item => item.id === event.target.value); if (next) onConnectionChange(next) }}>{connections.map(item => { const usable = (item.environment === 'test' || item.environment === 'dev') && !item.readOnly; return <option key={item.id} value={item.id} disabled={!usable}>{item.name}{!usable ? '（生产环境不可用）' : ''}</option> })}</select></label><label>Database<select value={database} onChange={event => onDatabaseChange(event.target.value)} disabled={!databases.length}>{databases.map(item => <option key={item}>{item}</option>)}</select></label><small>仅可选择测试、开发可写连接；生产环境保持只读。切换后会重新读取目标表、RP 和 Schema。</small></div><label>目标逻辑前缀<select value={prefix} onChange={event => setPrefix(event.target.value)}>{prefixes.map(item => <option key={item}>{item}</option>)}</select></label><label>Schema 来源（默认最新天表）<select value={sourceMeasurement} onChange={event => setSourceMeasurement(event.target.value)}>{siblings.map(item => <option key={item}>{item}</option>)}</select></label><label>保留策略 RP<select value={retentionPolicy} onChange={event => setRetentionPolicy(event.target.value)}>{policies.map(item => <option key={item.name} value={item.name}>{item.name}{item.isDefault ? '（数据库默认）' : ''} · {duration(item.durationMs)}</option>)}</select></label><div className="bulk-note"><b>结构检查</b><p>{schema ? drift : '正在读取 Schema…'}</p><small>检查来源表与目标天表的 Tag、Field 是否一致。</small></div></div>}
        {step === 2 && <div className="bulk-section"><div className="bulk-date-presets"><span>快速选择</span>{[1,3,7,14,30].map(count => <button key={count} type="button" onClick={() => recentDates(count)}>{count} 天</button>)}</div><label>指定日期（最多 30 天）<span className="bulk-inline"><input type="date" value={dateInput} onChange={event => setDateInput(event.target.value)}/><button type="button" onClick={addDate}>添加</button></span></label><div className="bulk-selected-dates">{dates.length ? dates.map(date => <button type="button" key={date} onClick={() => setDates(current => current.filter(item => item !== date))}>{date} ×</button>) : <span>尚未选择</span>}</div><div className="bulk-time-grid"><label>开始时间<input type="time" step="1" value={startTime} onChange={event => setStartTime(event.target.value)}/></label><label>结束时间<input type="time" step="1" value={endTime} onChange={event => setEndTime(event.target.value)}/></label><label>采样间隔<select value={PRESET_INTERVALS.some(([value]) => value === intervalSeconds) ? String(intervalSeconds) : 'custom'} onChange={event => setIntervalSeconds(event.target.value === 'custom' ? 2 : Number(event.target.value))}>{PRESET_INTERVALS.map(([value,label]) => <option key={value} value={value}>{`每 ${label}`}</option>)}<option value="custom">自定义秒数</option></select>{!PRESET_INTERVALS.some(([value]) => value === intervalSeconds) && <input type="number" min="1" max="86400" value={intervalSeconds} onChange={event => setIntervalSeconds(Number(event.target.value))} aria-label="自定义采样间隔秒数"/>}</label></div><div className="bulk-estimates"><div><small>日期</small><b>{dates.length} / 30</b></div><div><small>预计点数</small><b>{estimate?.pointCount.toLocaleString() ?? '不可计算'}</b></div><div><small>新增时间线</small><b>{estimate?.maxNewSeries.toLocaleString() ?? '不可计算'}</b></div></div><div className="bulk-targets">{generatedRows.map(row => <div key={row.date}><span>{row.date}</span><code>{row.table}</code><b className={row.exists ? 'exists' : 'create'}>{row.exists ? '已存在' : '待创建'}</b></div>)}</div>{hasFuture && <div className="bulk-warning">包含未来日期；执行前需要额外确认。</div>}</div>}
        {step === 3 && <div className="bulk-config">
          <section className="bulk-config-card"><header><b>Tag 配置</b><span>{tags.length} 个 Tag · 决定时间线组合</span></header><div className="bulk-config-head"><span>名称</span><span>生成方式</span><span>参数</span></div>{tags.map(tag => <div className="bulk-config-row" key={tag.name}><code>{tag.name}</code><select aria-label={`${tag.name} Tag 生成方式`} value={tag.generator.kind} onChange={event => void changeTagMode(tag, event.target.value as typeof TAG_MODES[number])}>{TAG_MODES.map(mode => <option key={mode} value={mode}>{generatorLabel(mode)}</option>)}</select><div className="bulk-params">{tag.generator.kind === 'list' && <input aria-label={`${tag.name} 候选值`} value={tag.generator.values.join(', ')} onChange={event => updateTag(tag.name, { kind:'list', values:commaValues(event.target.value) })} placeholder="node-01, node-02"/>}{tag.generator.kind === 'sequence' && <><input value={tag.generator.prefix} onChange={event => updateTag(tag.name, { kind:'sequence', prefix:event.target.value, start:tag.generator.kind === 'sequence' ? tag.generator.start : 1, count:tag.generator.kind === 'sequence' ? tag.generator.count : 1, padding:tag.generator.kind === 'sequence' ? tag.generator.padding : 0 })} placeholder="前缀"/><input type="number" value={tag.generator.start} onChange={event => updateTag(tag.name, { kind:'sequence', prefix:tag.generator.kind === 'sequence' ? tag.generator.prefix : '', start:Number(event.target.value), count:tag.generator.kind === 'sequence' ? tag.generator.count : 1, padding:tag.generator.kind === 'sequence' ? tag.generator.padding : 0 })} aria-label="起始值"/><input type="number" min="1" max="1000" value={tag.generator.count} onChange={event => updateTag(tag.name, { kind:'sequence', prefix:tag.generator.kind === 'sequence' ? tag.generator.prefix : '', start:tag.generator.kind === 'sequence' ? tag.generator.start : 1, count:Number(event.target.value), padding:tag.generator.kind === 'sequence' ? tag.generator.padding : 0 })} aria-label="数量"/><input type="number" min="0" max="12" value={tag.generator.padding} onChange={event => updateTag(tag.name, { kind:'sequence', prefix:tag.generator.kind === 'sequence' ? tag.generator.prefix : '', start:tag.generator.kind === 'sequence' ? tag.generator.start : 1, count:tag.generator.kind === 'sequence' ? tag.generator.count : 1, padding:Number(event.target.value) })} aria-label="补零位数"/></>}{tag.generator.kind === 'existing' && <span className={tag.generator.truncated ? 'bulk-inline-error' : 'bulk-loaded'}>{tag.generator.truncated ? '已读取前 1000 个值，结果被截断，请缩小范围' : `已读取 ${tag.generator.values.length} 个去重值`}</span>}</div></div>)}</section>
          <section className="bulk-config-card"><header><b>Field 配置</b><span>类型来自 Schema，不允许改变</span></header><div className="bulk-config-head"><span>名称 / 类型</span><span>生成方式</span><span>参数</span></div>{fields.map(field => <div className="bulk-config-row" key={field.name}><code>{field.name} <small>{field.type}</small></code><select aria-label={`${field.name} Field 生成方式`} value={field.generator.kind} onChange={event => changeFieldMode(field, event.target.value as FieldGenerator['kind'])}>{fieldModes(field.type).map(mode => <option key={mode} value={mode}>{generatorLabel(mode)}</option>)}</select><div className="bulk-params">{field.generator.kind === 'fixed' && (field.type.toLowerCase() === 'boolean' ? <select value={String(field.generator.value)} onChange={event => updateField(field.name, { kind:'fixed', value:event.target.value === 'true' })}><option value="true">true</option><option value="false">false</option></select> : <input type={numericType(field.type) ? 'number' : 'text'} value={String(field.generator.value)} onChange={event => updateField(field.name, { kind:'fixed', value:numericType(field.type) ? Number(event.target.value) : event.target.value })} placeholder="固定值"/>)}{field.generator.kind === 'random-number' && <><input type="number" value={field.generator.min} onChange={event => updateField(field.name, { kind:'random-number', min:Number(event.target.value), max:field.generator.kind === 'random-number' ? field.generator.max : 100 })} aria-label="最小值"/><span>至</span><input type="number" value={field.generator.max} onChange={event => updateField(field.name, { kind:'random-number', min:field.generator.kind === 'random-number' ? field.generator.min : 0, max:Number(event.target.value) })} aria-label="最大值"/></>}{field.generator.kind === 'increment' && <><label>起始<input type="number" value={field.generator.start} onChange={event => updateField(field.name, { kind:'increment', start:Number(event.target.value), step:field.generator.kind === 'increment' ? field.generator.step : 1 })}/></label><label>步长<input type="number" value={field.generator.step} onChange={event => updateField(field.name, { kind:'increment', start:field.generator.kind === 'increment' ? field.generator.start : 0, step:Number(event.target.value) })}/></label></>}{field.generator.kind === 'string-list' && <input value={field.generator.values.join(', ')} onChange={event => updateField(field.name, { kind:'string-list', values:commaValues(event.target.value) })} placeholder="候选值，以逗号分隔"/>}{field.generator.kind === 'random-boolean' && <label>true 概率<input type="number" min="0" max="100" value={field.generator.truePercent} onChange={event => updateField(field.name, { kind:'random-boolean', truePercent:Number(event.target.value) })}/><span>%</span></label>}</div></div>)}</section>
          <section className="bulk-config-card bulk-constraints"><header><div><b>字段约束</b><span>全部按 AND 组合；右值可选同类型字段或固定值</span></div><button type="button" onClick={addConstraint}>＋ 添加约束</button></header>{constraints.length === 0 && <p className="bulk-empty">没有字段约束</p>}{constraints.map((constraint, index) => {
            const left = fields.find(field => field.name === constraint.left) ?? fields[0]
            if (!left) return null
            const operators = numericType(left.type) ? NUMERIC_OPERATORS : EQUALITY_OPERATORS
            const rightFields = fields.filter(field => field.type.toLowerCase() === left.type.toLowerCase() && field.name !== left.name)
            const setLeft = (name:string) => {
              const nextField = fields.find(field => field.name === name) ?? left
              updateConstraint(index, { left:name, operator:'=', right:{ kind:'fixed', value:numericType(nextField.type) ? 0 : nextField.type.toLowerCase() === 'boolean' ? false : '' } })
            }
            return <div className="constraint-row" key={`${index}-${constraint.left}`}><select value={constraint.left} onChange={event => setLeft(event.target.value)}>{fields.map(field => <option key={field.name} value={field.name}>{field.name}</option>)}</select><OperatorPicker value={operators.includes(constraint.operator as never) ? constraint.operator : '='} operators={operators} onChange={operator => updateConstraint(index, { ...constraint, operator })}/><select className="constraint-right-kind" value={constraint.right.kind} onChange={event => updateConstraint(index, event.target.value === 'field' && rightFields[0] ? { ...constraint, right:{ kind:'field', field:rightFields[0].name } } : { ...constraint, right:{ kind:'fixed', value:numericType(left.type) ? 0 : left.type.toLowerCase() === 'boolean' ? false : '' } })}><option value="fixed">固定值</option>{rightFields.length > 0 && <option value="field">另一个字段</option>}</select>{constraint.right.kind === 'field' ? <select value={constraint.right.field} onChange={event => updateConstraint(index, { ...constraint, right:{ kind:'field', field:event.target.value } })}>{rightFields.map(field => <option key={field.name} value={field.name}>{field.name}</option>)}</select> : left.type.toLowerCase() === 'boolean' ? <select value={String(constraint.right.value)} onChange={event => updateConstraint(index, { ...constraint, right:{ kind:'fixed', value:event.target.value === 'true' } })}><option value="true">true</option><option value="false">false</option></select> : <input type={numericType(left.type) ? 'number' : 'text'} value={String(constraint.right.value)} onChange={event => updateConstraint(index, { ...constraint, right:{ kind:'fixed', value:numericType(left.type) ? Number(event.target.value) : event.target.value } })} placeholder="输入固定值"/>}<button className="constraint-remove" type="button" aria-label="删除约束" onClick={() => setConstraints(current => current.filter((_, itemIndex) => itemIndex !== index))}>×</button></div>
          })}</section>
          <div className={validGenerators ? 'bulk-note' : 'bulk-warning'}><b>{validGenerators ? '当前估算' : '请完善生成参数'}</b><p>{validGenerators ? `预计生成 ${estimate?.pointCount.toLocaleString() ?? '不可计算'} 个点，最多新增 ${estimate?.maxNewSeries.toLocaleString() ?? '不可计算'} 条时间线。Bridge 会在预览时进行最终约束与上限校验。` : '候选值不能为空；数值范围、整数参数和布尔概率必须有效。'}</p></div>
        </div>}
        {step === 4 && activeJob && <div className="bulk-job-progress">
          <div className="bulk-progress-title"><div><b>{activeJob.status === 'paused' ? '任务已暂停' : isUnfinishedBulkJob(activeJob.status) ? '正在写入 GeminiDB' : '任务已结束'}</b><p>{activeJob.currentMeasurement || '正在准备目标天表'}</p></div><strong>{jobPercent}%</strong></div>
          <div className="bulk-progress-track"><span style={{ width:`${jobPercent}%` }}/></div>
          <div className="bulk-progress-metrics"><div><small>已完成点数</small><b>{activeJob.completedPoints.toLocaleString()} / {activeJob.totalPoints.toLocaleString()}</b></div><div><small>批次</small><b>{activeJob.completedBatches} / {activeJob.totalBatches}</b></div><div><small>重试</small><b>{activeJob.retryCount}</b></div><div><small>状态</small><b>{activeJob.status}</b></div></div>
          {activeJob.lastError && <div className="bulk-warning"><b>{activeJob.lastError.code}</b><p>{activeJob.lastError.message}</p></div>}
          <div className="bulk-job-actions">{activeJob.status === 'paused' && <button type="button" className="primary" disabled={jobBusy} onClick={() => void resumeJob()}>从失败批次继续</button>}{isUnfinishedBulkJob(activeJob.status) && activeJob.status !== 'cancelling' && <button type="button" className="danger" disabled={jobBusy} onClick={() => setStopConfirm(true)}>停止任务</button>}{!isUnfinishedBulkJob(activeJob.status) && <button type="button" onClick={() => onJobChange(null)}>新建任务</button>}</div>
        </div>}
        {step === 4 && !activeJob && <div className="bulk-preview">
          <div className="bulk-summary"><div><small>目标 / RP</small><b>{prefix || '未选择'} · {retentionPolicy || '未选择'}</b></div><div><small>日期 / 天表</small><b>{dates.length} 天 · {hasExisting ? '含已存在' : ''}{hasExisting && hasPending ? ' / ' : ''}{hasPending ? '含待创建' : ''}</b></div><div><small>点数</small><b>{preview?.pointCount.toLocaleString() ?? estimate?.pointCount.toLocaleString() ?? '不可计算'}</b></div><div><small>最多新增时间线</small><b>{preview?.maxNewSeries.toLocaleString() ?? estimate?.maxNewSeries.toLocaleString() ?? '不可计算'}</b></div></div>
          <section className="bulk-preview-card"><header><b>配置摘要</b></header><p><b>Tag：</b>{tags.map(tag => `${tag.name}（${generatorLabel(tag.generator.kind)}，${tagValues(tag).length} 值）`).join('；') || '无'}</p><p><b>Field：</b>{fields.map(field => `${field.name}:${field.type}（${generatorLabel(field.generator.kind)}）`).join('；') || '无'}</p><p><b>约束：</b>{constraints.map(item => `${item.left} ${OPERATOR_LABELS[item.operator]} ${item.right.kind === 'field' ? item.right.field : String(item.right.value)}`).join(' AND ') || '无'}</p></section>
          {!preview && <div className="bulk-preview-empty"><b>尚未生成权威预览</b><p>Bridge 将重新校验 RP、Schema、点数、时间线和字段约束，并生成固定种子的 20 条样本。</p><button type="button" className="primary" disabled={previewing || !canContinue} onClick={() => void previewPlan()}>{previewing ? '正在生成…' : '生成预览'}</button></div>}
          {preview && <><section className="bulk-preview-card"><header><b>样本数据（{preview.samples.length} 条）</b><button type="button" onClick={() => setShowProtocol(value => !value)}>{showProtocol ? '隐藏 Line Protocol' : '查看 Line Protocol'}</button></header><div className="bulk-sample-table"><table><thead><tr><th>#</th><th>确定性写入样本</th></tr></thead><tbody>{preview.samples.map(sample => <tr key={sample.index}><td>{sample.index + 1}</td><td><code>{sample.lineProtocol}</code></td></tr>)}</tbody></table></div>{showProtocol && <pre>{preview.samples.map(sample => sample.lineProtocol).join('\n')}</pre>}</section>{preview.warnings.length > 0 && <div className="bulk-warning"><b>预览提醒</b>{preview.warnings.map((warning, index) => <p key={`${warning.code}-${index}`}>{warning.message}</p>)}</div>}<section className="bulk-confirmations"><b>执行前确认</b><label>输入逻辑前缀 <code>{prefix}</code><input value={confirmPrefix} onChange={event => setConfirmPrefix(event.target.value)} placeholder={prefix}/></label>{hasPending && <label><input type="checkbox" checked={ackCreate} onChange={event => setAckCreate(event.target.checked)}/>确认首次写入会自动创建“待创建”的天表</label>}{hasExisting && <label><input type="checkbox" checked={ackOverwrite} onChange={event => setAckOverwrite(event.target.checked)}/>确认相同时间戳与 Tag 组合可能覆盖已有 Field</label>}{hasFuture && <label><input type="checkbox" checked={ackFuture} onChange={event => setAckFuture(event.target.checked)}/>确认向未来日期写入测试数据</label>}<p>执行按钮将在下一阶段接入任务进度；当前确认状态不会绕过 Bridge 校验。</p></section></>}
        </div>}
      </div>
      <footer className="bulk-footer"><span>{activeJob && step === 4 ? `任务 ${activeJob.id.slice(0, 8)}` : `步骤 ${step} / 4`}</span><div>{step > 1 && !activeJob && <button type="button" onClick={() => setStep(value => value - 1)}>上一步</button>}{step < 4 && <button type="button" className="primary" disabled={!canContinue} onClick={() => setStep(value => value + 1)}>下一步</button>}{step === 4 && preview && !activeJob && <button type="button" className="primary" disabled={jobBusy || confirmPrefix !== prefix || (hasPending && !ackCreate) || (hasExisting && !ackOverwrite) || (hasFuture && !ackFuture)} onClick={() => void executePlan()}>{jobBusy ? '正在启动…' : '确认并执行'}</button>}</div></footer>
    </div>
    {stopConfirm && <div className="bulk-confirm-modal" role="alertdialog" aria-modal="true" aria-label="停止批量造数任务"><div><h3>停止当前任务？</h3><p>已写入的数据不会回滚；停止请求会取消尚未完成的批次。</p><footer><button type="button" onClick={() => setStopConfirm(false)}>继续运行</button><button type="button" className="danger" disabled={jobBusy} onClick={() => void cancelJob()}>确认停止</button></footer></div></div>}
  </section></div>
}
