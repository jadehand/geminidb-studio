import { useMemo, useState } from 'react'
import { filterMeasurementSchema, schemaPlainText } from './schema-detail'
import type { MeasurementSchema } from './types'

type Props = {
  database: string
  measurement: string
  schema: MeasurementSchema
  loading: boolean
  onRefresh: () => Promise<void>
  onClose: () => void
  onMessage: (message: string) => void
}

export default function SchemaDialog({ database, measurement, schema, loading, onRefresh, onClose, onMessage }: Props) {
  const [query, setQuery] = useState('')
  const [copied, setCopied] = useState(false)
  const filtered = useMemo(() => filterMeasurementSchema(schema, query), [schema, query])

  async function copySchema() {
    try {
      await navigator.clipboard.writeText(schemaPlainText(database, measurement, schema))
      setCopied(true)
      window.setTimeout(() => setCopied(false), 1400)
      onMessage('完整 Schema 已复制')
    } catch {
      onMessage('复制失败，请检查剪贴板权限')
    }
  }

  return <div className="modal schema-modal" onMouseDown={event => { if (event.target === event.currentTarget) onClose() }}>
    <section className="dialog schema-dialog" role="dialog" aria-modal="true" aria-labelledby="schema-dialog-title" onKeyDown={event => { if (event.key === 'Escape') onClose() }}>
      <header className="schema-dialog-head">
        <div><small>Measurement Schema</small><h2 id="schema-dialog-title">{measurement}</h2><p>Database · {database || '未选择'}</p></div>
        <button type="button" className="schema-dialog-close" onClick={onClose} aria-label="关闭">×</button>
      </header>
      <div className="schema-dialog-toolbar">
        <label><span className="sr-only">筛选 Field 或 Tag</span><input autoFocus value={query} onChange={event => setQuery(event.target.value)} placeholder="筛选 Field、类型或 Tag…"/></label>
        <button type="button" disabled={loading} onClick={() => void onRefresh()}>{loading ? '正在刷新…' : '刷新 Schema'}</button>
        <button type="button" className="primary" onClick={() => void copySchema()}>{copied ? '已复制' : '复制 Schema'}</button>
      </div>
      <div className="schema-dialog-content">
        <section className="schema-section">
          <div className="schema-section-title"><h3>Fields</h3><span>{filtered.fields.length} / {schema.fields.length}</span></div>
          {filtered.fields.length ? <div className="schema-field-list">{filtered.fields.map(field => <div key={field.name}><code>{field.name}</code><span>{field.type}</span></div>)}</div> : <p className="schema-empty-result">没有匹配的 Field</p>}
        </section>
        <section className="schema-section">
          <div className="schema-section-title"><h3>Tags</h3><span>{filtered.tags.length} / {schema.tags.length}</span></div>
          {filtered.tags.length ? <div className="schema-tag-list">{filtered.tags.map(tag => <code key={tag}>{tag}</code>)}</div> : <p className="schema-empty-result">没有匹配的 Tag</p>}
        </section>
      </div>
      <footer className="schema-dialog-foot"><span>复制内容包含 Database、Measurement、Field 类型和全部 Tag</span><button type="button" onClick={onClose}>关闭</button></footer>
    </section>
  </div>
}
