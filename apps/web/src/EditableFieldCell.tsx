import { useEffect, useState } from 'react'
import type { MeasurementFieldValue, MeasurementSchema } from './types'
import type { MeasurementDraft } from './measurement-editing'
import { acceptFieldInteraction, applyEditablePermission, beginFieldInteraction, cancelFieldInteraction, emptyFieldInteraction, inputFieldInteraction } from './editable-field-interaction'

type Props = {
  value: MeasurementFieldValue | null
  field: MeasurementSchema['fields'][number]
  editable: boolean
  draft?: MeasurementDraft
  onChange: (value: MeasurementFieldValue) => void
}

export default function EditableFieldCell({ value, field, editable, draft, onChange }: Props) {
  const displayed = draft?.next ?? value
  const [interaction, setInteraction] = useState(emptyFieldInteraction)
  const editing = editable && interaction.editing

  useEffect(() => {
    setInteraction(current => applyEditablePermission(current, editable))
  }, [editable])

  function beginEditing() {
    setInteraction(current => beginFieldInteraction(current, editable, displayed))
  }

  function cancelEditing() {
    setInteraction(cancelFieldInteraction)
  }

  function acceptEditing() {
    const accepted = acceptFieldInteraction(interaction, field.type)
    setInteraction(accepted.state)
    if (accepted.value !== undefined) onChange(accepted.value)
  }

  return <td className={`editable-field-cell${draft ? ' is-dirty' : ''}${value === null && !draft ? ' is-missing' : ''}`} tabIndex={editable ? 0 : undefined} onDoubleClick={beginEditing} onKeyDown={event => {
    if (editing || (event.key !== 'Enter' && event.key !== ' ')) return
    event.preventDefault()
    beginEditing()
  }}>
    {editing ? <div className="editable-field-editor">
      {field.type === 'boolean'
        ? <select autoFocus value={interaction.input} aria-label={`${field.name} 值`} onChange={event => setInteraction(current => inputFieldInteraction(current, event.target.value))} onKeyDown={event => {
          if (event.key === 'Enter') acceptEditing()
          if (event.key === 'Escape') cancelEditing()
        }} onBlur={cancelEditing}><option value="" disabled>选择…</option><option value="true">true</option><option value="false">false</option></select>
        : <input autoFocus value={interaction.input} aria-label={`${field.name} 值`} inputMode={field.type === 'integer' || field.type === 'float' ? 'decimal' : undefined} onChange={event => setInteraction(current => inputFieldInteraction(current, event.target.value))} onKeyDown={event => {
          if (event.key === 'Enter') acceptEditing()
          if (event.key === 'Escape') cancelEditing()
        }} onBlur={cancelEditing}/>
      }
      {interaction.error && <span className="editable-field-error" role="alert">{interaction.error}</span>}
    </div> : <span className="editable-field-value">{displayed === null ? '' : String(displayed)}</span>}
  </td>
}
