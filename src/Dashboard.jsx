import { useEffect, useState } from 'react'
import Machines from './Machines'
import StockAlerts from './StockAlerts'
import OpeningBalance from './OpeningBalance'
import MaintenanceRequests from './MaintenanceRequests'
import PartsHistory from './PartsHistory'
import SparePartReports from './SparePartReports'
import MachineElementTypes from './MachineElementTypes'
import MachineElements from './MachineElements'
import { Copy, LogOut, Package, Pencil, Plus, Trash2, Truck, Users, Wrench, X } from 'lucide-react'

function requestError(data, fallback) {
  return Array.isArray(data.detail) ? 'Revisa los datos ingresados.' : data.detail || fallback
}

export default function Dashboard({ apiUrl, token, currentUser, onUserChange, onLogout }) {
  const isAdmin = currentUser.rol === 'ADMIN'
  const [showRequests, setShowRequests] = useState(false)
  const [section, setSection] = useState('machines')
  const [historyMachineId, setHistoryMachineId] = useState('')
  const isAssetsSection = ['machines', 'element-types', 'machine-elements', 'events'].includes(section)
  const isSparePartsSection = ['spare-parts', 'suppliers', 'categories', 'spare-reports', 'purchases', 'consumption'].includes(section)
  const [spareParts, setSpareParts] = useState([])
  const [openingBalancePart, setOpeningBalancePart] = useState(null)
  const [duplicatingSparePart, setDuplicatingSparePart] = useState(null)
  const [sparePartCategories, setSparePartCategories] = useState([])
  const [users, setUsers] = useState([])
  const [editingSparePart, setEditingSparePart] = useState(null)
  const [showSparePartForm, setShowSparePartForm] = useState(false)
  const [sparePartImagePreview, setSparePartImagePreview] = useState(null)
  const [editingCategory, setEditingCategory] = useState(null)
  const [showCategoryForm, setShowCategoryForm] = useState(false)
  const [suppliers, setSuppliers] = useState([])
  const [editingSupplier, setEditingSupplier] = useState(null)
  const [showSupplierForm, setShowSupplierForm] = useState(false)
  const [supplierPart, setSupplierPart] = useState(null)
  const [partSuppliers, setPartSuppliers] = useState([])
  const [editingPartSupplier, setEditingPartSupplier] = useState(null)
  const [loading, setLoading] = useState(false)
  const [message, setMessage] = useState('')

  const authHeaders = { Authorization: `Bearer ${token}` }

  useEffect(() => { if (section === 'users' && isAdmin) loadUsers() }, [section])
  useEffect(() => { if (section === 'spare-parts') loadSpareParts() }, [section])
  useEffect(() => { if (section === 'categories' && isAdmin) loadSparePartCategories() }, [section])
  useEffect(() => { if (section === 'suppliers') loadSuppliers() }, [section])

  async function loadUsers() {
    setLoading(true)
    try {
      const response = await fetch(`${apiUrl}/usuarios`, { headers: authHeaders })
      const data = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(requestError(data, 'No se pudieron cargar los usuarios.'))
      setUsers(data)
    } catch (error) { setMessage(error.message) } finally { setLoading(false) }
  }

  async function loadSpareParts() {
    setLoading(true)
    try {
      const [partsResponse, categoriesResponse] = await Promise.all([
        fetch(`${apiUrl}/repuestos`, { headers: authHeaders }),
        fetch(`${apiUrl}/categorias-repuestos`, { headers: authHeaders }),
      ])
      const partsData = await partsResponse.json().catch(() => ({}))
      const categoriesData = await categoriesResponse.json().catch(() => ({}))
      if (!partsResponse.ok) throw new Error(requestError(partsData, 'No se pudieron cargar los repuestos.'))
      if (!categoriesResponse.ok) throw new Error(requestError(categoriesData, 'No se pudieron cargar las categorias.'))
      setSpareParts(partsData)
      setSparePartCategories(categoriesData)
    } catch (error) { setMessage(error.message) } finally { setLoading(false) }
  }

  async function loadSparePartCategories() {
    setLoading(true)
    try {
      const response = await fetch(`${apiUrl}/categorias-repuestos`, { headers: authHeaders })
      const data = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(requestError(data, 'No se pudieron cargar las categorias.'))
      setSparePartCategories(data)
    } catch (error) { setMessage(error.message) } finally { setLoading(false) }
  }

  async function loadSuppliers() {
    setLoading(true)
    try {
      const response = await fetch(`${apiUrl}/proveedores`, { headers: authHeaders })
      const data = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(requestError(data, 'No se pudieron cargar los proveedores.'))
      setSuppliers(data)
    } catch (error) { setMessage(error.message) } finally { setLoading(false) }
  }

  function openSparePartForm(sparePart = null) {
    setEditingSparePart(sparePart)
    setSparePartImagePreview(null)
    setShowSparePartForm(true)
    setMessage('')
  }

  async function saveSparePart(event) {
    event.preventDefault()
    const form = new FormData(event.currentTarget)
    const minimumStock = Number(form.get('minimum_stock'))
    const maximumStock = form.get('maximum_stock') === '' ? null : Number(form.get('maximum_stock'))
    if (maximumStock !== null && maximumStock < minimumStock) {
      return setMessage('El stock maximo no puede ser menor que el stock minimo.')
    }
    const payload = {
      internal_code: form.get('internal_code')?.trim(),
      category_id: Number(form.get('category_id')),
      description: form.get('description')?.trim(),
      brand: form.get('brand')?.trim() || null,
      model: form.get('model')?.trim() || null,
      part_number: form.get('part_number')?.trim() || null,
      unit_of_measure: form.get('unit_of_measure')?.trim(),
      minimum_stock: minimumStock,
      maximum_stock: maximumStock,
      unit_cost: form.get('unit_cost') === '' ? null : Number(form.get('unit_cost')),
      storage_location: form.get('storage_location')?.trim() || null,
      active: form.get('active') === 'on',
      notes: form.get('notes')?.trim() || null,
    }
    const imageFile = form.get('image')
    if (imageFile?.size) {
      if (imageFile.size > 10 * 1024 * 1024) return setMessage('La imagen no puede superar 10 MB.')
      payload.image_data = await readFileAsDataUrl(imageFile)
    }
    setLoading(true)
    try {
      const response = await fetch(`${apiUrl}/repuestos${editingSparePart ? `/${editingSparePart.spare_part_id}` : ''}`, {
        method: editingSparePart ? 'PUT' : 'POST',
        headers: { ...authHeaders, 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      const data = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(requestError(data, 'No se pudo guardar el repuesto.'))
      setShowSparePartForm(false)
      setEditingSparePart(null)
      setMessage(`Repuesto ${data.internal_code} guardado correctamente.`)
      await loadSpareParts()
    } catch (error) { setMessage(error.message) } finally { setLoading(false) }
  }

  async function duplicateSparePart(sparePart) {
    if (!isAdmin || duplicatingSparePart !== null) return
    setDuplicatingSparePart(sparePart.spare_part_id)
    try {
      const response = await fetch(`${apiUrl}/repuestos/${sparePart.spare_part_id}/duplicar`, { method: 'POST', headers: authHeaders })
      const data = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(requestError(data, 'No se pudo duplicar el repuesto.'))
      setSpareParts((items) => [data, ...items])
      setMessage(`Copia ${data.internal_code} creada. Puedes editar su código interno para asignar el definitivo.`)
    } catch (error) { setMessage(error.message) } finally { setDuplicatingSparePart(null) }
  }

  async function deleteSparePart(sparePart) {
    if (!window.confirm(`¿Eliminar definitivamente el repuesto ${sparePart.internal_code}?`)) return
    try {
      const response = await fetch(`${apiUrl}/repuestos/${sparePart.spare_part_id}`, { method: 'DELETE', headers: authHeaders })
      if (!response.ok) {
        const data = await response.json().catch(() => ({}))
        throw new Error(requestError(data, 'No se pudo eliminar el repuesto.'))
      }
      setSpareParts((items) => items.filter((item) => item.spare_part_id !== sparePart.spare_part_id))
      setMessage('Repuesto eliminado correctamente.')
    } catch (error) { setMessage(error.message) }
  }

  function openCategoryForm(category = null) {
    setEditingCategory(category)
    setShowCategoryForm(true)
    setMessage('')
  }

  async function saveCategory(event) {
    event.preventDefault()
    const form = new FormData(event.currentTarget)
    const payload = {
      name: form.get('name')?.trim(),
      description: form.get('description')?.trim() || null,
    }
    setLoading(true)
    try {
      const response = await fetch(`${apiUrl}/categorias-repuestos${editingCategory ? `/${editingCategory.category_id}` : ''}`, {
        method: editingCategory ? 'PUT' : 'POST',
        headers: { ...authHeaders, 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      const data = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(requestError(data, 'No se pudo guardar la categoria.'))
      setShowCategoryForm(false)
      setEditingCategory(null)
      setMessage(`Categoria ${data.name} guardada correctamente.`)
      await loadSparePartCategories()
    } catch (error) { setMessage(error.message) } finally { setLoading(false) }
  }

  async function deleteCategory(category) {
    if (!window.confirm(`¿Eliminar la categoria ${category.name}?`)) return
    try {
      const response = await fetch(`${apiUrl}/categorias-repuestos/${category.category_id}`, { method: 'DELETE', headers: authHeaders })
      if (!response.ok) {
        const data = await response.json().catch(() => ({}))
        throw new Error(requestError(data, 'No se pudo eliminar la categoria.'))
      }
      setSparePartCategories((items) => items.filter((item) => item.category_id !== category.category_id))
      setMessage('Categoria eliminada correctamente.')
    } catch (error) { setMessage(error.message) }
  }

  function openSupplierForm(supplier = null) {
    setEditingSupplier(supplier)
    setShowSupplierForm(true)
    setMessage('')
  }

  async function saveSupplier(event) {
    event.preventDefault()
    const form = new FormData(event.currentTarget)
    const nullableFields = ['supplier_code', 'ruc', 'contact_name', 'phone', 'email', 'address', 'notes']
    const payload = { name: form.get('name')?.trim(), active: form.get('active') === 'on' }
    nullableFields.forEach((field) => { payload[field] = form.get(field)?.trim() || null })
    setLoading(true)
    try {
      const response = await fetch(`${apiUrl}/proveedores${editingSupplier ? `/${editingSupplier.supplier_id}` : ''}`, {
        method: editingSupplier ? 'PUT' : 'POST',
        headers: { ...authHeaders, 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      const data = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(requestError(data, 'No se pudo guardar el proveedor.'))
      setShowSupplierForm(false)
      setEditingSupplier(null)
      setMessage(`Proveedor ${data.name} guardado correctamente.`)
      await loadSuppliers()
    } catch (error) { setMessage(error.message) } finally { setLoading(false) }
  }

  async function deleteSupplier(supplier) {
    if (!window.confirm(`¿Eliminar definitivamente el proveedor ${supplier.name}?`)) return
    try {
      const response = await fetch(`${apiUrl}/proveedores/${supplier.supplier_id}`, { method: 'DELETE', headers: authHeaders })
      if (!response.ok) {
        const data = await response.json().catch(() => ({}))
        throw new Error(requestError(data, 'No se pudo eliminar el proveedor.'))
      }
      setSuppliers((items) => items.filter((item) => item.supplier_id !== supplier.supplier_id))
      setMessage('Proveedor eliminado correctamente.')
    } catch (error) { setMessage(error.message) }
  }

  async function openPartSuppliers(part) {
    setSupplierPart(part)
    setEditingPartSupplier(null)
    setMessage('')
    setLoading(true)
    try {
      const [relationsResponse, suppliersResponse] = await Promise.all([
        fetch(`${apiUrl}/repuestos/${part.spare_part_id}/proveedores`, { headers: authHeaders }),
        fetch(`${apiUrl}/proveedores`, { headers: authHeaders }),
      ])
      const relationsData = await relationsResponse.json().catch(() => ({}))
      const suppliersData = await suppliersResponse.json().catch(() => ({}))
      if (!relationsResponse.ok) throw new Error(requestError(relationsData, 'No se pudieron cargar los proveedores del repuesto.'))
      if (!suppliersResponse.ok) throw new Error(requestError(suppliersData, 'No se pudieron cargar los proveedores.'))
      setPartSuppliers(relationsData)
      setSuppliers(suppliersData)
    } catch (error) { setSupplierPart(null); setMessage(error.message) } finally { setLoading(false) }
  }

  async function savePartSupplier(event) {
    event.preventDefault()
    const form = new FormData(event.currentTarget)
    const payload = {
      supplier_id: Number(form.get('supplier_id')),
      supplier_part_number: form.get('supplier_part_number')?.trim() || null,
      current_price: form.get('current_price') === '' ? null : Number(form.get('current_price')),
      lead_time_days: form.get('lead_time_days') === '' ? null : Number(form.get('lead_time_days')),
      preferred_supplier: form.get('preferred_supplier') === 'on',
      notes: form.get('notes')?.trim() || null,
    }
    setLoading(true)
    try {
      const suffix = editingPartSupplier ? `/${editingPartSupplier.spare_part_supplier_id}` : ''
      const response = await fetch(`${apiUrl}/repuestos/${supplierPart.spare_part_id}/proveedores${suffix}`, {
        method: editingPartSupplier ? 'PUT' : 'POST',
        headers: { ...authHeaders, 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      const data = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(requestError(data, 'No se pudo guardar la relacion.'))
      setEditingPartSupplier(null)
      const refreshed = await fetch(`${apiUrl}/repuestos/${supplierPart.spare_part_id}/proveedores`, { headers: authHeaders })
      setPartSuppliers(await refreshed.json())
      setMessage('Proveedor asociado correctamente.')
    } catch (error) { setMessage(error.message) } finally { setLoading(false) }
  }

  async function removePartSupplier(relation) {
    if (!window.confirm(`¿Quitar a ${relation.supplier_name} de este repuesto?`)) return
    try {
      const response = await fetch(`${apiUrl}/repuestos/${supplierPart.spare_part_id}/proveedores/${relation.spare_part_supplier_id}`, { method: 'DELETE', headers: authHeaders })
      if (!response.ok) {
        const data = await response.json().catch(() => ({}))
        throw new Error(requestError(data, 'No se pudo quitar el proveedor.'))
      }
      setPartSuppliers((items) => items.filter((item) => item.spare_part_supplier_id !== relation.spare_part_supplier_id))
      setEditingPartSupplier(null)
      setMessage('Proveedor retirado del repuesto.')
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
    <MaintenanceRequests apiUrl={apiUrl} token={token} currentUser={currentUser} open={showRequests} onOpen={() => setShowRequests(true)} onClose={() => setShowRequests(false)} />
    {isAdmin && openingBalancePart && <OpeningBalance key={openingBalancePart.spare_part_id} apiUrl={apiUrl} token={token} part={openingBalancePart} onClose={() => setOpeningBalancePart(null)} />}
    <StockAlerts apiUrl={apiUrl} token={token} section={section} />
    <header className="admin-header">
      <div className="brand"><span className="brand-mark"><Wrench size={22} /></span><span>Manteni</span></div>
      <nav className="main-nav">
        <button onClick={() => setShowRequests(true)}>Solicitudes</button>
        <button className={isAssetsSection ? 'selected' : ''} onClick={() => { setMessage(''); setSection('machines') }}>Activos</button>
        <button className={isSparePartsSection ? 'selected' : ''} onClick={() => setSection('spare-parts')}>Repuestos</button>
        {isAdmin && <button className={section === 'users' ? 'selected' : ''} onClick={() => setSection('users')}>Usuarios</button>}
      </nav>
      <div className="admin-user"><span>{currentUser.nombre} · {currentUser.rol}</span><button className="logout-button" onClick={onLogout}><LogOut size={17} /> Salir</button></div>
    </header>

    <section className="admin-content">
      {isAssetsSection && <nav className="spare-parts-nav" aria-label="Activos">
        {[['machines', 'Máquinas'], ['machine-elements', 'Elementos de máquinas'], ['element-types', 'Tipos de elementos'], ['events', 'Intervenciones']].map(([value, label]) => <button key={value} aria-current={section === value ? 'page' : undefined} onClick={() => { setMessage(''); setHistoryMachineId(''); setSection(value) }}>{label}</button>)}
      </nav>}
      {isSparePartsSection && <nav className="spare-parts-nav" aria-label="Repuestos">
        <button aria-current={section === 'spare-parts' ? 'page' : undefined} onClick={() => setSection('spare-parts')}>Inventario</button>
        {[['purchases', 'Compras'], ['consumption', 'Consumos']].map(([value, label]) => <button key={value} aria-current={section === value ? 'page' : undefined} onClick={() => { setMessage(''); setHistoryMachineId(''); setSection(value) }}>{label}</button>)}
        <button aria-current={section === 'spare-reports' ? 'page' : undefined} onClick={() => { setMessage(''); setSection('spare-reports') }}>Consultas / PDF</button>
        <button aria-current={section === 'suppliers' ? 'page' : undefined} onClick={() => setSection('suppliers')}>Proveedores</button>
        {isAdmin && <button aria-current={section === 'categories' ? 'page' : undefined} onClick={() => setSection('categories')}>Categorías</button>}
      </nav>}
      {['purchases', 'consumption', 'events'].includes(section) ? <PartsHistory key={`${section}-${historyMachineId}`} initialMachineId={historyMachineId} kind={section} apiUrl={apiUrl} token={token} isAdmin={isAdmin} /> : section === 'spare-reports' ? <SparePartReports apiUrl={apiUrl} token={token} /> : section === 'machine-elements' ? <MachineElements apiUrl={apiUrl} token={token} isAdmin={isAdmin} /> : section === 'element-types' ? <MachineElementTypes apiUrl={apiUrl} token={token} isAdmin={isAdmin} /> : section === 'machines' ? <Machines apiUrl={apiUrl} token={token} isAdmin={isAdmin} onHistory={(machine) => { setHistoryMachineId(String(machine.machine_id)); setMessage(''); setSection('events') }} /> : section === 'spare-parts' ? <>
        <div className="page-heading"><div><p className="eyebrow">INVENTARIO</p><h1>Repuestos</h1><p>Catalogo, existencias y costos de repuestos.</p></div><button className="primary-action" onClick={() => openSparePartForm()}><Plus size={18} /> Nuevo repuesto</button></div>
        <div className="users-card table-scroll"><table><thead><tr>{isAdmin && <th>Acciones</th>}<th>Codigo</th><th>Categoria</th><th>Descripcion</th><th>Marca / Modelo</th><th>N.° parte</th><th>Unidad</th><th>Stock min. / max.</th><th>Costo unit.</th><th>Ubicacion</th><th>Estado</th><th>Imagen</th></tr></thead>
          <tbody>{spareParts.map((part) => <tr key={part.spare_part_id}>{isAdmin && <td className="row-actions"><button title="Proveedores" onClick={() => openPartSuppliers(part)}><Truck size={16} /></button><button title="Saldo inicial de bodega" aria-label={`Saldo inicial de ${part.internal_code}`} onClick={() => setOpeningBalancePart(part)}><Package size={16} /></button><button title="Duplicar repuesto" aria-label={`Duplicar ${part.internal_code}`} disabled={duplicatingSparePart !== null} onClick={() => duplicateSparePart(part)}><Copy size={16} /></button><button title="Editar" onClick={() => openSparePartForm(part)}><Pencil size={16} /></button><button className="danger" title="Eliminar" onClick={() => deleteSparePart(part)}><Trash2 size={16} /></button></td>}<td><strong>{part.internal_code}</strong>{/--copy(?:-\d+)?$/i.test(part.internal_code) && <span className="status-badge inactive" title="Pendiente de asignar un código interno definitivo">Copia</span>}</td><td>{sparePartCategories.find((category) => category.category_id === part.category_id)?.name || part.category_id}</td><td>{part.description}</td><td>{[part.brand, part.model].filter(Boolean).join(' / ') || '—'}</td><td>{part.part_number || '—'}</td><td>{part.unit_of_measure}</td><td>{part.minimum_stock} / {part.maximum_stock ?? '—'}</td><td>{part.unit_cost != null ? `$${Number(part.unit_cost).toFixed(4)}` : '—'}</td><td>{part.storage_location || '—'}</td><td><span className={`status-badge ${part.active ? 'active' : 'inactive'}`}>{part.active ? 'Activo' : 'Inactivo'}</span></td><td>{part.image_path ? <SparePartImage apiUrl={apiUrl} token={token} sparePartId={part.spare_part_id} fileName={part.internal_code} /> : <span className="no-image">Sin foto</span>}</td></tr>)}</tbody></table>{!loading && !spareParts.length && <p className="empty-state">No hay repuestos registrados.</p>}</div>
      </> : section === 'suppliers' ? <>
        <div className="page-heading"><div><p className="eyebrow">DIRECTORIO</p><h1>Proveedores</h1><p>Datos comerciales y de contacto de proveedores.</p></div><button className="primary-action" onClick={() => openSupplierForm()}><Plus size={18} /> Nuevo proveedor</button></div>
        <div className="users-card table-scroll"><table><thead><tr>{isAdmin && <th>Acciones</th>}<th>Codigo</th><th>Nombre</th><th>RUC</th><th>Contacto</th><th>Telefono</th><th>Correo</th><th>Direccion</th><th>Estado</th></tr></thead><tbody>{suppliers.map((supplier) => <tr key={supplier.supplier_id}>{isAdmin && <td className="row-actions"><button title="Editar" onClick={() => openSupplierForm(supplier)}><Pencil size={16} /></button><button className="danger" title="Eliminar" onClick={() => deleteSupplier(supplier)}><Trash2 size={16} /></button></td>}<td>{supplier.supplier_code || '—'}</td><td><strong>{supplier.name}</strong></td><td>{supplier.ruc || '—'}</td><td>{supplier.contact_name || '—'}</td><td>{supplier.phone || '—'}</td><td>{supplier.email || '—'}</td><td>{supplier.address || '—'}</td><td><span className={`status-badge ${supplier.active ? 'active' : 'inactive'}`}>{supplier.active ? 'Activo' : 'Inactivo'}</span></td></tr>)}</tbody></table>{!loading && !suppliers.length && <p className="empty-state">No hay proveedores registrados.</p>}</div>
      </> : section === 'categories' ? <>
        <div className="page-heading"><div><p className="eyebrow">CONFIGURACION</p><h1>Categorias de repuestos</h1><p>Clasificacion disponible para el inventario de repuestos.</p></div><button className="primary-action" onClick={() => openCategoryForm()}><Plus size={18} /> Nueva categoria</button></div>
        <div className="users-card table-scroll"><table><thead><tr><th>Acciones</th><th>Nombre</th><th>Descripcion</th></tr></thead><tbody>{sparePartCategories.map((category) => <tr key={category.category_id}><td className="row-actions"><button title="Editar" onClick={() => openCategoryForm(category)}><Pencil size={16} /></button><button className="danger" title="Eliminar" onClick={() => deleteCategory(category)}><Trash2 size={16} /></button></td><td><strong>{category.name}</strong></td><td>{category.description || '—'}</td></tr>)}</tbody></table>{!loading && !sparePartCategories.length && <p className="empty-state">No hay categorias registradas.</p>}</div>
      </> : <>
        <div className="page-heading"><div><p className="eyebrow">CONFIGURACION</p><h1>Administrar usuarios</h1><p>Gestion de roles de acceso.</p></div><Users size={28} /></div>
        <div className="users-card table-scroll"><table><thead><tr><th>Nombre</th><th>Correo</th><th>Rol</th><th>Estado</th><th>Creado</th></tr></thead><tbody>{users.map((user) => <tr key={user.id}><td><strong>{user.nombre}</strong></td><td>{user.correo}</td><td><select value={user.rol} onChange={(e) => updateRole(user.id, e.target.value)}><option value="USUARIO">Usuario</option><option value="OPERADOR">Operador</option><option value="ADMIN">Administrador</option></select></td><td>{user.activo ? 'Activo' : 'Inactivo'}</td><td>{new Date(user.creado_en).toLocaleDateString()}</td></tr>)}</tbody></table></div>
      </>}
      <p className="admin-message" role="status">{loading ? 'Cargando...' : message}</p>
    </section>

    {showSparePartForm && <div className="modal-backdrop" role="presentation"><div className="motor-modal" role="dialog" aria-modal="true"><div className="modal-header"><div><p className="eyebrow">REPUESTO</p><h2>{editingSparePart ? 'Editar repuesto' : 'Nuevo repuesto'}</h2></div><button onClick={() => setShowSparePartForm(false)} aria-label="Cerrar"><X /></button></div>
      <form onSubmit={saveSparePart}><div className="motor-form-grid">
        <Field name="internal_code" label="Codigo interno *" value={editingSparePart?.internal_code} maxLength="50" required />
        <label>Categoria *<select name="category_id" defaultValue={editingSparePart?.category_id ?? ''} required><option value="" disabled>Selecciona una categoria</option>{sparePartCategories.map((category) => <option key={category.category_id} value={category.category_id}>{category.name}</option>)}</select></label>
        <Field name="description" label="Descripcion *" value={editingSparePart?.description} maxLength="255" required />
        <Field name="brand" label="Marca" value={editingSparePart?.brand} maxLength="100" />
        <Field name="model" label="Modelo" value={editingSparePart?.model} maxLength="100" />
        <Field name="part_number" label="Numero de parte" value={editingSparePart?.part_number} maxLength="100" />
        <Field name="unit_of_measure" label="Unidad de medida *" value={editingSparePart?.unit_of_measure} maxLength="20" placeholder="Unidad, kg, m..." required />
        <Field name="minimum_stock" label="Stock minimo *" type="number" min="0" step="0.01" value={editingSparePart?.minimum_stock ?? 0} required />
        <Field name="maximum_stock" label="Stock maximo" type="number" min="0" step="0.01" value={editingSparePart?.maximum_stock} />
        <Field name="unit_cost" label="Costo unitario" type="number" min="0" step="0.0001" value={editingSparePart?.unit_cost} />
        <Field name="storage_location" label="Ubicacion de almacenamiento" value={editingSparePart?.storage_location} maxLength="150" />
        <label className="checkbox-field">Estado activo<input name="active" type="checkbox" defaultChecked={editingSparePart?.active ?? true} /></label>
        <label className="full-field">Imagen del repuesto<input name="image" type="file" accept="image/jpeg,image/png,image/webp" onChange={(event) => setSparePartImagePreview(event.target.files[0] ? URL.createObjectURL(event.target.files[0]) : null)} /><span className="field-help">JPG, PNG o WEBP. Maximo 10 MB.</span></label>
        {(sparePartImagePreview || editingSparePart?.image_path) && <div className="full-field nameplate-preview">{sparePartImagePreview ? <img src={sparePartImagePreview} alt="Vista previa del repuesto" /> : <SparePartImage apiUrl={apiUrl} token={token} sparePartId={editingSparePart.spare_part_id} fileName={editingSparePart.internal_code} large />}</div>}
        <label className="full-field">Notas<textarea name="notes" defaultValue={editingSparePart?.notes || ''} rows="3" /></label>
      </div><div className="modal-actions"><button type="button" className="secondary-action" onClick={() => setShowSparePartForm(false)}>Cancelar</button><button className="primary-action" disabled={loading}><Package size={18} /> Guardar repuesto</button></div></form>
    </div></div>}

    {showCategoryForm && <div className="modal-backdrop" role="presentation"><div className="motor-modal category-modal" role="dialog" aria-modal="true"><div className="modal-header"><div><p className="eyebrow">CATEGORIA</p><h2>{editingCategory ? 'Editar categoria' : 'Nueva categoria'}</h2></div><button onClick={() => setShowCategoryForm(false)} aria-label="Cerrar"><X /></button></div>
      <form onSubmit={saveCategory}><div className="motor-form-grid category-form-grid">
        <Field name="name" label="Nombre *" value={editingCategory?.name} maxLength="100" required />
        <label className="full-field">Descripcion<textarea name="description" defaultValue={editingCategory?.description || ''} maxLength="255" rows="3" /></label>
      </div><div className="modal-actions"><button type="button" className="secondary-action" onClick={() => setShowCategoryForm(false)}>Cancelar</button><button className="primary-action" disabled={loading}>Guardar categoria</button></div></form>
    </div></div>}

    {showSupplierForm && <div className="modal-backdrop" role="presentation"><div className="motor-modal" role="dialog" aria-modal="true"><div className="modal-header"><div><p className="eyebrow">PROVEEDOR</p><h2>{editingSupplier ? 'Editar proveedor' : 'Nuevo proveedor'}</h2></div><button onClick={() => setShowSupplierForm(false)} aria-label="Cerrar"><X /></button></div>
      <form onSubmit={saveSupplier}><div className="motor-form-grid">
        <Field name="supplier_code" label="Codigo del proveedor" value={editingSupplier?.supplier_code} maxLength="50" />
        <Field name="name" label="Nombre *" value={editingSupplier?.name} maxLength="200" required />
        <Field name="ruc" label="RUC" value={editingSupplier?.ruc} maxLength="20" />
        <Field name="contact_name" label="Nombre de contacto" value={editingSupplier?.contact_name} maxLength="150" />
        <Field name="phone" label="Telefono" type="tel" value={editingSupplier?.phone} maxLength="50" />
        <Field name="email" label="Correo electronico" type="email" value={editingSupplier?.email} maxLength="150" />
        <Field name="address" label="Direccion" value={editingSupplier?.address} maxLength="300" />
        <label className="checkbox-field">Estado activo<input name="active" type="checkbox" defaultChecked={editingSupplier?.active ?? true} /></label>
        <label className="full-field">Notas<textarea name="notes" defaultValue={editingSupplier?.notes || ''} maxLength="500" rows="3" /></label>
      </div><div className="modal-actions"><button type="button" className="secondary-action" onClick={() => setShowSupplierForm(false)}>Cancelar</button><button className="primary-action" disabled={loading}><Truck size={18} /> Guardar proveedor</button></div></form>
    </div></div>}

    {supplierPart && <div className="modal-backdrop" role="presentation"><div className="motor-modal" role="dialog" aria-modal="true"><div className="modal-header"><div><p className="eyebrow">PROVEEDORES DEL REPUESTO</p><h2>{supplierPart.internal_code} · {supplierPart.description}</h2></div><button onClick={() => setSupplierPart(null)} aria-label="Cerrar"><X /></button></div>
      <div className="users-card table-scroll"><table><thead><tr><th>Acciones</th><th>Proveedor</th><th>N.° parte proveedor</th><th>Precio actual</th><th>Entrega</th><th>Preferido</th></tr></thead><tbody>{partSuppliers.map((relation) => <tr key={relation.spare_part_supplier_id}><td className="row-actions"><button title="Editar relacion" onClick={() => setEditingPartSupplier(relation)}><Pencil size={16} /></button><button className="danger" title="Quitar proveedor" onClick={() => removePartSupplier(relation)}><Trash2 size={16} /></button></td><td><strong>{relation.supplier_name}</strong></td><td>{relation.supplier_part_number || '—'}</td><td>{relation.current_price != null ? `$${Number(relation.current_price).toFixed(4)}` : '—'}</td><td>{relation.lead_time_days != null ? `${relation.lead_time_days} dias` : '—'}</td><td>{relation.preferred_supplier ? <span className="status-badge active">Si</span> : 'No'}</td></tr>)}</tbody></table>{!partSuppliers.length && <p className="empty-state">Este repuesto aun no tiene proveedores asociados.</p>}</div>
      <form key={editingPartSupplier?.spare_part_supplier_id || 'new'} className="relation-form" onSubmit={savePartSupplier}><h3>{editingPartSupplier ? 'Editar relacion' : 'Añadir proveedor'}</h3><div className="motor-form-grid">
        <label>Proveedor *<select name="supplier_id" defaultValue={editingPartSupplier?.supplier_id ?? ''} required><option value="" disabled>Selecciona un proveedor</option>{suppliers.filter((supplier) => supplier.active || supplier.supplier_id === editingPartSupplier?.supplier_id).map((supplier) => <option key={supplier.supplier_id} value={supplier.supplier_id}>{supplier.name}{supplier.supplier_code ? ` · ${supplier.supplier_code}` : ''}</option>)}</select></label>
        <Field name="supplier_part_number" label="Numero de parte del proveedor" value={editingPartSupplier?.supplier_part_number} maxLength="100" />
        <Field name="current_price" label="Precio actual" type="number" min="0" step="0.0001" value={editingPartSupplier?.current_price} />
        <Field name="lead_time_days" label="Tiempo de entrega (dias)" type="number" min="0" step="1" value={editingPartSupplier?.lead_time_days} />
        <label className="checkbox-field">Proveedor preferido<input name="preferred_supplier" type="checkbox" defaultChecked={editingPartSupplier?.preferred_supplier ?? false} /></label>
        <label className="full-field">Notas<textarea name="notes" defaultValue={editingPartSupplier?.notes || ''} maxLength="500" rows="2" /></label>
      </div><div className="modal-actions">{editingPartSupplier && <button type="button" className="secondary-action" onClick={() => setEditingPartSupplier(null)}>Cancelar edicion</button>}<button className="primary-action" disabled={loading}>{editingPartSupplier ? 'Actualizar relacion' : 'Añadir proveedor'}</button></div></form>
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

function SparePartImage({ apiUrl, token, sparePartId, fileName, large = false }) {
  const [src, setSrc] = useState(null)
  const [mimeType, setMimeType] = useState('image/jpeg')
  useEffect(() => {
    let objectUrl
    fetch(`${apiUrl}/repuestos/${sparePartId}/imagen`, { headers: { Authorization: `Bearer ${token}` } })
      .then((response) => { if (!response.ok) throw new Error(); return response.blob() })
      .then((blob) => { objectUrl = URL.createObjectURL(blob); setMimeType(blob.type); setSrc(objectUrl) })
      .catch(() => setSrc(null))
    return () => { if (objectUrl) URL.revokeObjectURL(objectUrl) }
  }, [apiUrl, token, sparePartId])

  function downloadImage() {
    if (!window.confirm(`¿Quieres descargar la imagen del repuesto ${fileName}?`)) return
    const extension = { 'image/png': 'png', 'image/webp': 'webp', 'image/jpeg': 'jpg' }[mimeType] || 'jpg'
    const link = document.createElement('a')
    link.href = src
    link.download = `${fileName}.${extension}`
    document.body.appendChild(link)
    link.click()
    link.remove()
  }

  return src ? <button className="nameplate-download" type="button" onClick={downloadImage} title="Haz clic para descargar la imagen"><img className={large ? 'nameplate-large' : 'nameplate-thumb'} src={src} alt={`Repuesto ${fileName}`} /></button> : <span className="no-image">Cargando...</span>
}
