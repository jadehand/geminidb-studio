export type InfluxQLClause = 'SELECT' | 'FROM' | 'WHERE' | 'GROUP BY' | 'ORDER BY' | 'LIMIT' | 'SLIMIT' | 'OFFSET' | ''

export type InfluxQLCompletionContext = {
  clause: InfluxQLClause
  prefix: string
  measurement: string
  insideIdentifier: boolean
}

function currentStatement(value: string) {
  return value.split(';').at(-1) || ''
}

export function measurementFromQuery(value: string) {
  const statement = currentStatement(value)
  const matches = [...statement.matchAll(/\bFROM\s+(?:"((?:[^"]|"")*)"|([A-Za-z_][\w.-]*))/gi)]
  const match = matches.at(-1)
  return (match?.[1] || match?.[2] || '').replaceAll('""', '"')
}

export function completionContext(value: string, offset = value.length): InfluxQLCompletionContext {
  const beforeCursor = currentStatement(value.slice(0, offset))
  const clauses = [...beforeCursor.matchAll(/\b(GROUP\s+BY|ORDER\s+BY|SELECT|FROM|WHERE|LIMIT|SLIMIT|OFFSET)\b/gi)]
  const clause = (clauses.at(-1)?.[1] || '').toUpperCase().replace(/\s+/g, ' ') as InfluxQLClause
  const identifierMatch = beforeCursor.match(/"?([A-Za-z_][\w.-]*)$/)
  const quoteCount = (beforeCursor.match(/"/g) || []).length
  return {
    clause,
    prefix: identifierMatch?.[1] || '',
    measurement: measurementFromQuery(beforeCursor),
    insideIdentifier: quoteCount % 2 === 1,
  }
}

export function shouldAutoSuggest(value: string, insertedText: string) {
  if (!insertedText || /\r|\n/.test(insertedText)) return false
  const context = completionContext(value)
  if (context.insideIdentifier) return insertedText === '"' || /[\w.-]$/.test(insertedText)
  if (/\b(?:SELECT|FROM|WHERE|GROUP\s+BY|ORDER\s+BY|LIMIT|SLIMIT|OFFSET)\s+$/i.test(currentStatement(value))) return true
  return /[A-Za-z_]$/.test(insertedText)
}

