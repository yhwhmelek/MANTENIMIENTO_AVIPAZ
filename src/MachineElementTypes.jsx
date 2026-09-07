import { useEffect, useState } from 'react'
import { Pencil, Plus, Trash2, X } from 'lucide-react'

export default function MachineElementTypes({ apiUrl, token, isAdmin }) {
  const [items, setItems] = useState([])
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [editing, setEditing] = useState(null)
  const [showForm, setShowForm] = useState(false)
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')
  const endpoint = `${apiUrl}/tipos-elementos`

  useEffect(() => {
    const controller = new AbortController()
    setLoading(true)
    setMessage('')
    fetch(endpoint, { headers: { Authorization: `Bearer ${token}` }, signal: controller.signal })
      .then(async (response) => {
        const data = await response.json()
        if (!response.ok) throw new Error(typeof data.detail === 'string' ? data.detail : 'No se pudieron cargar los tipos de elementos.')
        setItems(data)
      })
      .catch((error) => { if (error.name !== 'AbortError') setMessage(error.message) })
      .finally(() => { if (!controller.signal.aborted) setLoading(false) })
    return () => controller.abort()
  }, [endpoint, token])

  function openForm(item = null) { setEditing(item); setError(''); setShowForm(true) }

  async function save(event) {
    event.preventDefault()
    if (busy || !isAdmin) return
    const form = new FormData(event.currentTarget)
    const payload = { name: form.get('name').trim(), description: form.get('description').trim() || null, active: form.get('active') === 'on' }
    if (!payload.name) { setError('El nombre es obligatorio.'); return }
    setBusy(true)
    setError('')
    try {
      const response = await fetch(`${endpoint}${editing ? `/${editing.element_type_id}` : ''}`, {
        method: editing ? 'PUT' : 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify(payload),
      })
      const data = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(typeof data.detail === 'string' ? data.detail : 'Revisa los datos ingresados.')
      setItems((items) => (editing ? items.map((item) => item.element_type_id === data.element_type_id ? data : item) : [...items, data]).sort((a, b) => a.name.localeCompare(b.name)))
      setShowForm(false)
      setMessage(`Tipo de elemento ${data.name} guardado correctamente.`)
    } catch (error) { setError(error.message) } finally { setBusy(false) }
  }

  async function remove(item) {
    if (busy || !isAdmin || !window.confirm(`¿Eliminar definitivamente el tipo de elemento ${item.name}?`)) return
    setBusy(true)
    try {
      const response = await fetch(`${endpoint}/${item.element_type_id}`, { method: 'DELETE', headers: { Authorization: `Bearer ${token}` } })
      if (!response.ok) {
        const data = await response.json().catch(() => ({}))
        throw new Error(typeof data.detail === 'string' ? data.detail : 'No se pudo eliminar el tipo de elemento.')
      }
      setItems((items) => items.filter((entry) => entry.element_type_id !== item.element_type_id))
      setMessage(`Tipo de elemento ${item.name} eliminado correctamente.`)
    } catch (error) { setMessage(error.message) } finally { setBusy(false) }
  }

  return <>
    <div className="page-heading"><div><p className="eyebrow">ACTIVOS</p><h1>Tipos de elementos</h1><p>Catálogo de tipos de elementos de máquinas.</p></div>{isAdmin && <button className="primary-action" disabled={busy} onClick={() => openForm()}><Plus size={18} /> Nuevo tipo</button>}</div>
    <div className="users-card table-scroll"><table><thead><tr>{isAdmin && <th>Acciones</th>}<th>Nombre</th><th>Descripción</th><th>Estado</th></tr></thead><tbody>{items.map((item) => <tr key={item.element_type_id}>
      {isAdmin && <td className="row-actions"><button aria-label={`Editar ${item.name}`} title="Editar" disabled={busy} onClick={() => openForm(item)}><Pencil size={16} /></button><button className="danger" aria-label={`Eliminar ${item.name}`} title="Eliminar" disabled={busy} onClick={() => remove(item)}><Trash2 size={16} /></button></td>}
      <td><strong>{item.name}</strong></td><td>{item.description || '—'}</td><td><span className={`status-badge ${item.active ? 'active' : 'inactive'}`}>{item.active ? 'Activo' : 'Inactivo'}</span></td>
    </tr>)}</tbody></table>{!loading && !items.length && !message && <p className="empty-state">No hay tipos de elementos registrados.</p>}</div>
    <p className="admin-message" role="status">{loading ? 'Cargando tipos de elementos...' : message}</p>
    {showForm && isAdmin && <div className="modal-backdrop"><div className="motor-modal category-modal" role="dialog" aria-modal="true" aria-labelledby="element-type-title">
      <div className="modal-header"><h2 id="element-type-title">{editing ? 'Editar tipo de elemento' : 'Nuevo tipo de elemento'}</h2><button aria-label="Cerrar" disabled={busy} onClick={() => setShowForm(false)}><X /></button></div>
      <form onSubmit={save}><div className="motor-form-grid category-form-grid">
        <label>Nombre *<input name="name" defaultValue={editing?.name || ''} maxLength={100} required autoFocus /></label>
        <label>Descripción<textarea name="description" defaultValue={editing?.description || ''} maxLength={300} rows={3} /></label>
        <label className="checkbox-field">Activo<input name="active" type="checkbox" defaultChecked={editing?.active ?? true} /></label>
      </div>{error && <p className="admin-message" role="alert">{error}</p>}<div className="modal-actions"><button type="button" className="secondary-action" disabled={busy} onClick={() => setShowForm(false)}>Cancelar</button><button className="primary-action" disabled={busy}>{busy ? 'Guardando...' : 'Guardar tipo'}</button></div></form>
    </div></div>}
  </>
}
