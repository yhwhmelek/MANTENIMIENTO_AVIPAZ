import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'

const paths = { purchases: '/compras-repuestos', consumption: '/consumos-repuestos', events: '/intervenciones' }
const titles = { purchases: 'Compras de repuestos', consumption: 'Consumos en mantenimiento', events: 'Intervenciones realizadas' }
const today = () => { const now = new Date(); return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}` }
function Input({ name, label, form, setForm, ...props }) {
  return <label>{label}<input {...props} value={form[name] ?? ''} onChange={event => setForm(current => ({ ...current, [name]: event.target.value }))} /></label>
}
function Select({ name, label, form, setForm, options, required = true }) {
  return <label>{label}<select required={required} value={form[name] ?? ''} onChange={event => setForm(current => ({ ...current, [name]: event.target.value, ...(name === 'machine_id' ? { element_id: '' } : {}) }))}><option value="">{required ? 'Selecciona' : 'General de la máquina'}</option>{options.map(([id, text]) => <option key={id} value={id}>{text}</option>)}</select></label>
}
function HistoryTable({ rows, kind, onVoid }) {
  return <table><thead><tr><th>Fecha</th>{kind === 'events' ? <><th>Equipo</th><th>Tipo</th><th>Descripción</th></> : <><th>Repuesto</th><th>{kind === 'purchases' ? 'Proveedor / Documento' : 'Intervención / Equipo'}</th><th>Cantidad</th><th>{kind === 'purchases' ? 'Costo unitario / Total' : 'Posición / Horas del retirado'}</th><th>Notas / Estado</th>{onVoid && <th>Acciones</th>}</>}</tr></thead>
    <tbody>{rows.map(row => <tr key={row.id ?? row.maintenance_event_id}><td>{row.occurred_on || row.performed_on}</td>{kind === 'events' ? <><td>{row.machine_code} / {row.element_code || 'General'}</td><td>{row.maintenance_type}</td><td>#{row.maintenance_event_id} · {row.description}</td></> : <><td>{row.internal_code}<br />{row.description}</td><td>{kind === 'purchases' ? <>{row.supplier_name}<br />{row.document_number}</> : <>#{row.maintenance_event_id} · {row.machine_code}<br />{row.element_code || 'General'} · {row.maintenance_type}</>}</td><td>{row.quantity} {row.unit_of_measure}</td><td>{kind === 'purchases' ? <>{row.unit_cost} {row.currency}<br />Total: {row.total} {row.currency}</> : <>{row.position || '—'}<br />{row.life_hours == null ? 'Sin medición' : `${row.life_hours} h`}</>}</td><td>{row.notes || '—'}<br />{row.voided_at ? `Anulado: ${row.void_reason}` : 'Vigente'}</td>{onVoid && <td>{!row.voided_at && <button className="secondary-action" onClick={() => onVoid(row)}>Anular</button>}</td>}</>}</tr>)}</tbody></table>
}

export default function PartsHistory({ apiUrl, token, isAdmin, kind, initialMachineId = '' }) {
  const [catalog, setCatalog] = useState({ parts: [], suppliers: [], machines: [], elements: [], events: [] })
  const [rows, setRows] = useState([])
  const [filters, setFilters] = useState({ spare_part_id: '', machine_id: String(initialMachineId), start: '', end: '', include_voided: false })
  const [form, setForm] = useState(null)
  const [voidRow, setVoidRow] = useState(null)
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)
  const [loading, setLoading] = useState(true)
  const [catalogLoading, setCatalogLoading] = useState(true)
  const [error, setError] = useState('')
  const [catalogError, setCatalogError] = useState('')
  const [formError, setFormError] = useState('')
  const [message, setMessage] = useState('')
  const [refresh, setRefresh] = useState(0)
  const [loadedAt, setLoadedAt] = useState('')
  async function request(path, options = {}) {
    const response = await fetch(`${apiUrl}${path}`, { ...options, headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' } })
    const data = await response.json().catch(() => ({}))
    if (!response.ok) throw new Error(typeof data.detail === 'string' ? data.detail : 'Revisa los campos, las cantidades y las lecturas ingresadas.')
    return data
  }
  useEffect(() => {
    document.body.classList.add('spare-report-open')
    return () => document.body.classList.remove('spare-report-open')
  }, [])
  useEffect(() => {
    const controller = new AbortController()
    setCatalogLoading(true); setCatalogError('')
    Promise.all(['/repuestos', '/proveedores', '/maquinas', '/elementos-maquinas', '/intervenciones'].map(path => request(path, { signal: controller.signal })))
      .then(([parts, suppliers, machines, elements, events]) => setCatalog({ parts, suppliers, machines, elements, events }))
      .catch(err => { if (err.name !== 'AbortError') setCatalogError(err.message) })
      .finally(() => { if (!controller.signal.aborted) setCatalogLoading(false) })
    return () => controller.abort()
  }, [apiUrl, token, refresh])
  useEffect(() => {
    const controller = new AbortController()
    setLoading(true); setError(''); setRows([])
    if (filters.start && filters.end && filters.start > filters.end) {
      setError('La fecha inicial debe ser anterior o igual a la final.'); setLoading(false); return () => controller.abort()
    }
    const params = new URLSearchParams()
    Object.entries(filters).forEach(([key, value]) => {
      if (value !== '' && (key !== 'machine_id' || kind !== 'purchases') && (kind !== 'events' || !['spare_part_id', 'include_voided'].includes(key))) params.set(key, String(value))
    })
    request(`${paths[kind]}?${params}`, { signal: controller.signal })
      .then(data => { setRows(data); setLoadedAt(new Date().toLocaleString('es-EC')) })
      .catch(err => { if (err.name !== 'AbortError') setError(err.message) })
      .finally(() => { if (!controller.signal.aborted) setLoading(false) })
    return () => controller.abort()
  }, [apiUrl, token, kind, filters, refresh])
  function filter(name, value) { setRows([]); setLoading(true); setFilters(current => ({ ...current, [name]: value })) }
  function open() {
    setFormError(''); setMessage('')
    setForm(kind === 'events' ? { machine_id: filters.machine_id, performed_on: today(), maintenance_type: 'CORRECTIVO' } : kind === 'purchases' ? { purchased_on: today(), quantity: '1', currency: 'USD' } : { quantity: '1' })
  }
  async function save(event) {
    event.preventDefault()
    if (busy) return
    setBusy(true); setFormError('')
    const payload = { ...form }
    for (const key of ['machine_id', 'element_id', 'spare_part_id', 'supplier_id', 'maintenance_event_id']) {
      if (key in payload) payload[key] = payload[key] === '' ? null : Number(payload[key])
    }
    for (const key of ['removed_installed_hour_meter', 'removed_hour_meter']) if (payload[key] === '') payload[key] = null
    try {
      await request(paths[kind], { method: 'POST', body: JSON.stringify(payload) })
      setForm(null); setMessage('Registro guardado correctamente.'); setRefresh(value => value + 1)
    } catch (err) { setFormError(err.message) } finally { setBusy(false) }
  }
  async function annul(event) {
    event.preventDefault()
    if (busy) return
    setBusy(true); setFormError('')
    try {
      await request(`${paths[kind]}/${voidRow.id}/anular`, { method: 'POST', body: JSON.stringify({ reason }) })
      setVoidRow(null); setMessage('Registro anulado. Se conserva en el historial.'); setRefresh(value => value + 1)
    } catch (err) { setFormError(err.message) } finally { setBusy(false) }
  }
  const activeRows = rows.filter(row => !row.voided_at)
  const totals = new Map()
  activeRows.forEach(row => { if (row.quantity != null) totals.set(row.unit_of_measure, (totals.get(row.unit_of_measure) || 0) + Number(row.quantity)) })
  const measurements = activeRows.filter(row => row.life_hours != null)
  const summary = kind === 'events' ? `${rows.length} intervenciones` : `${activeRows.length} registros vigentes · Cantidades: ${[...totals].map(([unit, quantity]) => `${quantity.toLocaleString('es-EC', { maximumFractionDigits: 2 })} ${unit}`).join(' / ') || '0'}`
  const latest = kind === 'purchases' && filters.spare_part_id && activeRows[0]
  const avg = kind === 'consumption' && filters.spare_part_id && measurements.length ? measurements.reduce((sum, row) => sum + Number(row.life_hours), 0) / measurements.length : null
  const partLabel = catalog.parts.find(part => String(part.spare_part_id) === filters.spare_part_id)?.internal_code || 'Todos los repuestos'
  const machineLabel = catalog.machines.find(machine => String(machine.machine_id) === filters.machine_id)?.asset_code || 'Todas las máquinas'
  const filterLabel = kind === 'events' ? `${machineLabel} / ${filters.start || 'Inicio'} - ${filters.end || 'Fin'}` : `${partLabel} · ${kind === 'consumption' ? machineLabel + ' · ' : ''}${filters.start || 'Sin fecha inicial'} — ${filters.end || 'Sin fecha final'} · ${filters.include_voided ? 'Incluye anulados' : 'Solo vigentes'}`
  const details = <><p>{summary}</p>{latest && <p>Última compra vigente dentro del período: {latest.unit_cost} {latest.currency} por {latest.unit_of_measure} · {latest.supplier_name} · {latest.occurred_on}.</p>}{avg != null && <p>Duración media registrada del repuesto retirado: {avg.toFixed(2)} h ({measurements.length} mediciones). No equivale al MTBF.</p>}</>
  const input = (name, label, props = {}) => <Input name={name} label={label} form={form} setForm={setForm} {...props} />
  const select = (name, label, options, required = true) => <Select name={name} label={label} form={form} setForm={setForm} options={options} required={required} />
  return <>
    <div className="page-heading"><div><p className="eyebrow">HISTORIAL</p><h1>{titles[kind]}</h1><p>{kind === 'events' ? 'Registra el trabajo realizado antes de añadir los repuestos utilizados.' : 'Hechos reales separados de las asignaciones técnicas. No actualizan existencias de bodega.'}</p></div><div>{isAdmin && <button className="primary-action" disabled={catalogLoading || Boolean(catalogError)} onClick={open}>Nuevo registro</button>} <button className="secondary-action" disabled={loading || Boolean(error) || Boolean(form) || Boolean(voidRow)} onClick={() => window.print()}>Imprimir / Guardar PDF</button></div></div>
    {kind === 'events' && <div className="motor-form-grid report-filters"><label>Maquina<select value={filters.machine_id} onChange={event => filter('machine_id', event.target.value)}><option value="">Todas</option>{catalog.machines.map(machine => <option key={machine.machine_id} value={machine.machine_id}>{machine.asset_code} / {machine.name}</option>)}</select></label><label>Desde<input type="date" value={filters.start} onChange={event => filter('start', event.target.value)} /></label><label>Hasta<input type="date" value={filters.end} onChange={event => filter('end', event.target.value)} /></label></div>}
    {kind !== 'events' && <div className="motor-form-grid report-filters"><label>Repuesto<select value={filters.spare_part_id} onChange={event => filter('spare_part_id', event.target.value)}><option value="">Todos</option>{catalog.parts.map(part => <option key={part.spare_part_id} value={part.spare_part_id}>{part.internal_code} · {part.description}</option>)}</select></label>{kind === 'consumption' && <label>Máquina<select value={filters.machine_id} onChange={event => filter('machine_id', event.target.value)}><option value="">Todas</option>{catalog.machines.map(machine => <option key={machine.machine_id} value={machine.machine_id}>{machine.asset_code} · {machine.name}</option>)}</select></label>}<label>Desde<input type="date" value={filters.start} onChange={event => filter('start', event.target.value)} /></label><label>Hasta<input type="date" value={filters.end} onChange={event => filter('end', event.target.value)} /></label><label className="checkbox-field"><input type="checkbox" checked={filters.include_voided} onChange={event => filter('include_voided', event.target.checked)} /> Incluir anulados</label></div>}
    {(error || catalogError) && <p role="alert">{error || catalogError} <button onClick={() => setRefresh(value => value + 1)}>Reintentar</button></p>}
    {loading ? <p role="status">Cargando historial...</p> : !error && <>{details}<div className="users-card table-scroll"><HistoryTable rows={rows} kind={kind} onVoid={isAdmin && kind !== 'events' && !busy ? row => { setVoidRow(row); setReason(''); setFormError('') } : null} />{!rows.length && <p className="empty-state">No hay registros para esta consulta.</p>}</div></>}
    {message && <p role="status">{message}</p>}
    {form && <div className="modal-backdrop"><div className="motor-modal" role="dialog" aria-modal="true" aria-labelledby="history-form-title"><h2 id="history-form-title">Nuevo registro · {titles[kind]}</h2><form onSubmit={save}><fieldset disabled={busy} className="spare-assignment-fields"><div className="motor-form-grid">
      {kind === 'events' ? <>
        {select('machine_id', 'Máquina *', catalog.machines.map(item => [item.machine_id, `${item.asset_code} · ${item.name}`]))}
        {select('element_id', 'Elemento', catalog.elements.filter(item => item.machine_id === Number(form.machine_id)).map(item => [item.element_id, `${item.element_code || ''} · ${item.name}`]), false)}
        {input('performed_on', 'Fecha de realización *', { type: 'date', required: true })}
        {select('maintenance_type', 'Tipo *', [['PREVENTIVO', 'Preventivo'], ['CORRECTIVO', 'Correctivo']])}
        {input('description', 'Trabajo realizado *', { required: true, maxLength: 500 })}
      </> : <>
        {select('spare_part_id', 'Repuesto *', catalog.parts.filter(item => item.active).map(item => [item.spare_part_id, `${item.internal_code} · ${item.description} (${item.unit_of_measure})`]))}
        {input('quantity', 'Cantidad real *', { type: 'number', min: '0.01', max: '99999999.99', step: '0.01', required: true })}
        {kind === 'purchases' ? <>
          {select('supplier_id', 'Proveedor *', catalog.suppliers.filter(item => item.active).map(item => [item.supplier_id, item.name]))}
          {input('purchased_on', 'Fecha de compra *', { type: 'date', required: true })}
          {input('unit_cost', 'Costo unitario sin impuestos *', { type: 'number', min: '0', max: '99999999999999.9999', step: '0.0001', required: true })}
          {input('currency', 'Moneda (USD, EUR…) *', { required: true, pattern: '[A-Z]{3}', maxLength: 3 })}
          {input('document_number', 'Factura / Documento *', { required: true, maxLength: 100 })}
        </> : <>
          {select('maintenance_event_id', 'Intervención realizada *', catalog.events.map(item => [item.maintenance_event_id, `#${item.maintenance_event_id} · ${item.performed_on} · ${item.machine_code} / ${item.element_code || 'General'} · ${item.description}`]))}
          {!catalog.events.length && <p>Crea primero una intervención en Activos / Intervenciones.</p>}
          {input('position', 'Posición', { maxLength: 150 })}
          <p className="full-field field-help">Opcional: si reemplazaste una unidad del mismo repuesto, registra el horómetro de su instalación anterior y el de su retiro. Deben ser lecturas del mismo contador, sin reinicios. Para varias unidades, registra cada reemplazo por separado.</p>
          {input('removed_installed_hour_meter', 'Horómetro al instalar el retirado', { type: 'number', min: '0', max: '9999999999.99', step: '0.01' })}
          {input('removed_hour_meter', 'Horómetro al retirar', { type: 'number', min: '0', max: '9999999999.99', step: '0.01' })}
        </>}
        {input('notes', 'Notas', { maxLength: 500 })}
      </>}
    </div></fieldset><p className="field-help">Comprueba los datos. Las compras y consumos se corrigen anulando el registro y creando uno nuevo.</p>{formError && <p role="alert">{formError}</p>}<div className="modal-actions"><button type="button" className="secondary-action" disabled={busy} onClick={() => setForm(null)}>Cancelar</button><button className="primary-action" disabled={busy}>{busy ? 'Guardando...' : 'Guardar'}</button></div></form></div></div>}
    {voidRow && <div className="modal-backdrop"><div className="motor-modal" role="dialog" aria-modal="true" aria-labelledby="void-title"><h2 id="void-title">Anular {voidRow.internal_code} · registro #{voidRow.id}</h2><form onSubmit={annul}><label>Motivo *<input required maxLength={500} value={reason} disabled={busy} onChange={event => setReason(event.target.value)} /></label>{formError && <p role="alert">{formError}</p>}<div className="modal-actions"><button type="button" disabled={busy} onClick={() => setVoidRow(null)}>Cancelar</button><button disabled={busy}>Confirmar anulación</button></div></form></div></div>}
    {createPortal(<div className="spare-report-print"><h1>AVIPAZ · {titles[kind]}</h1><p>{filterLabel}</p><p>Consultado: {loadedAt}</p>{!loading && !error ? <>{details}<HistoryTable rows={rows} kind={kind} />{!rows.length && <p>No hay registros.</p>}</> : <p>Consulta no disponible.</p>}</div>, document.body)}
  </>
}
