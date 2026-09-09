import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'

const modes = {
  machine_id: 'Repuestos de una máquina',
  element_id: 'Repuestos de un elemento',
  spare_part_id: 'Máquinas que usan un repuesto',
}

function ResultsTable({ rows }) {
  return <table><thead><tr><th>Máquina</th><th>Elemento</th><th>Categoría</th><th>Repuesto</th><th>Marca / N.º parte</th><th>Posición</th><th>Cantidad</th><th>Crítico</th></tr></thead>
    <tbody>{rows.map(row => <tr key={row.machine_spare_part_id}>
      <td><strong>{row.machine_code}</strong><br />{row.machine_name}</td>
      <td>{row.element_id == null ? 'General de la máquina' : <><strong>{row.element_code}</strong><br />{row.element_name}</>}</td>
      <td>{row.category_name || '—'}</td><td><strong>{row.internal_code}</strong><br />{row.description}</td>
      <td>{row.brand || '—'}<br />{row.part_number || '—'}</td><td>{row.position || '—'}</td>
      <td>{Number(row.quantity_required).toLocaleString('es-EC', { maximumFractionDigits: 2 })} {row.unit_of_measure}</td><td>{row.is_critical ? 'Sí' : 'No'}</td>
    </tr>)}</tbody></table>
}

export default function SparePartReports({ apiUrl, token }) {
  const [catalogs, setCatalogs] = useState({ machine_id: [], element_id: [], spare_part_id: [] })
  const [mode, setMode] = useState('machine_id')
  const [selected, setSelected] = useState('')
  const [search, setSearch] = useState('')
  const [critical, setCritical] = useState(false)
  const [loadingCatalogs, setLoadingCatalogs] = useState(true)
  const [loading, setLoading] = useState(false)
  const [catalogError, setCatalogError] = useState('')
  const [error, setError] = useState('')
  const [report, setReport] = useState(null)
  const [retry, setRetry] = useState(0)

  async function get(path, signal) {
    const response = await fetch(`${apiUrl}${path}`, { signal, headers: { Authorization: `Bearer ${token}` } })
    const data = await response.json().catch(() => ({}))
    if (!response.ok) throw new Error(typeof data.detail === 'string' ? data.detail : 'No se pudo cargar la consulta.')
    return data
  }

  useEffect(() => {
    document.body.classList.add('spare-report-open')
    return () => document.body.classList.remove('spare-report-open')
  }, [])

  useEffect(() => {
    const controller = new AbortController()
    setLoadingCatalogs(true); setCatalogError('')
    Promise.all(['/maquinas', '/elementos-maquinas', '/repuestos'].map(path => get(path, controller.signal)))
      .then(([machines, elements, parts]) => {
        const machineNames = new Map(machines.map(item => [item.machine_id, item.asset_code]))
        setCatalogs({
          machine_id: machines.map(item => ({ id: item.machine_id, label: `${item.asset_code} · ${item.name}` })),
          element_id: elements.map(item => ({ id: item.element_id, label: `${machineNames.get(item.machine_id) || ''} / ${item.element_code || ''} · ${item.name}` })),
          spare_part_id: parts.map(item => ({ id: item.spare_part_id, label: `${item.internal_code} · ${item.description}` })),
        })
      })
      .catch(err => { if (err.name !== 'AbortError') setCatalogError(err.message) })
      .finally(() => { if (!controller.signal.aborted) setLoadingCatalogs(false) })
    return () => controller.abort()
  }, [apiUrl, token, retry])

  useEffect(() => {
    setReport(null); setError('')
    if (!selected) { setLoading(false); return }
    const controller = new AbortController()
    setLoading(true)
    const params = new URLSearchParams({ [mode]: selected, critical_only: String(critical) })
    get(`/reportes/repuestos?${params}`, controller.signal)
      .then(rows => setReport({ rows, title: modes[mode], selection: catalogs[mode].find(item => String(item.id) === selected)?.label || selected, critical, date: new Date().toLocaleString('es-EC') }))
      .catch(err => { if (err.name !== 'AbortError') setError(err.message) })
      .finally(() => { if (!controller.signal.aborted) setLoading(false) })
    return () => controller.abort()
  }, [apiUrl, token, mode, selected, critical, catalogs, retry])

  function reset(action) { setReport(null); setError(''); action() }
  const options = catalogs[mode].filter(item => String(item.id) === selected || item.label.toLocaleLowerCase().includes(search.toLocaleLowerCase()))
  const summary = report && `${report.rows.length} asignaciones · ${new Set(report.rows.map(row => row.machine_id)).size} máquinas · ${new Set(report.rows.map(row => row.spare_part_id)).size} repuestos distintos`

  return <>
    <div className="page-heading"><div><p className="eyebrow">CONSULTAS</p><h1>Aplicación de repuestos</h1><p>Consulta los repuestos por equipo o identifica dónde se utiliza un repuesto.</p></div><button className="primary-action" disabled={!report || loading || loadingCatalogs || Boolean(catalogError)} onClick={() => window.print()}>Imprimir / Guardar PDF</button></div>
    <div className="motor-form-grid report-filters">
      <label>Tipo de consulta<select value={mode} onChange={event => reset(() => { setMode(event.target.value); setSelected(''); setSearch('') })}>{Object.entries(modes).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
      <label>Buscar por código o nombre<input type="search" value={search} onChange={event => setSearch(event.target.value)} placeholder="Escribe para filtrar el selector" /></label>
      <label>Seleccionar<select value={selected} disabled={loadingCatalogs || Boolean(catalogError)} onChange={event => reset(() => setSelected(event.target.value))}><option value="">Selecciona una opción</option>{options.map(item => <option key={item.id} value={item.id}>{item.label}</option>)}</select></label>
      <label className="checkbox-field"><input type="checkbox" checked={critical} onChange={event => reset(() => setCritical(event.target.checked))} /> Solo repuestos críticos</label>
    </div>
    <p className="field-help">Se muestran asignaciones activas. Para generar el archivo, pulsa Imprimir / Guardar PDF y elige «Guardar como PDF» en el destino de impresión.</p>
    {(catalogError || error) && <p role="alert" className="admin-message">{catalogError || error} <button className="secondary-action" onClick={() => setRetry(value => value + 1)}>Reintentar</button></p>}
    {(loadingCatalogs || loading) && <p role="status">Cargando consulta...</p>}
    {!loadingCatalogs && !loading && !selected && !catalogError && <p className="empty-state">Selecciona una máquina, un elemento o un repuesto para consultar.</p>}
    {report && <><h2>{report.title}</h2><p>{report.selection}</p><p>{summary}</p><div className="users-card table-scroll"><ResultsTable rows={report.rows} />{!report.rows.length && <p className="empty-state">No hay asignaciones activas para los filtros seleccionados.</p>}</div></>}
    {createPortal(<div className="spare-report-print"><h1>AVIPAZ · Aplicación de repuestos</h1>{report ? <><h2>{report.title}</h2><p>{report.selection}</p><p>Consulta: {report.date} · {report.critical ? 'Solo críticos' : 'Todos los niveles de criticidad'} · Asignaciones activas</p><p>{summary}</p><ResultsTable rows={report.rows} />{!report.rows.length && <p>No hay asignaciones activas para los filtros seleccionados.</p>}<p>Las cantidades representan requerimientos por asignación, no existencias en bodega.</p></> : <p>No hay una consulta disponible para imprimir.</p>}</div>, document.body)}
  </>
}
