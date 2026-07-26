import { useEffect, useMemo, useState } from 'react'
import { bridge } from './api'
import { estimateBulkDraft } from './bulk-data'
import { dayTablePrefix, tableTimestamp } from './day-tables'
import type { BulkDraft, BulkJobStatus, Connection, MeasurementSchema } from './types'

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
const formatDate = (date: Date) => new Intl.DateTimeFormat('en-CA', { timeZone:'Asia/Shanghai', year:'numeric', month:'2-digit', day:'2-digit' }).format(date)
const beijingDate = (value:string) => Math.floor((Date.parse(`${value}T00:00:00+08:00`)) / 1000)
const duration = (ms:number) => ms === 0 ? '永久保留' : ms % 86400000 === 0 ? `${ms / 86400000} 天` : `${Math.round(ms / 3600000)} 小时`

export default function BulkDataWizard({ open, connection, database, tables, activeJob, onClose, onJobChange, onNotify }: BulkDataWizardProps) {
  const prefixes = useMemo(() => [...new Set(tables.map(dayTablePrefix).filter((item): item is string => Boolean(item)))].sort(), [tables])
  const [step, setStep] = useState(1)
  const [prefix, setPrefix] = useState('')
  const [sourceMeasurement, setSourceMeasurement] = useState('')
  const [retentionPolicy, setRetentionPolicy] = useState('')
  const [policies, setPolicies] = useState<{ name:string; durationMs:number; isDefault:boolean }[]>([])
  const [schema, setSchema] = useState<MeasurementSchema | null>(null)
  const [drift, setDrift] = useState<string>('')
  const [dateInput, setDateInput] = useState(formatDate(new Date()))
  const [dates, setDates] = useState<string[]>([])
  const [startTime, setStartTime] = useState('00:00:00')
  const [endTime, setEndTime] = useState('23:59:00')
  const [intervalSeconds, setIntervalSeconds] = useState(60)

  const siblings = useMemo(() => tables.filter(table => dayTablePrefix(table) === prefix).toSorted((a,b) => (tableTimestamp(b) ?? 0) - (tableTimestamp(a) ?? 0)), [prefix, tables])
  const draft = useMemo<BulkDraft>(() => ({ prefix, database, sourceMeasurement, retentionPolicy, dates, startTime, endTime, intervalSeconds, tags:[], fields:[], constraints:[] }), [database, dates, endTime, intervalSeconds, prefix, retentionPolicy, sourceMeasurement, startTime])
  const estimate = useMemo(() => { try { return estimateBulkDraft(draft) } catch { return null } }, [draft])

  useEffect(() => { if (!prefixes.includes(prefix)) setPrefix(prefixes[0] ?? '') }, [prefix, prefixes])
  useEffect(() => { if (!siblings.includes(sourceMeasurement)) setSourceMeasurement(siblings[0] ?? '') }, [siblings, sourceMeasurement])
  useEffect(() => {
    if (!open || !database) return
    let live = true
    void bridge.retentionPolicies(database).then(next => { if (!live) return; setPolicies(next); setRetentionPolicy(current => next.some(item => item.name === current) ? current : (next.find(item => item.isDefault)?.name ?? next[0]?.name ?? '')) }).catch(error => live && onNotify(error instanceof Error ? error.message : '无法读取 RP'))
    return () => { live = false }
  }, [database, onNotify, open])
  useEffect(() => {
    if (!open || !sourceMeasurement) return
    let live = true
    void Promise.all([bridge.schema(database, sourceMeasurement), ...siblings.filter(table => table !== sourceMeasurement).map(table => bridge.schema(database, table))]).then(([reference, ...others]) => {
      if (!live) return
      setSchema(reference)
      const baseline = JSON.stringify(reference)
      setDrift(others.some(item => JSON.stringify(item) !== baseline) ? '检测到同前缀天表 Schema 存在差异，执行前将再次校验。' : `Schema 一致：${reference.tags.length} 个 Tag，${reference.fields.length} 个 Field。`)
    }).catch(error => live && onNotify(error instanceof Error ? error.message : '无法读取 Schema'))
    return () => { live = false }
  }, [database, onNotify, open, siblings, sourceMeasurement])

  if (!open) return null
  const addDate = () => {
    if (!dateInput || dates.includes(dateInput)) return
    if (dates.length >= 7) return onNotify('最多选择 7 天')
    setDates(current => [...current, dateInput].toSorted())
  }
  const recentDates = (count:number) => {
    const now = new Date()
    setDates(Array.from({ length:count }, (_, index) => formatDate(new Date(now.getTime() - index * 86400000))).toSorted())
  }
  const generatedRows = dates.map(date => ({ date, table:`${prefix}_${beijingDate(date)}`, exists:tables.includes(`${prefix}_${beijingDate(date)}`) }))

  return <div className="bulk-modal" role="presentation"><section className="bulk-wizard" role="dialog" aria-modal="true" aria-label="批量造数">
    <aside className="bulk-steps"><div><h2>批量造数</h2><p>先配置计划，再确认写入</p>{STEPS.map((label, index) => <button key={label} type="button" className={step === index + 1 ? 'active' : step > index + 1 ? 'done' : ''} onClick={() => setStep(index + 1)}><span>{step > index + 1 ? '✓' : index + 1}</span>{label}</button>)}</div><div className="bulk-recent"><b>最近任务</b><p>{activeJob ? `${activeJob.status} · ${activeJob.completedPoints}/${activeJob.totalPoints}` : '暂无进行中的任务'}</p></div></aside>
    <div className="bulk-content"><header className="bulk-header"><div><h1>{STEPS[step - 1]}</h1><p>{step === 1 ? '选择目标天表前缀、Schema 来源和保留策略' : step === 2 ? '统一使用北京日期，最多生成 7 天的数据' : '后续步骤将在下一阶段开放'}</p></div><button className="bulk-close" type="button" onClick={onClose} aria-label="关闭批量造数">×</button></header>
      <div className="bulk-body">
        {step === 1 && <div className="bulk-section"><div className="bulk-context"><span>连接</span><b>{connection.name}</b><span>Database</span><b>{database}</b></div><label>目标逻辑前缀<select value={prefix} onChange={event => setPrefix(event.target.value)}>{prefixes.map(item => <option key={item}>{item}</option>)}</select></label><label>Schema 来源（最新天表）<select value={sourceMeasurement} onChange={event => setSourceMeasurement(event.target.value)}>{siblings.map(item => <option key={item}>{item}</option>)}</select></label><label>保留策略 RP<select value={retentionPolicy} onChange={event => setRetentionPolicy(event.target.value)}>{policies.map(item => <option key={item.name} value={item.name}>{item.name}{item.isDefault ? '（默认）' : ''} · {duration(item.durationMs)}</option>)}</select></label><div className="bulk-note"><b>Schema 校验</b><p>{schema ? drift : '正在读取 Schema…'}</p></div></div>}
        {step === 2 && <div className="bulk-section"><div className="bulk-date-presets"><span>最近 N 天</span>{[1,3,7].map(count => <button key={count} type="button" onClick={() => recentDates(count)}>{count} 天</button>)}</div><label>指定日期（可多选，最多 7 天）<span className="bulk-inline"><input type="date" value={dateInput} onChange={event => setDateInput(event.target.value)}/><button type="button" onClick={addDate}>添加日期</button></span></label><div className="bulk-selected-dates">{dates.length ? dates.map(date => <button type="button" key={date} onClick={() => setDates(current => current.filter(item => item !== date))}>{date} ×</button>) : <span>尚未选择日期</span>}</div><div className="bulk-time-grid"><label>每日开始时间<input type="time" step="1" value={startTime} onChange={event => setStartTime(event.target.value)}/></label><label>每日结束时间<input type="time" step="1" value={endTime} onChange={event => setEndTime(event.target.value)}/></label><label>采样间隔<select value={intervalSeconds} onChange={event => setIntervalSeconds(Number(event.target.value))}><option value={60}>每 1 分钟</option><option value={300}>每 5 分钟</option><option value={900}>每 15 分钟</option><option value={3600}>每 1 小时</option></select></label></div><div className="bulk-estimates"><div><small>日期</small><b>{dates.length}</b></div><div><small>预计点数</small><b>{estimate?.pointCount.toLocaleString() ?? '—'}</b></div><div><small>预计新序列</small><b>{estimate?.maxNewSeries.toLocaleString() ?? '—'}</b></div></div><div className="bulk-targets">{generatedRows.map(row => <div key={row.date}><span>{row.date}</span><code>{row.table}</code><b className={row.exists ? 'exists' : 'create'}>{row.exists ? '已存在' : '待创建'}</b></div>)}</div>{dates.some(date => date > formatDate(new Date())) && <div className="bulk-warning">包含未来日期；请确认 GeminiDB 的 RP 保留范围允许写入。</div>}</div>}
        {step > 2 && <div className="bulk-placeholder"><b>将在下一步配置字段与约束</b><p>本次只建立向导框架、目标和时间配置。</p></div>}
      </div>
      <footer className="bulk-footer"><span>步骤 {step} / 4</span><div>{step > 1 && <button type="button" onClick={() => setStep(value => value - 1)}>上一步</button>}<button type="button" className="primary" onClick={() => step < 4 ? setStep(value => value + 1) : onJobChange(activeJob)}>{step < 4 ? '下一步' : '生成预览'}</button></div></footer>
    </div>
  </section></div>
}
