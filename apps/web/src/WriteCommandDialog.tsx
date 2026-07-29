export default function WriteCommandDialog({
  database,
  statementCount,
  executing,
  onCancel,
  onConfirm,
}: {
  database: string
  statementCount: number
  executing: boolean
  onCancel: () => void
  onConfirm: () => void
}) {
  return <div className="modal" role="presentation" onMouseDown={event => {
    if (!executing && event.target === event.currentTarget) onCancel()
  }}>
    <section className="dialog write-command-dialog" role="dialog" aria-modal="true" aria-labelledby="write-command-title">
      <h2 id="write-command-title">确认写入</h2>
      <dl>
        <dt>Database</dt><dd>{database}</dd>
        <dt>服务端验证命令数</dt><dd>{statementCount}</dd>
      </dl>
      <div className="dialog-actions">
        <button autoFocus disabled={executing} onClick={onCancel}>取消</button>
        <button className="primary" disabled={executing} onClick={onConfirm}>{executing ? '正在执行…' : '执行写入'}</button>
      </div>
    </section>
  </div>
}
