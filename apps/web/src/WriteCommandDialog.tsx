export default function WriteCommandDialog({
  database,
  statementCount,
  onCancel,
  onConfirm,
}: {
  database: string
  statementCount: number
  onCancel: () => void
  onConfirm: () => void
}) {
  return <div className="modal" role="presentation" onMouseDown={event => {
    if (event.target === event.currentTarget) onCancel()
  }}>
    <section className="dialog write-command-dialog" role="dialog" aria-modal="true" aria-labelledby="write-command-title">
      <h2 id="write-command-title">确认写入</h2>
      <dl>
        <dt>Database</dt><dd>{database}</dd>
        <dt>服务端验证命令数</dt><dd>{statementCount}</dd>
      </dl>
      <div className="dialog-actions">
        <button autoFocus onClick={onCancel}>取消</button>
        <button className="primary" onClick={onConfirm}>执行写入</button>
      </div>
    </section>
  </div>
}
