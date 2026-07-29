import { useEffect } from 'react'
import type { Connection } from './types'

export default function DeleteConnectionDialog({
  connection,
  onCancel,
  onConfirm,
}: {
  connection: Connection
  onCancel: () => void
  onConfirm: () => void
}) {
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onCancel()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [onCancel])

  return <div className="modal" role="presentation" onMouseDown={event => {
    if (event.target === event.currentTarget) onCancel()
  }}>
    <section className="dialog delete-connection-dialog" role="alertdialog" aria-modal="true" aria-labelledby="delete-connection-title">
      <h2 id="delete-connection-title">删除连接</h2>
      <dl>
        <dt>连接名称</dt><dd>{connection.name}</dd>
        <dt>连接地址</dt><dd>{connection.endpoint}</dd>
      </dl>
      <div className="dialog-actions">
        <button autoFocus onClick={onCancel}>取消</button>
        <button className="danger solid-danger" onClick={onConfirm}>确认删除</button>
      </div>
    </section>
  </div>
}
