import assert from 'node:assert/strict'
import test from 'node:test'
import { applyUpdateResult, parseFieldInput, setDraftValue, updatesFromDraft } from './measurement-editing.ts'

const schema = {
  tags: ['host', 'region'],
  fields: [
    { name: 'count', type: 'integer' },
    { name: 'load', type: 'float' },
    { name: 'enabled', type: 'boolean' },
    { name: 'note', type: 'string' },
    { name: 'added', type: 'string' },
  ],
}

const point = {
  id: 'cpu\u00001784995200123456789\u0000node-1',
  measurement: 'cpu_1784995200',
  timestampNs: '1784995200123456789',
  time: '1784995200123456789',
  tags: { host: 'node-1', region: 'cn-north' },
  fields: { count: 0, load: 1.5, enabled: false, note: '', added: null },
}

test('parses schema field types without treating blank as null', () => {
  assert.deepEqual(parseFieldInput('integer', '42'), { ok: true, value: 42 })
  assert.deepEqual(parseFieldInput('float', '2.5'), { ok: true, value: 2.5 })
  assert.deepEqual(parseFieldInput('boolean', 'true'), { ok: true, value: true })
  assert.deepEqual(parseFieldInput('string', ''), { ok: true, value: '' })
  assert.equal(parseFieldInput('integer', '').ok, false)
  assert.equal(parseFieldInput('float', ' ').ok, false)
  assert.equal(parseFieldInput('boolean', '').ok, false)
})

test('rejects unsafe integers, non-finite floats, and implicit boolean coercion', () => {
  assert.equal(parseFieldInput('integer', '9007199254740992').ok, false)
  assert.equal(parseFieldInput('float', 'Infinity').ok, false)
  assert.equal(parseFieldInput('boolean', 'TRUE').ok, false)
  assert.equal(parseFieldInput('boolean', '1').ok, false)
})

test('groups changed fields for one point without mutating loaded data or schema', () => {
  const originalPoint = structuredClone(point)
  const originalSchema = structuredClone(schema)
  let draft = {}
  draft = setDraftValue(draft, point, schema.fields[0], 7)
  draft = setDraftValue(draft, point, schema.fields[2], true)

  assert.deepEqual(updatesFromDraft(draft, [point], schema), [{
    id: point.id,
    timestampNs: '1784995200123456789',
    tags: { host: 'node-1', region: 'cn-north' },
    fields: { count: 7, enabled: true },
  }])
  assert.deepEqual(point, originalPoint)
  assert.deepEqual(schema, originalSchema)
})

test('removes an existing field draft only when its exact original value is restored', () => {
  let draft = setDraftValue({}, point, schema.fields[0], 4)
  assert.equal(Object.keys(draft).length, 1)
  draft = setDraftValue(draft, point, schema.fields[0], 0)
  assert.deepEqual(draft, {})

  draft = setDraftValue({}, point, schema.fields[2], true)
  assert.equal(Object.keys(draft).length, 1)
  draft = setDraftValue(draft, point, schema.fields[2], false)
  assert.deepEqual(draft, {})

  draft = setDraftValue({}, point, schema.fields[3], 'revised')
  draft = setDraftValue(draft, point, schema.fields[3], '')
  assert.deepEqual(draft, {})
})

test('includes a non-null addition for a missing field and never uses null as a delete marker', () => {
  const addition = setDraftValue({}, point, schema.fields[4], 'created')
  assert.deepEqual(updatesFromDraft(addition, [point], schema), [{
    id: point.id,
    timestampNs: point.timestampNs,
    tags: { host: 'node-1', region: 'cn-north' },
    fields: { added: 'created' },
  }])
  assert.deepEqual(setDraftValue({}, point, schema.fields[4], null), {})
})

test('removes drafts only for succeeded point ids and retains failed or skipped point drafts', () => {
  const second = { ...point, id: 'second-point', timestampNs: '1784995200123456790' }
  let draft = setDraftValue({}, point, schema.fields[0], 3)
  draft = setDraftValue(draft, second, schema.fields[1], 2.5)

  const reconciled = applyUpdateResult(draft, {
    summary: { total: 2, succeeded: 1, failed: 1, skipped: 0 },
    succeededIds: [point.id],
    failed: { id: second.id, index: 1, message: 'point write failed' },
  })

  assert.deepEqual(Object.keys(reconciled), [`${second.id}\u0000load`])
  assert.equal(Object.keys(draft).length, 2)
})

test('fails closed when a draft field, point identity, schema, or loaded value is stale', () => {
  const changed = setDraftValue({}, point, schema.fields[0], 9)
  const unknownField = { ...schema, fields: schema.fields.filter(field => field.name !== 'count') }
  const stalePoint = { ...point, fields: { ...point.fields, count: 4 } }

  assert.deepEqual(updatesFromDraft(changed, [], schema), [])
  assert.deepEqual(updatesFromDraft(changed, [point], unknownField), [])
  assert.deepEqual(updatesFromDraft(changed, [stalePoint], schema), [])
})
