import assert from 'node:assert/strict'
import test from 'node:test'
import {
  acceptFieldInteraction,
  applyEditablePermission,
  beginFieldInteraction,
  emptyFieldInteraction,
  fieldEditingEnabled,
  inputFieldInteraction,
  cancelFieldInteraction,
} from './editable-field-interaction.ts'
import { beginSubmission, emptySubmissionState, isCurrentSubmission, resetSubmissionForRequest, submissionCanBegin } from './measurement-submission.ts'

test('field interaction begins only while editing is enabled and closes an open editor when submission begins', () => {
  const opened = beginFieldInteraction(emptyFieldInteraction(), true, 7)
  assert.deepEqual(opened, { editing: true, input: '7', error: '' })
  assert.deepEqual(applyEditablePermission(opened, false), { editing: false, input: '7', error: '' })
  assert.equal(fieldEditingEnabled(true, true), false)
  assert.deepEqual(beginFieldInteraction(emptyFieldInteraction(), fieldEditingEnabled(true, true), 7), emptyFieldInteraction())
})

test('field interaction accepts Enter input and cancels Escape or blur without changing a draft', () => {
  const editing = inputFieldInteraction(beginFieldInteraction(emptyFieldInteraction(), true, null), '42')
  assert.deepEqual(acceptFieldInteraction(editing, 'integer'), {
    state: { editing: false, input: '42', error: '' },
    value: 42,
  })

  const changed = inputFieldInteraction(beginFieldInteraction(emptyFieldInteraction(), true, 'before'), 'after')
  assert.deepEqual(cancelFieldInteraction(changed), { editing: false, input: 'after', error: '' })
})

test('invalid input retains the editor without producing a draft, and missing booleans start blank', () => {
  const invalid = acceptFieldInteraction(inputFieldInteraction(beginFieldInteraction(emptyFieldInteraction(), true, 1), '1.5'), 'integer')
  assert.equal(invalid.value, undefined)
  assert.equal(invalid.state.editing, true)
  assert.match(invalid.state.error, /integer/i)

  assert.deepEqual(beginFieldInteraction(emptyFieldInteraction(), true, null), { editing: true, input: '', error: '' })
})

test('a request reset invalidates A so its completion cannot replace a new B submission', () => {
  let state = emptySubmissionState()
  const first = beginSubmission(state, 'request-A')
  state = first.state
  assert.equal(isCurrentSubmission(state, first.submission), true)
  assert.equal(isCurrentSubmission(state, first.submission, 'request-B'), false)
  assert.equal(submissionCanBegin(state), false)

  const controllerA = new AbortController()
  controllerA.abort()
  assert.equal(controllerA.signal.aborted, true)
  state = resetSubmissionForRequest(state)
  assert.equal(isCurrentSubmission(state, first.submission), false)
  assert.equal(submissionCanBegin(state), true)
  const second = beginSubmission(state, 'request-B')
  const controllerB = new AbortController()
  assert.equal(controllerB.signal.aborted, false)
  assert.equal(isCurrentSubmission(second.state, first.submission), false)
  assert.equal(isCurrentSubmission(second.state, second.submission), true)
})
