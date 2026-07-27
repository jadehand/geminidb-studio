const PROTECTED_TOKEN = '\u0000INFLUXQL_PROTECTED_'

const KEYWORDS = [
  'SHOW TAG VALUES', 'SHOW TAG KEYS', 'SHOW FIELD KEYS', 'SHOW MEASUREMENTS', 'SHOW DATABASES',
  'GROUP BY', 'ORDER BY', 'SELECT', 'FROM', 'WHERE', 'FILL', 'LIMIT', 'SLIMIT', 'OFFSET', 'EXPLAIN', 'USE'
].sort((left, right) => right.length - left.length)

function protectLiterals(sql: string) {
  const values: string[] = []
  const protectedSql = sql.replace(/'(?:\\.|[^'\\])*'|"(?:\\.|[^"\\])*"|\/(?:\\.|[^/\\])*\/[a-z]*/gi, match => {
    const token = `${PROTECTED_TOKEN}${values.length}\u0000`
    values.push(match)
    return token
  })
  return { protectedSql, values }
}

function restoreLiterals(sql: string, values: string[]) {
  return sql.replace(new RegExp(`${PROTECTED_TOKEN}(\\d+)\\u0000`, 'g'), (_, index) => values[Number(index)] ?? '')
}

function uppercaseKeywords(sql: string) {
  let result = sql
  for (const keyword of KEYWORDS) {
    result = result.replace(new RegExp(`\\b${keyword.replaceAll(' ', '\\s+')}\\b`, 'gi'), keyword)
  }
  return result
}

export function formatInfluxQL(source: string) {
  const original = String(source ?? '')
  const trimmed = original.trim()
  if (!trimmed || /^WRITE\s+/i.test(trimmed)) return original

  const { protectedSql, values } = protectLiterals(trimmed)
  let formatted = protectedSql
    .replace(/\s+/g, ' ')
    .replace(/\s*,\s*/g, ', ')
  formatted = uppercaseKeywords(formatted)
  formatted = formatted.replace(/\s+(FROM|WHERE|GROUP BY|ORDER BY|FILL|LIMIT|SLIMIT|OFFSET)\s+/g, '\n$1 ')
  formatted = formatted.replace(/\n+/g, '\n').trim()
  return restoreLiterals(formatted, values)
}
