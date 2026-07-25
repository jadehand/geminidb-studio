import type { MeasurementSchema } from './types'

export function filterMeasurementSchema(schema: MeasurementSchema, query: string): MeasurementSchema {
  const keyword = query.trim().toLowerCase()
  if (!keyword) return schema
  return {
    fields: schema.fields.filter(field => `${field.name} ${field.type}`.toLowerCase().includes(keyword)),
    tags: schema.tags.filter(tag => tag.toLowerCase().includes(keyword)),
  }
}

export function schemaPlainText(database: string, measurement: string, schema: MeasurementSchema): string {
  const fields = schema.fields.length
    ? schema.fields.map(field => `- ${field.name}: ${field.type}`).join('\n')
    : '- (none)'
  const tags = schema.tags.length
    ? schema.tags.map(tag => `- ${tag}`).join('\n')
    : '- (none)'
  return [
    `Database: ${database || '(未选择)'}`,
    `Measurement: ${measurement}`,
    '',
    `Fields (${schema.fields.length}):`,
    fields,
    '',
    `Tags (${schema.tags.length}):`,
    tags,
  ].join('\n')
}
