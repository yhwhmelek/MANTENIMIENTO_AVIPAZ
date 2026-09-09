import { useEffect, useState } from 'react'
import { X } from 'lucide-react'

const numericFields = [
  ['reduction_ratio', 'Relación de reducción', '0.0001', '-99999999.9999', '99999999.9999'],
  ['input_rpm', 'RPM de entrada', '1', '-2147483648', '2147483647'],
  ['output_rpm', 'RPM de salida', '1', '-2147483648', '2147483647'],
  ['rated_torque_nm', 'Torque nominal (Nm)', '0.01', '-9999999999999999.99', '9999999999999999.99'],
  ['service_factor', 'Factor de servicio', '0.01', '-999999.99', '999999.99'],
  ['oil_quantity_l', 'Cantidad de aceite (L)', '0.01', '-99999999.99', '99999999.99'],
]
const textFields = [
  ['oil_type', 'Tipo de aceite', 150], ['oil_viscosity_iso', 'Viscosidad ISO', 50],
  ['mounting_position', 'Posición de montaje', 50], ['input_bearing', 'Rodamiento de entrada', 100],
  ['output_bearing', 'Rodamiento de salida', 100],
]

export default function GearReducerSpecifications({ apiUrl, token, element, isAdmin, onClose }) {
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [loadFailed, setLoadFailed] = useState(false)
  const [message, setMessage] = useState('')
  const [version, setVersion] = useState(0)
  const endpoint = `${apiUrl}/elementos-maquinas/${element.element_id}/especificaciones-reductor`

  useEffect(() => {
    const controller = new AbortController()
    fetch(endpoint, { headers: { Authorization: `Bearer ${token}` }, signal: controller.signal })
      .then(async (response) => {
        const result = await response.json()
        if (!response.ok) throw new Error(typeof result.detail === 'string' ? result.detail : 'No se pudo cargar la data.')
        setData(result)
      })
      .catch((error) => { if (error.name !== 'AbortError') { setError(error.message); setLoadFailed(true) } })
      .finally(() => { if (!controller.signal.aborted) setLoading(false) })
    return () => controller.abort()
  }, [endpoint, token])

  async function save(event) {
    event.preventDefault()
    if (!isAdmin || busy) return
    const form = new FormData(event.currentTarget)
    const payload = Object.fromEntries([...form.entries()].map(([key, value]) => [key, value.trim() || null]))
    setBusy(true); setError(''); setMessage('')
    try {
      const response = await fetch(endpoint, { method: 'PUT', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify(payload) })
      const result = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(typeof result.detail === 'string' ? result.detail : 'Revisa los valores y la precisión de los campos numéricos.')
      setData(result); setVersion((value) => value + 1); setMessage('Data guardada correctamente.')
    } catch (error) { setError(error.message) } finally { setBusy(false) }
  }

  async function remove() {
    if (!isAdmin || busy || !window.confirm(`¿Eliminar la data de ${element.name}? El elemento de máquina se conservará.`)) return
    setBusy(true); setError(''); setMessage('')
    try {
      const response = await fetch(endpoint, { method: 'DELETE', headers: { Authorization: `Bearer ${token}` } })
      if (!response.ok) { const result = await response.json().catch(() => ({})); throw new Error(typeof result.detail === 'string' ? result.detail : 'No se pudo eliminar la data.') }
      setData(null); setVersion((value) => value + 1); setMessage('Data eliminada correctamente.')
    } catch (error) { setError(error.message) } finally { setBusy(false) }
  }

  return <div className="modal-backdrop"><div className="motor-modal" role="dialog" aria-modal="true" aria-labelledby="reducer-spec-title">
    <div className="modal-header"><div><p className="eyebrow">{element.element_code || 'ELEMENTO'} · {element.name}</p><h2 id="reducer-spec-title">Data de reductor</h2></div><button aria-label="Cerrar" disabled={busy} onClick={onClose}><X /></button></div>
    {loading ? <p role="status">Cargando data...</p> : !loadFailed && <>
      {!data && <p>Este elemento todavía no tiene data de reductor.</p>}
      {(isAdmin || data) && <form key={version} onSubmit={save}><div className="motor-form-grid">
        {numericFields.map(([name, label, step, min, max]) => <label key={name}>{label}<input name={name} type="number" step={step} min={min} max={max} defaultValue={data?.[name] ?? ''} readOnly={!isAdmin || busy} /></label>)}
        {textFields.map(([name, label, maxLength]) => <label key={name}>{label}<input name={name} maxLength={maxLength} defaultValue={data?.[name] ?? ''} readOnly={!isAdmin || busy} /></label>)}
        <label className="full-field">Notas<textarea name="notes" maxLength={500} rows={3} defaultValue={data?.notes ?? ''} readOnly={!isAdmin || busy} /></label>
      </div>{isAdmin && <div className="modal-actions">{data && <button type="button" className="secondary-action" disabled={busy} onClick={remove}>Eliminar data</button>}<button className="primary-action" disabled={busy}>{busy ? 'Procesando...' : 'Guardar data'}</button></div>}</form>}
    </>}
    {error && <p className="admin-message" role="alert">{error}</p>}{message && <p className="admin-message" role="status">{message}</p>}
  </div></div>
}
