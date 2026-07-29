const WRITE_SCRIPT = /^(?:insert(?:\s+into\b)?|write)\s+/i

export type CommandBatchSummary = { total: number; succeeded: number; failed: number; skipped: number }

export function isWriteScript(sql: string): boolean {
  return WRITE_SCRIPT.test(sql.trim())
}

export function formatCommandSummary(summary: CommandBatchSummary): string {
  return `成功 ${summary.succeeded} 条 · 失败 ${summary.failed} 条 · 未执行 ${summary.skipped} 条`
}
