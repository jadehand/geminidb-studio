import type { QueryRow } from './types'

function columns(rows: QueryRow[]) {
  return Object.keys(rows[0] || {})
}

export function csvContent(rows: QueryRow[]) {
  const names = columns(rows)
  const cell = (value: unknown) => `"${String(value ?? '').replaceAll('"', '""')}"`
  return '\ufeff' + names.map(cell).join(',') + '\n'
    + rows.map(row => names.map(name => cell(row[name])).join(',')).join('\n')
}

export function excelContent(rows: QueryRow[]) {
  const names = columns(rows)
  const xml = (value: unknown) => String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
  const row = (values: unknown[]) => `<Row>${values.map(value => `<Cell><Data ss:Type="String">${xml(value)}</Data></Cell>`).join('')}</Row>`
  return '<?xml version="1.0"?>'
    + '<?mso-application progid="Excel.Sheet"?>'
    + '<Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet" '
    + 'xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet">'
    + `<Worksheet ss:Name="GeminiDB"><Table>${row(names)}`
    + rows.map(item => row(names.map(name => item[name]))).join('')
    + '</Table></Worksheet></Workbook>'
}

export function jsonContent(rows: QueryRow[]) {
  return JSON.stringify(rows, null, 2)
}
