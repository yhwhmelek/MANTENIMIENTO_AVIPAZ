import { useEffect, useState } from 'react'

const empty = { name: '', email: '', mobile: '' }

export default function BusinessContacts({ apiUrl, token }) {
  const [contacts, setContacts] = useState([])
  const [form, setForm] = useState(empty)
  const [editingId, setEditingId] = useState(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const headers = { Authorization: `Bearer ${token}` }

  useEffect(() => {
    const controller = new AbortController()
    fetch(`${apiUrl}/contactos-empresariales`, { headers, signal: controller.signal })
      .then(async response => {
        const data = await response.json()
        if (!response.ok) throw new Error(data.detail || 'No se pudieron cargar los contactos.')
        setContacts(data)
      }).catch(err => { if (err.name !== 'AbortError') setError(err.message) })
    return () => controller.abort()
  }, [apiUrl, token])

  function edit(contact) {
    setEditingId(contact.id)
    setForm({ name: contact.name, email: contact.email, mobile: contact.mobile || '' })
    setError('')
  }

  function clear() { setEditingId(null); setForm(empty) }

  async function save(event) {
    event.preventDefault()
    setBusy(true); setError('')
    try {
      const response = await fetch(`${apiUrl}/contactos-empresariales${editingId ? `/${editingId}` : ''}`, {
        method: editingId ? 'PUT' : 'POST', headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: form.name.trim(), email: form.email.trim(), mobile: form.mobile.trim() || null }),
      })
      const data = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(typeof data.detail === 'string' ? data.detail : 'Revisa los datos del contacto.')
      setContacts(items => (editingId ? items.map(item => item.id === data.id ? data : item) : [...items, data])
        .sort((a, b) => a.name.localeCompare(b.name, 'es')))
      clear()
    } catch (err) { setError(err.message) } finally { setBusy(false) }
  }

  async function remove(contact) {
    if (!window.confirm(`¿Eliminar a ${contact.name} del directorio?`)) return
    setBusy(true); setError('')
    try {
      const response = await fetch(`${apiUrl}/contactos-empresariales/${contact.id}`, { method: 'DELETE', headers })
      if (!response.ok) {
        const data = await response.json().catch(() => ({}))
        throw new Error(data.detail || 'No se pudo eliminar el contacto.')
      }
      setContacts(items => items.filter(item => item.id !== contact.id))
      if (editingId === contact.id) clear()
    } catch (err) { setError(err.message) } finally { setBusy(false) }
  }

  return <section className="business-contacts">
    <h2>Contactos empresariales</h2>
    <p>Disponibles como destinatarios y copias en los correos de requisiciones.</p>
    <form onSubmit={save} className="motor-form-grid">
      <label>Nombre *<input required maxLength={150} value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} /></label>
      <label>Correo *<input required type="email" maxLength={254} value={form.email} onChange={e => setForm({ ...form, email: e.target.value })} /></label>
      <label>Celular (opcional)<input type="tel" maxLength={30} value={form.mobile} onChange={e => setForm({ ...form, mobile: e.target.value })} /></label>
      <div className="business-contact-actions"><button className="primary-action" disabled={busy}>{editingId ? 'Guardar cambios' : 'Añadir contacto'}</button>{editingId && <button type="button" className="secondary-action" onClick={clear} disabled={busy}>Cancelar</button>}</div>
    </form>
    {error && <p role="alert">{error}</p>}
    <div className="users-card table-scroll"><table><thead><tr><th>Nombre</th><th>Correo</th><th>Celular</th><th>Acciones</th></tr></thead><tbody>{contacts.map(contact => <tr key={contact.id}><td>{contact.name}</td><td>{contact.email}</td><td>{contact.mobile || '—'}</td><td className="row-actions"><button type="button" onClick={() => edit(contact)} disabled={busy}>Editar</button><button type="button" className="danger" onClick={() => remove(contact)} disabled={busy}>Eliminar</button></td></tr>)}</tbody></table>{!contacts.length && <p className="empty-state">No hay contactos empresariales registrados.</p>}</div>
  </section>
}
