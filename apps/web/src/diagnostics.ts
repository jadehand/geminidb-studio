import type { MeasurementSchema } from './types'

export type DiagnosticIssue = { level: 'error' | 'warning' | 'info'; message: string }

export function inspectInfluxQL(sql: string, schema: MeasurementSchema): DiagnosticIssue[] {
  const issues: DiagnosticIssue[] = []
  if (/`/.test(sql)) issues.push({ level:'error', message:'检测到 MySQL 反引号；InfluxQL 的 Measurement 请使用双引号或不加引号。' })
  if (/\btimestamp\b/i.test(sql)) issues.push({ level:'error', message:'InfluxQL 时间字段应使用 time，而不是 timestamp。' })
  if (/\binterval\s+\d+/i.test(sql)) issues.push({ level:'error', message:'InfluxQL 时间范围写作 now() - 1h，不使用 INTERVAL。' })
  if (/^\s*select\b/i.test(sql) && !/\bwhere\b[\s\S]*\btime\b/i.test(sql)) issues.push({ level:'warning', message:'查询没有明确的 time 范围，可能扫描大量数据。' })
  if (/^\s*select\b/i.test(sql) && !/\blimit\s+\d+/i.test(sql)) issues.push({ level:'warning', message:'查询没有 LIMIT，建议先限制返回行数。' })
  if (/^\s*select\s+\*/i.test(sql)) issues.push({ level:'info', message:'当前使用 SELECT *；字段很多时建议只查询需要的 Field。' })
  const names = new Set([...schema.fields.map(field=>field.name), ...schema.tags, 'time'])
  for (const quoted of sql.matchAll(/"([A-Za-z_][\w-]*)"/g)) {
    const name=quoted[1]
    if (/\b(from|into)\s+$/i.test(sql.slice(0,quoted.index))) continue
    if (!names.has(name)) issues.push({ level:'warning', message:`Schema 中没有找到字段或 Tag：${name}` })
  }
  if (/\b(drop|delete|alter|write|into)\b/i.test(sql)) issues.push({ level:'error', message:'检测到可能修改数据的高风险命令，禁止自动执行。' })
  return [...new Map(issues.map(issue=>[issue.message,issue])).values()]
}

export function localFix(sql: string) {
  return sql.replaceAll('`','"').replace(/\btimestamp\b/gi,'time').replace(/now\(\)\s*-\s*interval\s+(\d+)\s+hour/gi,'now() - $1h').replace(/;\s*$/,'')
}

export function lineDiff(before: string, after: string) {
  const left=before.split('\n'),right=after.split('\n'),lines:string[]=[]
  const max=Math.max(left.length,right.length)
  for(let i=0;i<max;i++){if(left[i]===right[i])lines.push(`  ${left[i]??''}`);else{if(left[i]!==undefined)lines.push(`- ${left[i]}`);if(right[i]!==undefined)lines.push(`+ ${right[i]}`)}}
  return lines.join('\n')
}
