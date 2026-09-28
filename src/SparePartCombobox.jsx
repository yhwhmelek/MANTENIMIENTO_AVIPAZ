import { useId, useState } from 'react'
import { normalizeName } from './nameSearch'

const label = part => `${part.internal_code} · ${part.description}${part.active ? '' : ' (inactivo)'}`

export default function SparePartCombobox({ parts, value, onChange }) {
  const id = useId()
  const [query, setQuery] = useState(null)
  const [open, setOpen] = useState(false)
  const [highlighted, setHighlighted] = useState(0)
  const selected = parts.find(part => part.spare_part_id === Number(value))
  const matches = parts.filter(part => (part.active || part === selected) &&
    normalizeName(`${part.internal_code} ${part.description}`).includes(normalizeName(query || '')))

  function choose(part) {
    onChange(String(part.spare_part_id))
    setQuery(null)
    setOpen(false)
  }

  return <div className="full-field spare-part-combobox" onBlur={event => {
    if (!event.currentTarget.contains(event.relatedTarget)) setOpen(false)
  }}>
    <label htmlFor={id}>Repuesto *</label>
    <input id={id} required role="combobox" autoComplete="off" aria-autocomplete="list"
      aria-expanded={open} aria-controls={`${id}-options`}
      aria-activedescendant={open && matches[highlighted] ? `${id}-option-${highlighted}` : undefined}
      placeholder="Escribe el código o la descripción"
      value={query ?? (selected ? label(selected) : '')}
      onFocus={() => { setOpen(true); setHighlighted(0) }}
      onChange={event => { setQuery(event.target.value); onChange(''); setHighlighted(0); setOpen(true) }}
      onKeyDown={event => {
        if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
          event.preventDefault()
          setOpen(true)
          setHighlighted(index => !open ? 0 : Math.max(0, Math.min(matches.length - 1, index + (event.key === 'ArrowDown' ? 1 : -1))))
        } else if (event.key === 'Enter' && open) {
          event.preventDefault()
          if (matches[highlighted]) choose(matches[highlighted])
        } else if (event.key === 'Escape' && open) {
          event.preventDefault()
          event.stopPropagation()
          setOpen(false)
        }
      }} />
    {open && <>
      <ul id={`${id}-options`} role="listbox" aria-label="Repuestos disponibles" className="spare-part-options">
        {matches.map((part, index) => <li key={part.spare_part_id} id={`${id}-option-${index}`}
          role="option" aria-selected={highlighted === index}
          ref={node => { if (node && highlighted === index) node.scrollIntoView({ block: 'nearest' }) }}
          onMouseDown={event => event.preventDefault()} onClick={() => choose(part)}>
          {label(part)}
        </li>)}
      </ul>
      {!matches.length && <p role="status">No hay repuestos que coincidan.</p>}
    </>}
  </div>
}
