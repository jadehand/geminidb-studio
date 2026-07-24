function milliseconds(value: unknown) {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value !== 'string' || !/^\d{10,13}$/.test(value)) return null
  const parsed = Number(value)
  return value.length === 10 ? parsed * 1000 : parsed
}

function utc(value: number) {
  return new Date(value).toISOString().replace('T', ' ').replace('Z', ' UTC')
}

function beijing(value: number) {
  const date = new Date(value + 8 * 60 * 60 * 1000)
  return `${date.toISOString().replace('T', ' ').replace('Z', '')} UTC+8`
}

export function resultCell(column: string, value: unknown) {
  const timestamp = column.toLowerCase() === 'time' ? milliseconds(value) : null
  if (timestamp === null) {
    const text = String(value ?? '')
    return { text, title: text }
  }
  return {
    text: utc(timestamp),
    title: `UTC：${utc(timestamp)}\n北京时间：${beijing(timestamp)}\n时间戳：${timestamp} ms`,
  }
}
