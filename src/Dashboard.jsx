import { useEffect, useState } from 'react'
import { LogOut, Pencil, Plus, Trash2, Users, Wrench, X } from 'lucide-react'

const textFields = ['brand', 'model', 'serial_number', 'area', 'location', 'associated_equipment', 'frame', 'protection_class', 'insulation_class', 'notes']
const numberFields = ['power_kw', 'power_hp', 'rated_voltage', 'rated_current', 'frequency_hz', 'rpm', 'service_factor']
const dateFields = ['installation_date', 'commissioning_date']

function requestError(data, fallback) {
  return Array.isArray(data.detail) ? 'Revisa los datos ingresados.' : data.detail || fallback
}

export default function Dashboard({ apiUrl, token, currentUser, onUserChange, onLogout }) {
  const isAdmin = currentUser.rol === 'ADMIN'
  const [section, setSection] = useState('motors')
  const [motors, setMotors] = useState([])
  const [users, setUsers] = useState([])
  const [editing, setEditing] = useState(null)
  const [showForm, setShowForm] = useState(false)
  const [imagePreview, setImagePreview] = useState(null)
  const [loading, setLoading] = useState(false)
  const [message, setMessage] = useState('')

  const authHeaders = { Authorization: `Bearer ${token}` }

  useEffect(() => { loadMotors() }, [])
  useEffect(() => { if (section === 'users' && isAdmin) loadUsers() }, [section])

  async function loadMotors() {
    setLoading(true)
    try {
      const response = await fetch(`${apiUrl}/motores`, { headers: authHeaders })
      const data = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(requestError(data, 'No se pudieron cargar los motores.'))
      setMotors(data)
    } catch (error) { setMessage(error.message) } finally { setLoading(false) }
  }

  async function loadUsers() {
    setLoading(true)
    try {
      const response = await fetch(`${apiUrl}/usuarios`, { headers: authHeaders })
      const data = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(requestError(data, 'No se pudieron cargar los usuarios.'))
      setUsers(data)
    } catch (error) { setMessage(error.message) } finally { setLoading(false) }
  }

  function openMotorForm(motor = null) {
    setEditing(motor)
    setImagePreview(null)
    setShowForm(true)
    setMessage('')
  }

  async function saveMotor(event) {
    event.preventDefault()
    const form = new FormData(event.currentTarget)
    const payload = {
      asset_code: form.get('asset_code')?.trim(),
      description: form.get('description')?.trim(),
      criticality: form.get('criticality') || null,
      status: form.get('status'),
    }
    textFields.forEach((field) => { payload[field] = form.get(field)?.trim() || null })
    numberFields.forEach((field) => { payload[field] = form.get(field) === '' ? null : Number(form.get(field)) })
    dateFields.forEach((field) => { payload[field] = form.get(field) || null })
    const imageFile = form.get('nameplate_image')
    if (imageFile?.size) {
      if (imageFile.size > 10 * 1024 * 1024) return setMessage('La imagen no puede superar 10 MB.')
      payload.nameplate_image_data = await readFileAsDataUrl(imageFile)
    }

    setLoading(true)
    try {
      const response = await fetch(`${apiUrl}/motores${editing ? `/${editing.motor_id}` : ''}`, {
        method: editing ? 'PUT' : 'POST',
        headers: { ...authHeaders, 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      const data = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(requestError(data, 'No se pudo guardar el motor.'))
      setShowForm(false)
      setEditing(null)
      setMessage(`Motor ${data.asset_code} guardado correctamente.`)
      await loadMotors()
    } catch (error) { setMessage(error.message) } finally { setLoading(false) }
  }

  async function deleteMotor(motor) {
    if (!window.confirm(`¿Eliminar definitivamente el motor ${motor.asset_code}?`)) return
    try {
      const response = await fetch(`${apiUrl}/motores/${motor.motor_id}`, { method: 'DELETE', headers: authHeaders })
      if (!response.ok) {
        const data = await response.json().catch(() => ({}))
        throw new Error(requestError(data, 'No se pudo eliminar el motor.'))
      }
      setMotors((items) => items.filter((item) => item.motor_id !== motor.motor_id))
      setMessage('Motor eliminado correctamente.')
    } catch (error) { setMessage(error.message) }
  }

  async function updateRole(userId, rol) {
    try {
      const response = await fetch(`${apiUrl}/usuarios/${userId}/rol`, {
        method: 'PATCH', headers: { ...authHeaders, 'Content-Type': 'application/json' }, body: JSON.stringify({ rol }),
      })
      const data = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(requestError(data, 'No se pudo actualizar el rol.'))
      setUsers((items) => items.map((item) => item.id === userId ? { ...item, rol: data.rol } : item))
      if (currentUser.id === userId) onUserChange({ ...currentUser, rol: data.rol })
      setMessage(`Rol de ${data.nombre} actualizado.`)
    } catch (error) { setMessage(error.message) }
  }

  return <main className="admin-shell">
    <header className="admin-header">
      <div className="brand"><span className="brand-mark"><Wrench size={22} /></span><span>Manteni</span></div>
      <nav className="main-nav">
        <button className={section === 'motors' ? 'selected' : ''} onClick={() => setSection('motors')}>Motores</button>
        {isAdmin && <button className={section === 'users' ? 'selected' : ''} onClick={() => setSection('users')}>Usuarios</button>}
      </nav>
      <div className="admin-user"><span>{currentUser.nombre} · {currentUser.rol}</span><button className="logout-button" onClick={onLogout}><LogOut size={17} /> Salir</button></div>
    </header>

    <section className="admin-content">
      {section === 'motors' ? <>
        <div className="page-heading"><div><p className="eyebrow">ACTIVOS</p><h1>Motores</h1><p>Inventario y datos tecnicos de motores.</p></div><button className="primary-action" onClick={() => openMotorForm()}><Plus size={18} /> Nuevo motor</button></div>
        <div className="users-card table-scroll"><table><thead><tr><th>Placa</th><th>Codigo</th><th>Descripcion</th><th>Marca / Modelo</th><th>Area</th><th>Potencia</th><th>Criticidad</th><th>Estado</th>{isAdmin && <th>Acciones</th>}</tr></thead>
          <tbody>{motors.map((motor) => <tr key={motor.motor_id}><td>{motor.nameplate_image_path ? <SecureImage apiUrl={apiUrl} token={token} motorId={motor.motor_id} fileName={motor.asset_code} /> : <span className="no-image">Sin foto</span>}</td><td><strong>{motor.asset_code}</strong></td><td>{motor.description}</td><td>{[motor.brand, motor.model].filter(Boolean).join(' / ') || '—'}</td><td>{motor.area || '—'}</td><td>{motor.power_kw != null ? `${motor.power_kw} kW` : '—'}</td><td>{motor.criticality || '—'}</td><td><span className="status-badge active">{motor.status}</span></td>{isAdmin && <td className="row-actions"><button title="Editar" onClick={() => openMotorForm(motor)}><Pencil size={16} /></button><button className="danger" title="Eliminar" onClick={() => deleteMotor(motor)}><Trash2 size={16} /></button></td>}</tr>)}</tbody></table>{!loading && !motors.length && <p className="empty-state">No hay motores registrados.</p>}</div>
      </> : <>
        <div className="page-heading"><div><p className="eyebrow">CONFIGURACION</p><h1>Administrar usuarios</h1><p>Gestion de roles de acceso.</p></div><Users size={28} /></div>
        <div className="users-card table-scroll"><table><thead><tr><th>Nombre</th><th>Correo</th><th>Rol</th><th>Estado</th><th>Creado</th></tr></thead><tbody>{users.map((user) => <tr key={user.id}><td><strong>{user.nombre}</strong></td><td>{user.correo}</td><td><select value={user.rol} onChange={(e) => updateRole(user.id, e.target.value)}><option value="USUARIO">Usuario</option><option value="ADMIN">Administrador</option></select></td><td>{user.activo ? 'Activo' : 'Inactivo'}</td><td>{new Date(user.creado_en).toLocaleDateString()}</td></tr>)}</tbody></table></div>
      </>}
      <p className="admin-message" role="status">{loading ? 'Cargando...' : message}</p>
    </section>

    {showForm && <div className="modal-backdrop" role="presentation"><div className="motor-modal" role="dialog" aria-modal="true"><div className="modal-header"><div><p className="eyebrow">MOTOR</p><h2>{editing ? 'Editar motor' : 'Nuevo motor'}</h2></div><button onClick={() => setShowForm(false)} aria-label="Cerrar"><X /></button></div>
      <form onSubmit={saveMotor}><div className="motor-form-grid">
        <Field name="asset_code" label="Codigo del activo *" value={editing?.asset_code} required /><Field name="description" label="Descripcion *" value={editing?.description} required />
        <Field name="brand" label="Marca" value={editing?.brand} /><Field name="model" label="Modelo" value={editing?.model} /><Field name="serial_number" label="Numero de serie" value={editing?.serial_number} />
        <Field name="area" label="Area" value={editing?.area} /><Field name="location" label="Ubicacion" value={editing?.location} /><Field name="associated_equipment" label="Equipo asociado" value={editing?.associated_equipment} />
        <Field name="power_kw" label="Potencia kW" type="number" step="0.01" value={editing?.power_kw} /><Field name="power_hp" label="Potencia HP" type="number" step="0.01" value={editing?.power_hp} />
        <Field name="rated_voltage" label="Voltaje nominal" type="number" step="0.01" value={editing?.rated_voltage} /><Field name="rated_current" label="Corriente nominal" type="number" step="0.01" value={editing?.rated_current} />
        <Field name="frequency_hz" label="Frecuencia Hz" type="number" step="0.01" value={editing?.frequency_hz ?? 60} /><Field name="rpm" label="RPM" type="number" step="1" value={editing?.rpm} />
        <Field name="frame" label="Frame" value={editing?.frame} /><Field name="protection_class" label="Clase de proteccion" value={editing?.protection_class ?? 'IP55'} /><Field name="insulation_class" label="Clase de aislamiento" value={editing?.insulation_class ?? 'F'} /><Field name="service_factor" label="Factor de servicio" type="number" step="0.01" value={editing?.service_factor ?? 1} />
        <Field name="installation_date" label="Fecha de instalacion" type="date" value={editing?.installation_date} /><Field name="commissioning_date" label="Fecha de puesta en marcha" type="date" value={editing?.commissioning_date} />
        <label>Criticidad<select name="criticality" defaultValue={editing?.criticality || 'MEDIUM'}><option value="">Sin definir</option><option value="LOW">Baja</option><option value="MEDIUM">Media</option><option value="HIGH">Alta</option><option value="CRITICAL">Critica</option></select></label>
        <label>Estado<select name="status" defaultValue={editing?.status || 'ACTIVE'}><option value="ACTIVE">Activo</option><option value="STOPPED">Detenido</option><option value="REPAIR">En reparacion</option><option value="STANDBY">En espera</option><option value="DECOMMISSIONED">Fuera de servicio</option></select></label>
        <label className="full-field">Foto de la placa<input name="nameplate_image" type="file" accept="image/jpeg,image/png,image/webp" onChange={(event) => setImagePreview(event.target.files[0] ? URL.createObjectURL(event.target.files[0]) : null)} /><span className="field-help">JPG, PNG o WEBP. Maximo 10 MB.</span></label>
        {(imagePreview || editing?.nameplate_image_path) && <div className="full-field nameplate-preview">{imagePreview ? <img src={imagePreview} alt="Vista previa de la placa" /> : <SecureImage apiUrl={apiUrl} token={token} motorId={editing.motor_id} fileName={editing.asset_code} large />}</div>}
        <label className="full-field">Notas<textarea name="notes" defaultValue={editing?.notes || ''} rows="3" /></label>
      </div><div className="modal-actions"><button type="button" className="secondary-action" onClick={() => setShowForm(false)}>Cancelar</button><button className="primary-action" disabled={loading}>Guardar motor</button></div></form>
    </div></div>}
  </main>
}

function Field({ label, name, value, type = 'text', ...props }) {
  return <label>{label}<input name={name} type={type} defaultValue={value ?? ''} {...props} /></label>
}

function readFileAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result)
    reader.onerror = () => reject(new Error('No se pudo leer la imagen.'))
    reader.readAsDataURL(file)
  })
}

function SecureImage({ apiUrl, token, motorId, fileName, large = false }) {
  const [src, setSrc] = useState(null)
  const [mimeType, setMimeType] = useState('image/jpeg')
  useEffect(() => {
    let objectUrl
    fetch(`${apiUrl}/motores/${motorId}/placa`, { headers: { Authorization: `Bearer ${token}` } })
      .then((response) => { if (!response.ok) throw new Error(); return response.blob() })
      .then((blob) => { objectUrl = URL.createObjectURL(blob); setMimeType(blob.type); setSrc(objectUrl) })
      .catch(() => setSrc(null))
    return () => { if (objectUrl) URL.revokeObjectURL(objectUrl) }
  }, [apiUrl, token, motorId])
  function downloadImage() {
    if (!window.confirm(`¿Quieres descargar la imagen de la placa del motor ${fileName}?`)) return
    const extension = { 'image/png': 'png', 'image/webp': 'webp', 'image/jpeg': 'jpg' }[mimeType] || 'jpg'
    const link = document.createElement('a')
    link.href = src
    link.download = `${fileName}.${extension}`
    document.body.appendChild(link)
    link.click()
    link.remove()
  }

  return src ? <button className="nameplate-download" type="button" onClick={downloadImage} title="Haz clic para descargar la imagen"><img className={large ? 'nameplate-large' : 'nameplate-thumb'} src={src} alt={`Placa del motor ${fileName}`} /></button> : <span className="no-image">Cargando...</span>
}
