import ImageAttachment from './ImageAttachment'
import { imageToDataUrl } from './imageUpload'
import { useEffect, useRef, useState } from 'react'
import { normalizeName } from './nameSearch'
import { Pencil, Plus, Trash2, X } from 'lucide-react'
import MotorSpecifications from './MotorSpecifications'
import MachineSpareParts from './MachineSpareParts'
import GearReducerSpecifications from './GearReducerSpecifications'

const fields = [['element_code', 'Código', 50], ['name', 'Nombre', 200], ['manufacturer', 'Fabricante', 100], ['model', 'Modelo', 100], ['serial_number', 'Número de serie', 100], ['position', 'Posición', 150]]
const statuses = { OPERATIVO: 'Operativo', PARADO: 'Parado', REPARACION: 'Reparación', RESERVA: 'Reserva', FUERA_SERVICIO: 'Fuera de servicio' }

export default function MachineElements({ apiUrl, token, isAdmin }) {
  const [partsElement, setPartsElement] = useState(null)
  const [reducerElement, setReducerElement] = useState(null)
  const [specElement, setSpecElement] = useState(null)
  const [items, setItems] = useState([])
  const [machines, setMachines] = useState([])
  const [plants, setPlants] = useState([])
  const [towers, setTowers] = useState([])
  const [types, setTypes] = useState([])
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')
  const [editing, setEditing] = useState(null)
  const [showForm, setShowForm] = useState(false)
  const [machineId, setMachineId] = useState('')
  const [parentId, setParentId] = useState('')
  const [filter, setFilter] = useState('')
  const [plantFilter, setPlantFilter] = useState('')
  const [towerFilter, setTowerFilter] = useState('')
  const [nameSearch, setNameSearch] = useState('')
  const [photo, setPhoto] = useState(null)
  const [preview, setPreview] = useState(null)

  useEffect(() => {
    const controller = new AbortController()
    setLoading(true)
    Promise.all(['elementos-maquinas', 'maquinas', 'tipos-elementos', 'plantas', 'torres'].map(async (path) => {
      const response = await fetch(`${apiUrl}/${path}`, { headers: { Authorization: `Bearer ${token}` }, signal: controller.signal })
      const data = await response.json()
      if (!response.ok) throw new Error(typeof data.detail === 'string' ? data.detail : 'No se pudieron cargar los datos.')
      return data
    })).then(([elements, machines, types, plants, towers]) => { setItems(elements); setMachines(machines); setTypes(types); setPlants(plants); setTowers(towers) })
      .catch((error) => { if (error.name !== 'AbortError') setMessage(error.message) })
      .finally(() => { if (!controller.signal.aborted) setLoading(false) })
    return () => controller.abort()
  }, [apiUrl, token])

  useEffect(() => {
    if (!photo) { setPreview(null); return }
    const url = URL.createObjectURL(photo)
    setPreview(url)
    return () => URL.revokeObjectURL(url)
  }, [photo])

  const excludedParents = new Set(editing ? [editing.element_id] : [])
  let changed = true
  while (changed) {
    changed = false
    for (const item of items) {
      if (excludedParents.has(item.parent_element_id) && !excludedParents.has(item.element_id)) { excludedParents.add(item.element_id); changed = true }
    }
  }
  const parents = items.filter((item) => item.machine_id === Number(machineId) && !excludedParents.has(item.element_id))
  const machineLabel = (id) => { const machine = machines.find((item) => item.machine_id === id); return machine ? `${machine.asset_code} · ${machine.name}` : id }

  function openForm(item = null) {
    setEditing(item); setMachineId(String(item?.machine_id || filter || '')); setParentId(String(item?.parent_element_id || ''))
    setError(''); setPhoto(null); setShowForm(true)
  }
  function closeForm() { if (!busy) { setShowForm(false); setPhoto(null) } }

  async function save(event) {
    event.preventDefault()
    if (busy || !isAdmin) return
    const form = new FormData(event.currentTarget)
    const payload = Object.fromEntries([...form.entries()].map(([key, value]) => [key, value.trim() || null]))
    payload.machine_id = Number(machineId)
    payload.element_type_id = Number(payload.element_type_id)
    payload.parent_element_id = parentId ? Number(parentId) : null
    payload.quantity = form.get('quantity')
    payload.active = form.get('active') === 'on'
    if (!payload.name) { setError('El nombre es obligatorio.'); return }
    setBusy(true); setError('')
    try {
      if (photo) {
        if (photo.size > 10 * 1024 * 1024) throw new Error('La imagen no puede superar 10 MB.')
        payload.image_data = await imageToDataUrl(photo)
      }
      const response = await fetch(`${apiUrl}/elementos-maquinas${editing ? `/${editing.element_id}` : ''}`, {
        method: editing ? 'PUT' : 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify(payload),
      })
      const data = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(typeof data.detail === 'string' ? data.detail : 'Revisa los datos ingresados.')
      setItems((items) => editing ? items.map((item) => item.element_id === data.element_id ? data : item) : [data, ...items])
      const savedMachine=machines.find(machine=>machine.machine_id===data.machine_id)
      setPlantFilter(savedMachine?.plant_id?String(savedMachine.plant_id):'SIN_ASIGNAR'); setTowerFilter(savedMachine?.tower_id?String(savedMachine.tower_id):''); setFilter(String(data.machine_id)); setShowForm(false); setPhoto(null); setMessage(`Elemento ${data.name} guardado correctamente.`)
    } catch (error) { setError(error.message) } finally { setBusy(false) }
  }

  async function remove(item) {
    if (busy || !isAdmin || !window.confirm(`¿Eliminar definitivamente el elemento ${item.name}?`)) return
    setBusy(true)
    try {
      const response = await fetch(`${apiUrl}/elementos-maquinas/${item.element_id}`, { method: 'DELETE', headers: { Authorization: `Bearer ${token}` } })
      if (!response.ok) { const data = await response.json().catch(() => ({})); throw new Error(typeof data.detail === 'string' ? data.detail : 'No se pudo eliminar el elemento.') }
      setItems((items) => items.filter((entry) => entry.element_id !== item.element_id)); setMessage(`Elemento ${item.name} eliminado correctamente.`)
    } catch (error) { setMessage(error.message) } finally { setBusy(false) }
  }

  const dataType = (item) => types.find((type) => type.element_type_id === item.element_type_id)?.specification_type || 'NONE'
  const query = normalizeName(nameSearch)
  const filteredMachines=machines.filter(machine=>(!plantFilter||(plantFilter==='SIN_ASIGNAR'?machine.plant_id==null:String(machine.plant_id)===plantFilter))&&(!towerFilter||String(machine.tower_id)===towerFilter))
  const visibleMachineIds=new Set(filteredMachines.map(machine=>machine.machine_id))
  const visible = items.filter((item) => normalizeName(item.name).includes(query) && visibleMachineIds.has(item.machine_id) && (!filter || item.machine_id === Number(filter)))
  return <>
    {partsElement && <MachineSpareParts key={partsElement.element_id} apiUrl={apiUrl} token={token} machine={machines.find(machine => machine.machine_id === partsElement.machine_id)} element={partsElement} isAdmin={isAdmin} onClose={() => setPartsElement(null)} />}
    {reducerElement && <GearReducerSpecifications key={reducerElement.element_id} apiUrl={apiUrl} token={token} element={reducerElement} isAdmin={isAdmin} onClose={() => setReducerElement(null)} />}
    {specElement && <MotorSpecifications key={specElement.element_id} apiUrl={apiUrl} token={token} element={specElement} isAdmin={isAdmin} onClose={() => setSpecElement(null)} />}
    <div className="page-heading"><div><p className="eyebrow">ACTIVOS</p><h1>Elementos de máquinas</h1><p>Componentes, subconjuntos y su ubicación dentro de cada máquina.</p></div>{isAdmin && <button className="primary-action" disabled={loading || busy || !machines.length || !types.some((type) => type.active)} onClick={() => openForm()}><Plus size={18} /> Nuevo elemento</button>}</div>
    <div className="motor-form-grid report-filters"><label>Planta<select value={plantFilter} onChange={event=>{setPlantFilter(event.target.value);setTowerFilter('');setFilter('')}}><option value="">Todas las plantas</option><option value="SIN_ASIGNAR">Sin asignar</option>{plants.map(plant=><option key={plant.plant_id} value={plant.plant_id}>{plant.name}</option>)}</select></label><label>Torre<select value={towerFilter} disabled={!plantFilter||plantFilter==='SIN_ASIGNAR'} onChange={event=>{setTowerFilter(event.target.value);setFilter('')}}><option value="">Todas las torres</option>{towers.filter(tower=>String(tower.plant_id)===plantFilter).map(tower=><option key={tower.tower_id} value={tower.tower_id}>{tower.name}</option>)}</select></label><label>Máquina<select value={filter} onChange={(event) => setFilter(event.target.value)}><option value="">Todas las máquinas</option>{filteredMachines.map((item) => <option key={item.machine_id} value={item.machine_id}>{machineLabel(item.machine_id)}</option>)}</select></label><label>Buscar elemento por nombre<input type="search" value={nameSearch} onChange={event => setNameSearch(event.target.value)} placeholder="Escribe parte del nombre…" /></label></div>
    {!loading && (!machines.length || !types.some((type) => type.active)) && <p className="field-help">Para agregar elementos, registra una máquina y un tipo de elemento activo.</p>}
    <div className="users-card table-scroll"><table><thead><tr><th>Repuestos</th><th>Data del elemento</th>{isAdmin && <th>Acciones</th>}<th>Planta</th><th>Torre</th><th>Máquina</th><th>Código / Nombre</th><th>Tipo</th><th>Elemento padre</th><th>Posición</th><th>Cantidad</th><th>Criticidad</th><th>Estado</th><th>Activo</th><th>Foto</th></tr></thead><tbody>{visible.map((item) => {const machine=machines.find(entry=>entry.machine_id===item.machine_id);return <tr key={item.element_id}>
      <td><button className="secondary-action" disabled={!machines.some(machine => machine.machine_id === item.machine_id)} onClick={() => setPartsElement(item)}>Ver repuestos</button></td>
      <td>{dataType(item) === 'MOTOR' ? <button className="secondary-action" aria-label={`Abrir data de motor de ${item.name}`} onClick={() => setSpecElement(item)}>Data de motor</button> : dataType(item) === 'REDUCTOR' ? <button className="secondary-action" aria-label={`Abrir data de reductor de ${item.name}`} onClick={() => setReducerElement(item)}>Data de reductor</button> : <span className="field-help">Sin data asignada</span>}</td>
      {isAdmin && <td className="row-actions"><button title="Editar" aria-label={`Editar ${item.name}`} disabled={busy} onClick={() => openForm(item)}><Pencil size={16} /></button><button title="Eliminar" aria-label={`Eliminar ${item.name}`} className="danger" disabled={busy} onClick={() => remove(item)}><Trash2 size={16} /></button></td>}
      <td>{machine?.plant_name||'Sin asignar'}</td><td>{machine?.tower_name||'Sin asignar'}</td><td>{machineLabel(item.machine_id)}</td><td><strong>{item.element_code ? `${item.element_code} · ` : ''}{item.name}</strong></td><td>{types.find((type) => type.element_type_id === item.element_type_id)?.name || item.element_type_id}</td><td>{items.find((parent) => parent.element_id === item.parent_element_id)?.name || '—'}</td><td>{item.position || '—'}</td><td>{item.quantity}</td><td>{item.criticality || 'Sin definir'}</td><td>{statuses[item.status]}</td><td>{item.active ? 'Sí' : 'No'}</td><td>{item.image_path ? <ElementImage apiUrl={apiUrl} token={token} item={item} /> : 'Sin foto'}</td>
    </tr>})}</tbody></table>{!loading && !visible.length && <p className="empty-state">No hay elementos para mostrar.</p>}</div>
    <p className="admin-message" role="status">{loading ? 'Cargando...' : message}</p>
    {showForm && isAdmin && <div className="modal-backdrop"><div className="motor-modal" role="dialog" aria-modal="true" aria-labelledby="element-title">
      <div className="modal-header"><h2 id="element-title">{editing ? 'Editar elemento' : 'Nuevo elemento'}</h2><button aria-label="Cerrar" disabled={busy} onClick={closeForm}><X /></button></div>
      <form onSubmit={save}><div className="motor-form-grid">
        <label>Máquina *<select value={machineId} required onChange={(event) => { setMachineId(event.target.value); setParentId('') }}><option value="">Selecciona una máquina</option>{machines.map((item) => <option key={item.machine_id} value={item.machine_id}>{machineLabel(item.machine_id)}</option>)}</select></label>
        <label>Tipo de elemento *<select name="element_type_id" required defaultValue={editing?.element_type_id || ''}><option value="">Selecciona un tipo</option>{types.filter((type) => type.active || type.element_type_id === editing?.element_type_id).map((type) => <option key={type.element_type_id} value={type.element_type_id}>{type.name}{type.active ? '' : ' (Inactivo)'}</option>)}</select></label>
        <label>Elemento padre<select value={parentId} disabled={!machineId} onChange={(event) => setParentId(event.target.value)}><option value="">Sin elemento padre</option>{parents.map((item) => <option key={item.element_id} value={item.element_id}>{item.element_code ? `${item.element_code} · ` : ''}{item.name}</option>)}</select></label>
        {fields.map(([name, label, maxLength]) => <label key={name}>{label}{name === 'name' ? ' *' : ''}<input name={name} maxLength={maxLength} required={name === 'name'} defaultValue={editing?.[name] || ''} /></label>)}
        <label>Cantidad *<input name="quantity" type="number" min="0.01" max="99999999.99" step="0.01" required defaultValue={editing?.quantity ?? 1} /></label>
        <label>Fecha de instalación<input name="installation_date" type="date" defaultValue={editing?.installation_date || ''} /></label>
        <label>Criticidad<select name="criticality" defaultValue={editing?.criticality || ''}><option value="">Sin definir</option>{['BAJA', 'MEDIA', 'ALTA', 'CRITICA'].map((value) => <option key={value} value={value}>{value}</option>)}</select></label>
        <label>Estado<select name="status" defaultValue={editing?.status || 'OPERATIVO'}>{Object.entries(statuses).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
        <label className="checkbox-field">Activo<input name="active" type="checkbox" defaultChecked={editing?.active ?? true} /></label>
        <label className="full-field">Descripción<textarea name="description" maxLength={500} rows={2} defaultValue={editing?.description || ''} /></label>
        <ImageAttachment label="Foto" onChange={(event) => setPhoto(event.target.files[0] || null)} help="JPG, PNG o WEBP. Máximo 10 MB. La foto actual se conserva si no seleccionas otra." />
        {(preview || editing?.image_path) && <div className="full-field nameplate-preview">{preview ? <img src={preview} alt="Vista previa del elemento" /> : <ElementImage apiUrl={apiUrl} token={token} item={editing} large />}</div>}
        <label className="full-field">Notas<textarea name="notes" rows={3} defaultValue={editing?.notes || ''} /></label>
      </div>{error && <p className="admin-message" role="alert">{error}</p>}<div className="modal-actions"><button type="button" className="secondary-action" disabled={busy} onClick={closeForm}>Cancelar</button><button className="primary-action" disabled={busy}>{busy ? 'Guardando...' : 'Guardar elemento'}</button></div></form>
    </div></div>}
  </>
}

function ElementImage({ apiUrl, token, item, large = false }) {
  const [src, setSrc] = useState(null)
  const [failed, setFailed] = useState(false)
  const [visible, setVisible] = useState(large)
  const placeholder = useRef(null)
  useEffect(() => {
    if (visible) return
    if (!('IntersectionObserver' in window)) { setVisible(true); return }
    const observer = new IntersectionObserver(entries => {
      if (entries[0].isIntersecting) { setVisible(true); observer.disconnect() }
    }, { rootMargin: '200px' })
    if (placeholder.current) observer.observe(placeholder.current)
    return () => observer.disconnect()
  }, [visible])
  useEffect(() => {
    if (!visible) return
    const controller = new AbortController()
    let url
    setSrc(null)
    setFailed(false)
    fetch(`${apiUrl}/elementos-maquinas/${item.element_id}/imagen`, { headers: { Authorization: `Bearer ${token}` }, signal: controller.signal })
      .then((response) => { if (!response.ok) throw new Error(); return response.blob() })
      .then((blob) => { if (!controller.signal.aborted) { url = URL.createObjectURL(blob); setSrc(url) } })
      .catch((error) => { if (error.name !== 'AbortError') setFailed(true) })
    return () => { controller.abort(); if (url) URL.revokeObjectURL(url) }
  }, [apiUrl, token, item.element_id, item.image_path, visible])
  return src ? <img src={src} loading="lazy" className={large ? 'nameplate-large' : 'nameplate-thumb'} alt={`Foto de ${item.name}`} /> : <span ref={placeholder} className="no-image" role="status">{failed ? 'Imagen no disponible' : visible ? 'Cargando foto…' : 'Foto pendiente'}</span>
}
