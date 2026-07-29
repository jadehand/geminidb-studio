import { useEffect, useRef } from 'react'

type Props = {
  submitting?: boolean
  error?: string
  onSubmit: () => void
  onDiscard: () => void
  onCancel: () => void
}

export default function UnsavedMeasurementDialog({ submitting = false, error, onSubmit, onDiscard, onCancel }: Props) {
  const cancel = useRef<HTMLButtonElement>(null)
  useEffect(() => { cancel.current?.focus() }, [])

  return <div className="modal" onMouseDown={event => { if (event.target === event.currentTarget && !submitting) onCancel() }}>
    <div className="dialog" role="dialog" aria-modal="true" aria-labelledby="unsaved-measurement-title" onKeyDown={event => { if (event.key === 'Escape' && !submitting) onCancel() }}>
      <h2 id="unsaved-measurement-title">未保存的 Measurement 修改</h2>
      <p>继续此操作会离开或刷新当前数据。请先提交修改、放弃修改，或取消本次操作。</p>
      {error && <p role="alert">{error}</p>}
      <div className="dialog-actions"><button ref={cancel} type="button" disabled={submitting} onClick={onCancel}>取消</button><button type="button" className="danger" disabled={submitting} onClick={onDiscard}>放弃</button><button type="button" className="primary" disabled={submitting} onClick={onSubmit}>{submitting ? '正在提交…' : '提交'}</button></div>
    </div>
  </div>
}
