import type { MeasurementFieldType, MeasurementFieldValue } from './types'
import { parseFieldInput } from './measurement-editing.ts'

export type FieldInteractionState = {
  editing: boolean
  input: string
  error: string
}

export function emptyFieldInteraction(): FieldInteractionState {
  return { editing: false, input: '', error: '' }
}

function inputValue(value: MeasurementFieldValue | null) {
  return value === null ? '' : String(value)
}

export function fieldEditingEnabled(editable: boolean, submitting: boolean) {
  return editable && !submitting
}

export function beginFieldInteraction(state: FieldInteractionState, editable: boolean, value: MeasurementFieldValue | null): FieldInteractionState {
  return editable ? { editing: true, input: inputValue(value), error: '' } : state
}

export function inputFieldInteraction(state: FieldInteractionState, input: string): FieldInteractionState {
  return { ...state, input }
}

export function cancelFieldInteraction(state: FieldInteractionState): FieldInteractionState {
  return { ...state, editing: false, error: '' }
}

export function applyEditablePermission(state: FieldInteractionState, editable: boolean): FieldInteractionState {
  return editable ? state : cancelFieldInteraction(state)
}

export function acceptFieldInteraction(state: FieldInteractionState, type: MeasurementFieldType): { state: FieldInteractionState; value?: MeasurementFieldValue } {
  const parsed = parseFieldInput(type, state.input)
  if (!parsed.ok) return { state: { ...state, editing: true, error: parsed.error } }
  return { state: cancelFieldInteraction(state), value: parsed.value }
}
