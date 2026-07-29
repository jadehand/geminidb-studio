import { useState } from 'react'
import type { MeasurementFieldValue, MeasurementSchema } from './types'
import type { MeasurementDraft } from './measurement-editing'
import { parseFieldInput } from './measurement-editing'

type Props = {
  value: MeasurementFieldValue | null
  field: MeasurementSchema['fields'][number]
  editable: boolean
  draft?: MeasurementDraft
  onChange: (value: MeasurementFieldValue) => void
}

function inputValue(value: MeasurementFieldValue | null) {
  return value === null ? '' : String(value)
}

export default function EditableFieldCell({ value, field, editable, draft, onChange }: Props) {
  const displayed = draft?.next ?? value
  const [editing, setEditing] = useState(false)
  const [input, setInput] = useState(() => inputValue(displayed))
  const [error, setError] = useState('')

  function beginEditing() {
    if (!editable) return
    setInput(inputValue(displayed))
    setError('')
    setEditing(true)
  }

  function cancelEditing() {
    setError('')
    setEditing(false)
  }

  function acceptEditing() {
    const parsed = parseFieldInput(field.type, input)
    if (!parsed.ok) {
      setError(parsed.error)
      return
    }
    onChange(parsed.value)
    setError('')
    setEditing(false)
  }

  return <td className={`editable-field-cell${draft ? ' is-dirty' : ''}${value === null && !draft ? ' is-missing' : ''}`} onDoubleClick={beginEditing}>
    {editing ? <div className="editable-field-editor">
      {field.type === 'boolean'
        ? <select autoFocus value={input} aria-label={`${field.name} 值`} onChange={event => setInput(event.target.value)} onKeyDown={event => {
          if (event.key === 'Enter') acceptEditing()
          if (event.key === 'Escape') cancelEditing()
        }} onBlur={cancelEditing}><option value="true">true</option><option value="false">false</option></select>
        : <input autoFocus value={input} aria-label={`${field.name} 值`} inputMode={field.type === 'integer' || field.type === 'float' ? 'decimal' : undefined} onChange={event => setInput(event.target.value)} onKeyDown={event => {
          if (event.key === 'Enter') acceptEditing()
          if (event.key === 'Escape') cancelEditing()
        }} onBlur={cancelEditing}/>
      }
      {error && <span className="editable-field-error" role="alert">{error}</span>}
    </div> : <span className="editable-field-value">{displayed === null ? '' : String(displayed)}</span>}
  </td>
}
