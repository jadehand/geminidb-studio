import { useEffect, useMemo, useRef, useState } from 'react'
import { bridge, BridgeError } from './api'
import { estimateBulkDraft, stepForBulkError } from './bulk-data'
import { dayTablePrefix, tableTimestamp } from './day-tables'
import type {
  BulkConstraint, BulkDraft, BulkFieldDraft, BulkJobStatus, BulkPreview, BulkTagDraft,
  Connection, FieldGenerator, MeasurementSchema, TagGenerator,
} from './types'

export type BulkDataWizardProps = {
  open: boolean
  connection: Connection
  database: string
  tables: string[]
  activeJob: BulkJobStatus | null
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
    return Array.from({ length:Math.max(0, count) }, (_, index) => `${prefix}${String(start + index).padStart(padding, '0')}`)
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
        if (event.key === 'Escape') setOpen(false)
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

export default function BulkDataWizard({ open, connection, database, tables, activeJob, onClose, onJobChange, onNotify }:BulkDataWizardProps) {
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
  const hasExisting = generatedRows.some(row => row.exists)
  const hasPending = generatedRows.some(row => !row.exists)
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
    setPreview(null)
    setConfirmPrefix('')
    setAckCreate(false)
    setAckOverwrite(false)
    setAckFuture(false)
  }, [draft])

  if (!open) return null

  const addDate = () => {
    if (!dateInput || dates.includes(dateInput)) return
    if (dates.length >= 7) return onNotify('最多选择 7 天')
    setDates(current => [...current, dateInput].toSorted())
  }
  const recentDates = (count:number) => {
    const now = Date.now()
    setDates(Array.from({ length:count }, (_, index) => formatDate(new Date(now - index * 86400000))).toSorted())
  }
  const updateTag = (name:string, generator:TagGenerator) => setTags(current => current.map(item => item.name === name ? { ...item, generator } : item))
  const changeTagMode = async (tag:BulkTagDraft, kind:typeof TAG_MODES[number]) => {
    if (kind === 'list') return updateTag(tag.name, { kind, values:['value-01'] })
    if (kind === 'sequence') return updateTag(tag.name, { kind, prefix:`${tag.name}-`, start:1, count:2, padding:2 })
    updateTag(tag.name, { kind, values:[], truncated:false })
    try {
      const result = await bridge.tagValues(database, sourceMeasurement, tag.name)
      updateTag(tag.name, { kind, values:result.values, truncated:result.truncated })
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
    try {
      setPreviewing(true)
      const result = await bridge.previewBulkJob({
        ...draft,
        schema,
        tags:tags.map(tag => ({ name:tag.name, values:tagValues(tag) })),
        fields,
      })
      setPreview(result)
    } catch (error) {
      const bridgeError = error instanceof BridgeError ? error : null
      setStep(stepForBulkError(bridgeError?.code))
      onNotify(error instanceof Error ? error.message : '无法生成预览')
    } finally {
      setPreviewing(false)
    }
  }
  const canContinue = step === 1 ? Boolean(prefix && sourceMeasurement && retentionPolicy && schema)
    : step === 2 ? Boolean(estimate && dates.length && estimate.pointCount <= 100000 && estimate.maxNewSeries <= 10000)
      : step === 3 ? Boolean(tags.length === (schema?.tags.length ?? -1) && fields.length === (schema?.fields.length ?? -1) && !truncatedTag && validGenerators)
        : true

  return <div className="bulk-modal" role="presentation"><section ref={dialogRef} tabIndex={-1} className="bulk-wizard" role="dialog" aria-modal="true" aria-label="批量造数">
    <aside className="bulk-steps"><div><h2>批量造数</h2><p>先配置计划，再确认写入</p>{STEPS.map((label, index) => <button key={label} type="button" aria-current={step === index + 1 ? 'step' : undefined} className={step === index + 1 ? 'active' : step > index + 1 ? 'done' : ''} onClick={() => setStep(index + 1)}><span>{step > index + 1 ? '✓' : index + 1}</span>{label}</button>)}</div><div className="bulk-recent"><b>最近任务</b><p>{activeJob ? `${activeJob.status} · ${activeJob.completedPoints}/${activeJob.totalPoints}` : '暂无进行中的任务'}</p></div></aside>
    <div className="bulk-content"><header className="bulk-header"><div><h1>{STEPS[step - 1]}</h1><p>{['选择目标天表前缀、Schema 来源和保留策略', '统一使用北京日期，最多生成 7 天的数据', '配置每个 Tag、Field 的生成方式，并添加 AND 约束', '检查样本与风险；修改配置后必须重新预览'][step - 1]}</p></div><button className="bulk-close" type="button" onClick={onClose} aria-label="关闭批量造数">×</button></header>
      <div className="bulk-body">
        {step === 1 && <div className="bulk-section"><div className="bulk-context"><span>连接</span><b>{connection.name}</b><span>Database</span><b>{database}</b></div><label>目标逻辑前缀<select value={prefix} onChange={event => setPrefix(event.target.value)}>{prefixes.map(item => <option key={item}>{item}</option>)}</select></label><label>Schema 来源（默认最新天表）<select value={sourceMeasurement} onChange={event => setSourceMeasurement(event.target.value)}>{siblings.map(item => <option key={item}>{item}</option>)}</select></label><label>保留策略 RP<select value={retentionPolicy} onChange={event => setRetentionPolicy(event.target.value)}>{policies.map(item => <option key={item.name} value={item.name}>{item.name}{item.isDefault ? '（默认）' : ''} · {duration(item.durationMs)}</option>)}</select></label><div className="bulk-note"><b>Schema 校验</b><p>{schema ? drift : '正在读取 Schema…'}</p></div></div>}
        {step === 2 && <div className="bulk-section"><div className="bulk-date-presets"><span>最近 N 天</span>{[1,2,3,4,5,6,7].map(count => <button key={count} type="button" onClick={() => recentDates(count)}>{count} 天</button>)}</div><label>指定日期（可多选，最多 7 天）<span className="bulk-inline"><input type="date" value={dateInput} onChange={event => setDateInput(event.target.value)}/><button type="button" onClick={addDate}>添加日期</button></span></label><div className="bulk-selected-dates">{dates.length ? dates.map(date => <button type="button" key={date} onClick={() => setDates(current => current.filter(item => item !== date))}>{date} ×</button>) : <span>尚未选择日期</span>}</div><div className="bulk-time-grid"><label>每日开始时间<input type="time" step="1" value={startTime} onChange={event => setStartTime(event.target.value)}/></label><label>每日结束时间<input type="time" step="1" value={endTime} onChange={event => setEndTime(event.target.value)}/></label><label>采样间隔<select value={PRESET_INTERVALS.some(([value]) => value === intervalSeconds) ? String(intervalSeconds) : 'custom'} onChange={event => setIntervalSeconds(event.target.value === 'custom' ? 2 : Number(event.target.value))}>{PRESET_INTERVALS.map(([value,label]) => <option key={value} value={value}>{`每 ${label}`}</option>)}<option value="custom">自定义秒数</option></select>{!PRESET_INTERVALS.some(([value]) => value === intervalSeconds) && <input type="number" min="1" max="86400" value={intervalSeconds} onChange={event => setIntervalSeconds(Number(event.target.value))} aria-label="自定义采样间隔秒数"/>}</label></div><div className="bulk-estimates"><div><small>日期</small><b>{dates.length}</b></div><div><small>预计点数</small><b>{estimate?.pointCount.toLocaleString() ?? '不可计算'}</b></div><div><small>最多新增时间线</small><b>{estimate?.maxNewSeries.toLocaleString() ?? '不可计算'}</b></div></div><div className="bulk-targets">{generatedRows.map(row => <div key={row.date}><span>{row.date}</span><code>{row.table}</code><b className={row.exists ? 'exists' : 'create'}>{row.exists ? '已存在' : '待创建'}</b></div>)}</div>{hasFuture && <div className="bulk-warning">包含未来日期；执行前需要额外确认。</div>}</div>}
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
        {step === 4 && <div className="bulk-preview">
          <div className="bulk-summary"><div><small>目标 / RP</small><b>{prefix || '未选择'} · {retentionPolicy || '未选择'}</b></div><div><small>日期 / 天表</small><b>{dates.length} 天 · {hasExisting ? '含已存在' : ''}{hasExisting && hasPending ? ' / ' : ''}{hasPending ? '含待创建' : ''}</b></div><div><small>点数</small><b>{preview?.pointCount.toLocaleString() ?? estimate?.pointCount.toLocaleString() ?? '不可计算'}</b></div><div><small>最多新增时间线</small><b>{preview?.maxNewSeries.toLocaleString() ?? estimate?.maxNewSeries.toLocaleString() ?? '不可计算'}</b></div></div>
          <section className="bulk-preview-card"><header><b>配置摘要</b></header><p><b>Tag：</b>{tags.map(tag => `${tag.name}（${generatorLabel(tag.generator.kind)}，${tagValues(tag).length} 值）`).join('；') || '无'}</p><p><b>Field：</b>{fields.map(field => `${field.name}:${field.type}（${generatorLabel(field.generator.kind)}）`).join('；') || '无'}</p><p><b>约束：</b>{constraints.map(item => `${item.left} ${OPERATOR_LABELS[item.operator]} ${item.right.kind === 'field' ? item.right.field : String(item.right.value)}`).join(' AND ') || '无'}</p></section>
          {!preview && <div className="bulk-preview-empty"><b>尚未生成权威预览</b><p>Bridge 将重新校验 RP、Schema、点数、时间线和字段约束，并生成固定种子的 20 条样本。</p><button type="button" className="primary" disabled={previewing || !canContinue} onClick={() => void previewPlan()}>{previewing ? '正在生成…' : '生成预览'}</button></div>}
          {preview && <><section className="bulk-preview-card"><header><b>样本数据（{preview.samples.length} 条）</b><button type="button" onClick={() => setShowProtocol(value => !value)}>{showProtocol ? '隐藏 Line Protocol' : '查看 Line Protocol'}</button></header><div className="bulk-sample-table"><table><thead><tr><th>#</th><th>确定性写入样本</th></tr></thead><tbody>{preview.samples.map(sample => <tr key={sample.index}><td>{sample.index + 1}</td><td><code>{sample.lineProtocol}</code></td></tr>)}</tbody></table></div>{showProtocol && <pre>{preview.samples.map(sample => sample.lineProtocol).join('\n')}</pre>}</section>{preview.warnings.length > 0 && <div className="bulk-warning"><b>预览提醒</b>{preview.warnings.map((warning, index) => <p key={`${warning.code}-${index}`}>{warning.message}</p>)}</div>}<section className="bulk-confirmations"><b>执行前确认</b><label>输入逻辑前缀 <code>{prefix}</code><input value={confirmPrefix} onChange={event => setConfirmPrefix(event.target.value)} placeholder={prefix}/></label>{hasPending && <label><input type="checkbox" checked={ackCreate} onChange={event => setAckCreate(event.target.checked)}/>确认首次写入会自动创建“待创建”的天表</label>}{hasExisting && <label><input type="checkbox" checked={ackOverwrite} onChange={event => setAckOverwrite(event.target.checked)}/>确认相同时间戳与 Tag 组合可能覆盖已有 Field</label>}{hasFuture && <label><input type="checkbox" checked={ackFuture} onChange={event => setAckFuture(event.target.checked)}/>确认向未来日期写入测试数据</label>}<p>执行按钮将在下一阶段接入任务进度；当前确认状态不会绕过 Bridge 校验。</p></section></>}
        </div>}
      </div>
      <footer className="bulk-footer"><span>步骤 {step} / 4</span><div>{step > 1 && <button type="button" onClick={() => setStep(value => value - 1)}>上一步</button>}{step < 4 && <button type="button" className="primary" disabled={!canContinue} onClick={() => setStep(value => value + 1)}>下一步</button>}{step === 4 && preview && <button type="button" className="primary" disabled={confirmPrefix !== prefix || (hasPending && !ackCreate) || (hasExisting && !ackOverwrite) || (hasFuture && !ackFuture)} onClick={() => onJobChange(activeJob)}>执行写入（下一阶段）</button>}</div></footer>
    </div>
  </section></div>
}
