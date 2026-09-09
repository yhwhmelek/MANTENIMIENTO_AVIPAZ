import { useEffect, useState } from 'react'
import { X } from 'lucide-react'

export default function MachineSpareParts({ apiUrl, token, machine, element = null, isAdmin, onClose }) {
  const [items, setItems] = useState([])
  const [elements, setElements] = useState([])
  const [parts, setParts] = useState([])
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')
  const [form, setForm] = useState(null)
  const [search, setSearch] = useState('')
  const path = `/maquinas/${machine.machine_id}/repuestos`

  async function request(route, options = {}) {
    const response = await fetch(`${apiUrl}${route}`, { ...options, headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' } })
    const data = await response.json().catch(() => null)
    if (!response.ok) throw new Error(typeof data?.detail === 'string' ? data.detail : 'No se pudo completar la operación. Revisa los datos e intenta nuevamente.')
    return data
  }

  useEffect(() => {
    const controller = new AbortController()
    Promise.all([path, '/elementos-maquinas', '/repuestos'].map(route => request(route, { signal: controller.signal })))
      .then(([relations, allElements, catalog]) => {
        setItems(relations)
        setElements(allElements.filter(item => item.machine_id === machine.machine_id))
        setParts(catalog)
      })
      .catch(err => { if (err.name !== 'AbortError') setError(err.message) })
      .finally(() => { if (!controller.signal.aborted) setLoading(false) })
    return () => controller.abort()
  }, [apiUrl, token, machine.machine_id])

  function openForm(item = null) {
    setError(''); setMessage(''); setSearch('')
    setForm(item || { element_id: element?.element_id ?? '', spare_part_id: '', position: '', quantity_required: '1', is_critical: false, notes: '' })
  }
  function change(name, value) { setForm(current => ({ ...current, [name]: value })) }

  async function save(event) {
    event.preventDefault()
    if (busy || !isAdmin) return
    setBusy(true); setError(''); setMessage('')
    try {
      const id = form.machine_spare_part_id
      const result = await request(`${path}${id ? `/${id}` : ''}`, {
        method: id ? 'PUT' : 'POST',
        body: JSON.stringify({
          element_id: form.element_id === '' || form.element_id == null ? null : Number(form.element_id),
          spare_part_id: Number(form.spare_part_id), position: form.position?.trim() || null,
          quantity_required: String(form.quantity_required), is_critical: Boolean(form.is_critical), notes: form.notes?.trim() || null,
        }),
      })
      setItems(current => id ? current.map(item => item.machine_spare_part_id === id ? result : item) : [...current, result])
      setForm(null); setMessage('Asignación guardada correctamente.')
    } catch (err) { setError(err.message) } finally { setBusy(false) }
  }

  async function remove(item) {
    if (busy || !isAdmin || !window.confirm(`¿Quitar ${item.internal_code} de esta máquina? La asignación quedará inactiva.`)) return
    setBusy(true); setError(''); setMessage('')
    try {
      await request(`${path}/${item.machine_spare_part_id}`, { method: 'DELETE' })
      setItems(current => current.filter(row => row.machine_spare_part_id !== item.machine_spare_part_id))
      setMessage('Asignación desactivada correctamente.')
    } catch (err) { setError(err.message) } finally { setBusy(false) }
  }

  const visible = element ? items.filter(item => item.element_id === element.element_id) : items
  const groups = new Map()
  for (const item of visible) {
    const key = item.element_id ?? 'general'
    if (!groups.has(key)) groups.set(key, { title: item.element_id == null ? 'Generales de la máquina' : `${item.element_code || ''} · ${item.element_name}`, rows: [] })
    groups.get(key).rows.push(item)
  }
  const matches = parts.filter(part => (part.active || part.spare_part_id === Number(form?.spare_part_id)) &&
    (part.spare_part_id === Number(form?.spare_part_id) || `${part.internal_code} ${part.description}`.toLocaleLowerCase().includes(search.toLocaleLowerCase())))

  return <div className="modal-backdrop"><div className="motor-modal" role="dialog" aria-modal="true" aria-labelledby="machine-parts-title">
    <div className="modal-header"><div><h2 id="machine-parts-title">Repuestos · {machine.asset_code}</h2><p>{machine.name}{element ? ` / ${element.name}` : ''}</p></div><button aria-label="Cerrar repuestos" disabled={busy} onClick={onClose}><X /></button></div>
    <p className="field-help">Estas asignaciones indican qué repuestos utiliza el equipo. Registra el uso real en la pestaña Consumos y las adquisiciones en la pestaña Compras.</p>
    {loading ? <p role="status">Cargando repuestos...</p> : <>
      {!form && isAdmin && <button className="primary-action" onClick={() => openForm()} disabled={busy}>Asignar repuesto</button>}
      {form ? <form onSubmit={save}>
        <h3>{form.machine_spare_part_id ? 'Editar asignación' : 'Asignar repuesto'}</h3>
        <fieldset disabled={busy} className="spare-assignment-fields"><div className="motor-form-grid">
          <label className="full-field">Asignar a<select value={form.element_id ?? ''} onChange={event => change('element_id', event.target.value)} disabled={Boolean(element)}><option value="">General de la máquina</option>{elements.map(item => <option key={item.element_id} value={item.element_id}>{item.element_code} · {item.name}</option>)}</select></label>
          <label className="full-field">Buscar repuesto<input type="search" value={search} onChange={event => setSearch(event.target.value)} placeholder="Código o descripción" /></label>
          <label className="full-field">Repuesto *<select required value={form.spare_part_id} onChange={event => change('spare_part_id', event.target.value)}><option value="">Selecciona un repuesto</option>{matches.map(part => <option key={part.spare_part_id} value={part.spare_part_id}>{part.internal_code} · {part.description}{!part.active ? ' (inactivo; selecciona otro)' : ''}</option>)}</select>{!matches.length && <span>No hay repuestos que coincidan.</span>}</label>
          <label>Posición<input maxLength={150} value={form.position ?? ''} onChange={event => change('position', event.target.value)} placeholder="Rodamiento lado DE" /></label>
          <label>Cantidad requerida *<input required type="number" min="0.01" max="99999999.99" step="0.01" value={form.quantity_required} onChange={event => change('quantity_required', event.target.value)} /></label>
          <label className="checkbox-field"><input type="checkbox" checked={Boolean(form.is_critical)} onChange={event => change('is_critical', event.target.checked)} /> Repuesto crítico</label>
          <label className="full-field">Notas<textarea rows={3} maxLength={500} value={form.notes ?? ''} onChange={event => change('notes', event.target.value)} /></label>
        </div></fieldset>
        <p className="field-help">La cantidad indica lo que necesita la máquina. Esta asignación no modifica las existencias.</p>
        <div className="modal-actions"><button type="button" className="secondary-action" disabled={busy} onClick={() => { setForm(null); setError('') }}>Cancelar</button><button className="primary-action" disabled={busy}>{busy ? 'Guardando...' : 'Guardar asignación'}</button></div>
      </form> : <>
        {[...groups.entries()].map(([key, group]) => <section key={key}><h3>{group.title}</h3><div className="users-card table-scroll"><table><thead><tr><th>Repuesto</th><th>Posición</th><th>Cantidad</th><th>Crítico</th><th>Notas</th>{isAdmin && <th>Acciones</th>}</tr></thead><tbody>{group.rows.map(item => <tr key={item.machine_spare_part_id}><td><strong>{item.internal_code}</strong><br />{item.description}</td><td>{item.position || '—'}</td><td>{item.quantity_required} {item.unit_of_measure}</td><td>{item.is_critical ? 'Sí' : 'No'}</td><td>{item.notes || '—'}</td>{isAdmin && <td><button className="secondary-action" disabled={busy} onClick={() => openForm(item)}>Editar</button> <button className="secondary-action" disabled={busy} onClick={() => remove(item)}>Quitar</button></td>}</tr>)}</tbody></table></div></section>)}
        {!visible.length && !error && <p className="empty-state">No hay repuestos asignados{element ? ' a este elemento' : ' a esta máquina'}.</p>}
      </>}
    </>}
    {error && <p className="admin-message" role="alert">{error}</p>}
    {message && <p className="admin-message" role="status">{message}</p>}
  </div></div>
}
