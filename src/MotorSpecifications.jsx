import { useEffect, useState } from 'react'
import { X } from 'lucide-react'

const numericFields = [
  ['power_kw', 'Potencia (kW)', 2, 99999999.99], ['power_hp', 'Potencia (HP)', 2, 99999999.99],
  ['rated_voltage', 'Voltaje nominal (V)', 2, 99999999.99], ['rated_current', 'Corriente nominal (A)', 2, 99999999.99],
  ['frequency_hz', 'Frecuencia (Hz)', 2, 99999999.99], ['rpm', 'RPM', 0, 2147483647], ['poles', 'Polos', 0, 2147483647],
  ['power_factor', 'Factor de potencia', 3, 99.999], ['efficiency_percent', 'Eficiencia (%)', 2, 999.99], ['service_factor', 'Factor de servicio', 2, 999.99],
]
const textFields = [
  ['frame', 'Frame / Carcasa', 50], ['protection_class', 'Clase de protección', 30], ['insulation_class', 'Clase de aislamiento', 30],
  ['connection_type', 'Tipo de conexión', 30], ['duty_type', 'Tipo de servicio', 30], ['bearing_de', 'Rodamiento lado de accionamiento (DE)', 100],
  ['bearing_nde', 'Rodamiento lado opuesto (NDE)', 100], ['lubricant', 'Lubricante', 150],
]

export default function MotorSpecifications({ apiUrl, token, element, isAdmin, onClose }) {
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [loadFailed, setLoadFailed] = useState(false)
  const [message, setMessage] = useState('')
  const [photo, setPhoto] = useState(null)
  const [preview, setPreview] = useState(null)
  const [storedImage, setStoredImage] = useState(null)
  const [version, setVersion] = useState(0)
  const endpoint = `${apiUrl}/elementos-maquinas/${element.element_id}/especificaciones-motor`

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

  useEffect(() => {
    if (!photo) { setPreview(null); return }
    const url = URL.createObjectURL(photo)
    setPreview(url)
    return () => URL.revokeObjectURL(url)
  }, [photo])

  useEffect(() => {
    setStoredImage(null)
    if (!data?.nameplate_image_path) return
    const controller = new AbortController()
    let url
    fetch(`${endpoint}/placa`, { headers: { Authorization: `Bearer ${token}` }, signal: controller.signal })
      .then((response) => { if (!response.ok) throw new Error(); return response.blob() })
      .then((blob) => { if (!controller.signal.aborted) { url = URL.createObjectURL(blob); setStoredImage(url) } })
      .catch(() => {})
    return () => { controller.abort(); if (url) URL.revokeObjectURL(url) }
  }, [endpoint, token, data?.nameplate_image_path])

  async function save(event) {
    event.preventDefault()
    if (!isAdmin || busy) return
    const form = new FormData(event.currentTarget)
    const payload = Object.fromEntries([...form.entries()].map(([key, value]) => [key, value.trim() || null]))
    setBusy(true); setError(''); setMessage('')
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
      const response = await fetch(endpoint, { method: 'PUT', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify(payload) })
      const result = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(typeof result.detail === 'string' ? result.detail : 'Revisa los valores y la precisión de los campos numéricos.')
      setData(result); setPhoto(null); setVersion((value) => value + 1); setMessage('Data guardada correctamente.')
    } catch (error) { setError(error.message) } finally { setBusy(false) }
  }

  async function remove() {
    if (!isAdmin || busy || !window.confirm(`¿Eliminar la data de ${element.name}? El elemento de máquina se conservará.`)) return
    setBusy(true); setError(''); setMessage('')
    try {
      const response = await fetch(endpoint, { method: 'DELETE', headers: { Authorization: `Bearer ${token}` } })
      if (!response.ok) { const result = await response.json().catch(() => ({})); throw new Error(typeof result.detail === 'string' ? result.detail : 'No se pudo eliminar la data.') }
      setData(null); setPhoto(null); setVersion((value) => value + 1); setMessage('Data eliminada correctamente.')
    } catch (error) { setError(error.message) } finally { setBusy(false) }
  }

  return <div className="modal-backdrop"><div className="motor-modal" role="dialog" aria-modal="true" aria-labelledby="motor-spec-title">
    <div className="modal-header"><div><p className="eyebrow">{element.element_code || 'ELEMENTO'} · {element.name}</p><h2 id="motor-spec-title">Data de motor</h2></div><button aria-label="Cerrar" disabled={busy} onClick={onClose}><X /></button></div>
    {loading ? <p role="status">Cargando data...</p> : !loadFailed && <>
      {!data && <p>Este elemento todavía no tiene data de motor.</p>}
      {(isAdmin || data) && <form key={version} onSubmit={save}><div className="motor-form-grid">
        {numericFields.map(([name, label, decimals, max]) => <label key={name}>{label}<input name={name} type="number" step={10 ** -decimals} min={name === 'rpm' || name === 'poles' ? -2147483648 : -max} max={max} defaultValue={data?.[name] ?? ''} readOnly={!isAdmin} /></label>)}
        {textFields.map(([name, label, maxLength]) => <label key={name}>{label}<input name={name} maxLength={maxLength} defaultValue={data?.[name] ?? ''} readOnly={!isAdmin} /></label>)}
        {isAdmin && <label className="full-field">Foto de la placa<input type="file" accept="image/jpeg,image/png,image/webp" onChange={(event) => setPhoto(event.target.files[0] || null)} /><span className="field-help">JPG, PNG o WEBP. Máximo 10 MB. La foto actual se conserva si no seleccionas otra.</span></label>}
        {(preview || storedImage) && <div className="full-field nameplate-preview"><img src={preview || storedImage} alt={`Placa de ${element.name}`} /></div>}
        {data?.nameplate_image_path && !storedImage && !preview && <p className="full-field field-help">La data tiene una foto guardada, pero la vista previa no está disponible.</p>}
        <label className="full-field">Notas<textarea name="notes" maxLength={500} rows={3} defaultValue={data?.notes ?? ''} readOnly={!isAdmin} /></label>
      </div>{isAdmin && <div className="modal-actions">{data && <button type="button" className="secondary-action" disabled={busy} onClick={remove}>Eliminar data</button>}<button className="primary-action" disabled={busy}>{busy ? 'Procesando...' : 'Guardar data'}</button></div>}</form>}
    </>}
    {error && <p className="admin-message" role="alert">{error}</p>}{message && <p className="admin-message" role="status">{message}</p>}
  </div></div>
}
