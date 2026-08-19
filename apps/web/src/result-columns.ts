export function pinnedResultColumn(columns: string[]): string | undefined {
  return columns.find(column => column.toLowerCase() === 'time') ?? columns[0]
}
