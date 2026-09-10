import { useEffect, useState } from 'react'
import { normalizeName } from './nameSearch'
import { Pencil, Plus, Trash2, X } from 'lucide-react'
import MachineSpareParts from './MachineSpareParts'

const fields = [
  ['asset_code', 'Código del activo', 50, true], ['name', 'Nombre', 200, true],
  ['manufacturer', 'Fabricante', 100], ['model', 'Modelo', 100],
  ['serial_number', 'Número de serie', 100], ['area', 'Área', 100],
  ['production_line', 'Línea de producción', 100], ['location', 'Ubicación', 200],
]
const statuses = { ACTIVA: 'Activa', PARADA: 'Parada', MANTENIMIENTO: 'Mantenimiento', FUERA_SERVICIO: 'Fuera de servicio' }

export default function Machines({ apiUrl, token, isAdmin, onHistory }) {
  const [partsMachine, setPartsMachine] = useState(null)
  const [editing, setEditing] = useState(null)
  const [deleting, setDeleting] = useState(null)
  const [machines, setMachines] = useState([])
  const [plants, setPlants] = useState([])
  const [towers, setTowers] = useState([])
  const [structureError, setStructureError] = useState('')
  const [structureReady, setStructureReady] = useState(false)
  const [selectedPlant, setSelectedPlant] = useState('')
  const [selectedTower, setSelectedTower] = useState('')
  const [plantFilter, setPlantFilter] = useState('')
  const [towerFilter, setTowerFilter] = useState('')
  const [nameSearch, setNameSearch] = useState('')
  const [showForm, setShowForm] = useState(false)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')
  const [photo, setPhoto] = useState(null)
  const [preview, setPreview] = useState(null)

  useEffect(() => {
    const controller = new AbortController()
    fetch(`${apiUrl}/maquinas`, { headers: { Authorization: `Bearer ${token}` }, signal: controller.signal })
      .then(async (response) => {
        const data = await response.json()
        if (!response.ok) throw new Error(data.detail || 'No se pudieron cargar las máquinas.')
        setMachines(data)
      })
      .catch((error) => { if (error.name !== 'AbortError') setMessage(error.message) })
      .finally(() => { if (!controller.signal.aborted) setLoading(false) })
    return () => controller.abort()
  }, [apiUrl, token])

  useEffect(() => {
    const controller = new AbortController()
    setStructureReady(false); setStructureError('')
    Promise.all(['/plantas','/torres'].map(async path => {
      const response = await fetch(`${apiUrl}${path}`, { headers: { Authorization: `Bearer ${token}` }, signal: controller.signal })
      const data = await response.json()
      if (!response.ok) throw new Error(typeof data.detail === 'string' ? data.detail : 'No se pudo cargar plantas y torres.')
      return data
    })).then(([p,t]) => { setPlants(p); setTowers(t); setStructureReady(true) })
      .catch(err => { if (err.name !== 'AbortError') setStructureError(err.message) })
    return () => controller.abort()
  }, [apiUrl, token])

  useEffect(() => {
    if (!photo) { setPreview(null); return }
    const url = URL.createObjectURL(photo)
    setPreview(url)
    return () => URL.revokeObjectURL(url)
  }, [photo])

  async function saveMachine(event) {
    event.preventDefault()
    if (saving || !structureReady) return
    const form = new FormData(event.currentTarget)
    const payload = Object.fromEntries([...form.entries()].map(([key, value]) => [key, value.trim() || null]))
    payload.tower_id = selectedTower ? Number(selectedTower) : null
    if (!payload.asset_code || !payload.name) { setError('El código y el nombre son obligatorios.'); return }
    setSaving(true)
    setError('')
    try {
      if (photo) {
        if (photo.size > 10 * 1024 * 1024) throw new Error('La imagen no puede superar 10 MB.')
        payload.image_data = await new Promise((resolve, reject) => {
          const reader = new FileReader()
          reader.onload = () => resolve(reader.result)
          reader.onerror = () => reject(new Error('No se pudo leer la imagen.'))
          reader.readAsDataURL(photo)
        })
      }
      const response = await fetch(`${apiUrl}/maquinas${editing ? `/${editing.machine_id}` : ''}`, {
        method: editing ? 'PUT' : 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      const data = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(typeof data.detail === 'string' ? data.detail : 'Revisa los datos ingresados.')
      setMachines((items) => editing ? items.map((item) => item.machine_id === data.machine_id ? data : item) : [data, ...items])
      setShowForm(false)
      setPhoto(null)
      setMessage(`Máquina ${data.asset_code} guardada correctamente.`)
    } catch (error) { setError(error.message) } finally { setSaving(false) }
  }

  function closeForm() { if (!saving) { setShowForm(false); setPhoto(null) } }

  function openForm(machine = null) {
    setSelectedPlant(machine?.plant_id ? String(machine.plant_id) : '')
    setSelectedTower(machine?.tower_id ? String(machine.tower_id) : '')
    setEditing(machine)
    setError('')
    setPhoto(null)
    setShowForm(true)
  }

  async function deleteMachine(machine) {
    if (!isAdmin || deleting !== null || !window.confirm(`¿Eliminar definitivamente la máquina ${machine.asset_code} (${machine.name})?`)) return
    setDeleting(machine.machine_id)
    try {
      const response = await fetch(`${apiUrl}/maquinas/${machine.machine_id}`, { method: 'DELETE', headers: { Authorization: `Bearer ${token}` } })
      if (!response.ok) {
        const data = await response.json().catch(() => ({}))
        throw new Error(typeof data.detail === 'string' ? data.detail : 'No se pudo eliminar la máquina.')
      }
      setMachines((items) => items.filter((item) => item.machine_id !== machine.machine_id))
      setMessage(`Máquina ${machine.asset_code} eliminada correctamente.`)
    } catch (error) { setMessage(error.message) } finally { setDeleting(null) }
  }

  const query = normalizeName(nameSearch)
  const visibleMachines = machines.filter(m => normalizeName(m.name).includes(query) && (!plantFilter || (plantFilter === 'unassigned' ? m.tower_id == null : String(m.plant_id) === plantFilter)) && (!towerFilter || String(m.tower_id) === towerFilter))

  return <>
    {partsMachine && <MachineSpareParts key={partsMachine.machine_id} apiUrl={apiUrl} token={token} machine={partsMachine} isAdmin={isAdmin} onClose={() => setPartsMachine(null)} />}
    <div className="page-heading"><div><p className="eyebrow">ACTIVOS</p><h1>Máquinas</h1><p>Inventario de máquinas y datos de operación.</p></div><button className="primary-action" onClick={() => openForm()}><Plus size={18} /> Nueva máquina</button></div>
    {structureError && <p role="alert">{structureError}</p>}
    <div className="motor-form-grid report-filters"><label>Planta<select value={plantFilter} onChange={e=>{setPlantFilter(e.target.value);setTowerFilter('')}}><option value="">Todas las plantas</option><option value="unassigned">Sin asignar</option>{plants.map(p=><option key={p.plant_id} value={p.plant_id}>{p.name}</option>)}</select></label><label>Torre<select value={towerFilter} disabled={!plantFilter || plantFilter==='unassigned'} onChange={e=>setTowerFilter(e.target.value)}><option value="">Todas las torres</option>{towers.filter(t=>String(t.plant_id)===plantFilter).map(t=><option key={t.tower_id} value={t.tower_id}>{t.name}</option>)}</select></label></div>
    <div className="motor-form-grid report-filters"><label>Buscar máquina por nombre<input type="search" value={nameSearch} onChange={event => setNameSearch(event.target.value)} placeholder="Escribe parte del nombre…" /></label></div>
    <div className="users-card table-scroll"><table><thead><tr>{isAdmin && <th>Acciones</th>}<th>Intervenciones</th><th>Repuestos</th><th>Código</th><th>Nombre</th><th>Planta</th><th>Torre</th><th>Fabricante / Modelo</th><th>Serie</th><th>Área / Línea</th><th>Ubicación</th><th>Criticidad</th><th>Estado</th></tr></thead><tbody>{visibleMachines.map((machine) => <tr key={machine.machine_id}>
      {isAdmin && <td className="row-actions"><button title="Editar máquina" aria-label={`Editar ${machine.asset_code}`} disabled={deleting !== null} onClick={() => openForm(machine)}><Pencil size={16} /></button><button className="danger" title="Eliminar máquina" aria-label={`Eliminar ${machine.asset_code}`} disabled={deleting !== null} onClick={() => deleteMachine(machine)}><Trash2 size={16} /></button></td>}
      <td><button className="secondary-action" onClick={() => onHistory(machine)}>Intervenciones</button></td><td><button className="secondary-action" onClick={() => setPartsMachine(machine)} aria-label={`Ver repuestos de ${machine.asset_code}`}>Ver repuestos</button></td><td><strong>{machine.asset_code}</strong></td><td>{machine.name}</td><td>{machine.plant_name || 'Sin asignar'}</td><td>{machine.tower_name || 'Sin asignar'}</td><td>{[machine.manufacturer, machine.model].filter(Boolean).join(' / ') || '—'}</td><td>{machine.serial_number || '—'}</td><td>{[machine.area, machine.production_line].filter(Boolean).join(' / ') || '—'}</td><td>{machine.location || '—'}</td><td>{machine.criticality || 'Sin definir'}</td><td>{statuses[machine.status] || machine.status}</td>
    </tr>)}</tbody></table>{!loading && !message && !machines.length && <p className="empty-state">No hay máquinas registradas.</p>}</div>
    <p className="admin-message" role="status">{loading ? 'Cargando máquinas...' : message}</p>
    {showForm && <div className="modal-backdrop"><div className="motor-modal" role="dialog" aria-modal="true" aria-labelledby="machine-form-title">
      <div className="modal-header"><h2 id="machine-form-title">{editing ? 'Editar máquina' : 'Nueva máquina'}</h2><button onClick={closeForm} disabled={saving} aria-label="Cerrar"><X /></button></div>
      <form onSubmit={saveMachine}><div className="motor-form-grid">
        <label>Planta<select value={selectedPlant} disabled={!structureReady || saving} onChange={e=>{setSelectedPlant(e.target.value);setSelectedTower('')}}><option value="">Sin asignar</option>{plants.map(p=><option key={p.plant_id} value={p.plant_id}>{p.name}</option>)}</select></label>
        <label>Torre<select value={selectedTower} disabled={!structureReady || !selectedPlant || saving} required={!!selectedPlant} onChange={e=>setSelectedTower(e.target.value)}><option value="">Selecciona una torre</option>{towers.filter(t=>String(t.plant_id)===selectedPlant).map(t=><option key={t.tower_id} value={t.tower_id}>{t.name}</option>)}</select></label>
        <p className="full-field field-help">Cada m?quina pertenece a una torre. Puedes crear m?s plantas y torres desde Activos ? Plantas y torres.</p>
        {fields.map(([name, label, maxLength, required]) => <label key={name}>{label}{required ? ' *' : ''}<input name={name} defaultValue={editing?.[name] ?? ''} maxLength={maxLength} required={required} autoFocus={name === 'asset_code'} /></label>)}
        <label>Fecha de instalación<input name="installation_date" type="date" defaultValue={editing?.installation_date || ''} /></label>
        <label>Fecha de puesta en marcha<input name="commissioning_date" type="date" defaultValue={editing?.commissioning_date || ''} /></label>
        <label>Criticidad<select name="criticality" defaultValue={editing?.criticality || ''}><option value="">Sin definir</option><option value="BAJA">Baja</option><option value="MEDIA">Media</option><option value="ALTA">Alta</option><option value="CRITICA">Crítica</option></select></label>
        <label>Estado<select name="status" defaultValue={editing?.status || 'ACTIVA'}>{Object.entries(statuses).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
        <label className="full-field">Descripción<textarea name="description" defaultValue={editing?.description || ''} maxLength={500} rows={2} /></label>
        <label className="full-field">Foto de la máquina<input type="file" accept="image/jpeg,image/png,image/webp" onChange={(event) => setPhoto(event.target.files[0] || null)} /><span className="field-help">JPG, PNG o WEBP. Máximo 10 MB.</span></label>
        {editing?.machine_image_path && !photo && <p className="full-field field-help">Esta máquina tiene una foto guardada. Se conservará si no seleccionas otra.</p>}
        {preview && <div className="full-field nameplate-preview"><img src={preview} alt="Vista previa de la máquina" /></div>}
        <label className="full-field">Notas<textarea name="notes" defaultValue={editing?.notes || ''} rows={3} /></label>
      </div>{error && <p role="alert" className="admin-message">{error}</p>}<div className="modal-actions"><button type="button" className="secondary-action" onClick={closeForm} disabled={saving}>Cancelar</button><button className="primary-action" disabled={saving || !structureReady}>{saving ? 'Guardando...' : 'Guardar máquina'}</button></div></form>
    </div></div>}
  </>
}
