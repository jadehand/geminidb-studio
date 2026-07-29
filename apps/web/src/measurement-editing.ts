import type { MeasurementFieldType, MeasurementFieldValue, MeasurementSchema, MeasurementUpdateResult } from './types'
import type { MeasurementPoint } from './measurement-data'

type FieldDefinition = MeasurementSchema['fields'][number]

export type ParsedFieldInput =
  | { ok: true; value: MeasurementFieldValue }
  | { ok: false; error: string }

export type MeasurementDraft = {
  pointId: string
  fieldName: string
  type: MeasurementFieldType
  original: MeasurementFieldValue | null
  next: MeasurementFieldValue
}

export type MeasurementDraftState = Record<string, MeasurementDraft>

export type MeasurementPointUpdate = {
  id: string
  timestampNs: string
  tags: Record<string, string>
  fields: Record<string, MeasurementFieldValue>
}

const FIELD_TYPES = new Set<MeasurementFieldType>(['integer', 'float', 'string', 'boolean'])
const DECIMAL_TIMESTAMP = /^-?\d+$/
const INTEGER_INPUT = /^[+-]?\d+$/

function draftKey(pointId: string, fieldName: string) {
  return `${pointId}\u0000${fieldName}`
}

function failed(error: string): ParsedFieldInput {
  return { ok: false, error }
}

function isFieldType(value: unknown): value is MeasurementFieldType {
  return typeof value === 'string' && FIELD_TYPES.has(value as MeasurementFieldType)
}

function isFieldValue(type: MeasurementFieldType, value: unknown): value is MeasurementFieldValue {
  if (type === 'integer') return Number.isSafeInteger(value)
  if (type === 'float') return typeof value === 'number' && Number.isFinite(value)
  if (type === 'string') return typeof value === 'string'
  return typeof value === 'boolean'
}

function isPoint(point: MeasurementPoint): boolean {
  return typeof point?.id === 'string' && point.id.length > 0
    && typeof point.timestampNs === 'string' && DECIMAL_TIMESTAMP.test(point.timestampNs)
    && point.tags !== null && typeof point.tags === 'object' && !Array.isArray(point.tags)
    && point.fields !== null && typeof point.fields === 'object' && !Array.isArray(point.fields)
}

function sameValue(left: MeasurementFieldValue | null, right: MeasurementFieldValue | null) {
  return Object.is(left, right)
}

function completeTags(point: MeasurementPoint, schema: MeasurementSchema): Record<string, string> | null {
  if (!Array.isArray(schema.tags) || new Set(schema.tags).size !== schema.tags.length) return null
  const entries = Object.entries(point.tags)
  if (entries.length !== schema.tags.length || entries.some(([name, value]) => !schema.tags.includes(name) || typeof value !== 'string')) return null
  return Object.fromEntries(entries)
}

function schemaField(schema: MeasurementSchema, name: string): FieldDefinition | null {
  if (!Array.isArray(schema.fields)) return null
  const fields = schema.fields.filter(field => field?.name === name && isFieldType(field.type))
  return fields.length === 1 ? fields[0] : null
}

export function parseFieldInput(type: string, input: unknown): ParsedFieldInput {
  if (!isFieldType(type) || typeof input !== 'string') return failed('field input is invalid')
  if (type === 'string') return { ok: true, value: input }
  if (type === 'boolean') {
    if (input === 'true') return { ok: true, value: true }
    if (input === 'false') return { ok: true, value: false }
    return failed('boolean fields must be true or false')
  }
  if (input.trim() === '') return failed('numeric fields cannot be blank')
  if (type === 'integer') {
    if (!INTEGER_INPUT.test(input)) return failed('integer fields must be safe integers')
    const value = Number(input)
    return Number.isSafeInteger(value) ? { ok: true, value } : failed('integer fields must be safe integers')
  }
  const value = Number(input)
  return Number.isFinite(value) ? { ok: true, value } : failed('float fields must be finite numbers')
}

export function setDraftValue(
  state: MeasurementDraftState,
  point: MeasurementPoint,
  field: FieldDefinition,
  value: MeasurementFieldValue | null,
): MeasurementDraftState {
  if (!state || typeof state !== 'object' || Array.isArray(state) || !isPoint(point)) return state
  if (!field || typeof field.name !== 'string' || !field.name || !isFieldType(field.type) || !isFieldValue(field.type, value)) return state

  const key = draftKey(point.id, field.name)
  const existing = state[key]
  if (existing && (existing.pointId !== point.id || existing.fieldName !== field.name || existing.type !== field.type || !isFieldValue(existing.type, existing.next))) return state

  const pointValue = point.fields[field.name] ?? null
  if (pointValue !== null && !isFieldValue(field.type, pointValue)) return state
  const original = existing ? existing.original : pointValue
  if (original !== null && !isFieldValue(field.type, original)) return state

  if (sameValue(original, value)) {
    if (!existing) return state
    const { [key]: _removed, ...rest } = state
    return rest
  }
  return { ...state, [key]: { pointId: point.id, fieldName: field.name, type: field.type, original, next: value } }
}

export function updatesFromDraft(
  state: MeasurementDraftState,
  points: readonly MeasurementPoint[],
  schema: MeasurementSchema,
): MeasurementPointUpdate[] {
  if (!state || typeof state !== 'object' || Array.isArray(state) || !Array.isArray(points)) return []

  const pointsById = new Map<string, MeasurementPoint>()
  const duplicatedIds = new Set<string>()
  for (const point of points) {
    if (!isPoint(point)) continue
    if (pointsById.has(point.id)) duplicatedIds.add(point.id)
    else pointsById.set(point.id, point)
  }

  const grouped = new Map<string, MeasurementPointUpdate>()
  for (const [key, draft] of Object.entries(state)) {
    if (!draft || key !== draftKey(draft.pointId, draft.fieldName) || !isFieldType(draft.type) || !isFieldValue(draft.type, draft.next)) continue
    const point = pointsById.get(draft.pointId)
    const field = schemaField(schema, draft.fieldName)
    if (!point || duplicatedIds.has(draft.pointId) || !field || field.type !== draft.type) continue
    const current = point.fields[draft.fieldName] ?? null
    if (!isFieldValue(draft.type, current) && current !== null) continue
    if (!sameValue(draft.original, current)) continue
    const tags = completeTags(point, schema)
    if (!tags) continue
    const update = grouped.get(point.id) ?? {
      id: point.id,
      timestampNs: point.timestampNs,
      tags,
      fields: {},
    }
    update.fields[draft.fieldName] = draft.next
    grouped.set(point.id, update)
  }

  return points.flatMap(point => grouped.has(point.id) && !duplicatedIds.has(point.id) ? [grouped.get(point.id)!] : [])
}

export function applyUpdateResult(state: MeasurementDraftState, result: MeasurementUpdateResult): MeasurementDraftState {
  if (!state || typeof state !== 'object' || Array.isArray(state) || !result || !Array.isArray(result.succeededIds)) return state
  const succeeded = new Set(result.succeededIds.filter(id => typeof id === 'string' && id.length > 0))
  if (succeeded.size === 0) return state
  const next: MeasurementDraftState = {}
  let removed = false
  for (const [key, draft] of Object.entries(state)) {
    if (draft && succeeded.has(draft.pointId)) removed = true
    else next[key] = draft
  }
  return removed ? next : state
}
