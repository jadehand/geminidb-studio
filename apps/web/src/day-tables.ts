export type DayRange = 'all' | 'today' | 'yesterday' | '7d'

export function tableTimestamp(name: string) {
  const match = name.match(/_(\d{10})$/)
  return match ? Number(match[1]) : null
}

function beijingDay(timestampMs: number) {
  return new Intl.DateTimeFormat('en-CA', { timeZone:'Asia/Shanghai', year:'numeric', month:'2-digit', day:'2-digit' }).format(new Date(timestampMs))
}

export function filterDayTables(tables: string[], range: DayRange, now = Date.now()) {
  if (range === 'all') return tables
  const today = beijingDay(now)
  const yesterday = beijingDay(now - 86400000)
  const cutoff = now - 7 * 86400000
  return tables.filter(table => { const timestamp=tableTimestamp(table); if (!timestamp) return false; const ms=timestamp*1000; return range === 'today' ? beijingDay(ms) === today : range === 'yesterday' ? beijingDay(ms) === yesterday : ms >= cutoff })
}

export function multiTableQuery(tables: string[]) {
  if (!tables.length) return ''
  const ordered = [...tables].sort((a,b)=>(tableTimestamp(a)||0)-(tableTimestamp(b)||0))
  const first = tableTimestamp(ordered[0]), last = tableTimestamp(ordered.at(-1)!)
  const escaped = ordered.map(name=>name.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')).join('|')
  const start = first ? new Date(first*1000).toISOString() : new Date(Date.now()-3600000).toISOString()
  const end = last ? new Date((last+86400)*1000).toISOString() : new Date().toISOString()
  return `SELECT *\nFROM /^(?:${escaped})$/\nWHERE time >= '${start}' AND time < '${end}'\nORDER BY time DESC\nLIMIT 100`
}
