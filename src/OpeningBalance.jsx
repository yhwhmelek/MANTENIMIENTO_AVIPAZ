import { useEffect, useState } from 'react'
import { X } from 'lucide-react'

export default function OpeningBalance({ apiUrl, token, part, onClose }) {
  const [balance, setBalance] = useState(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [ready, setReady] = useState(false)
  const today = new Date()
  const maxDate = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`

  useEffect(() => {
    const controller = new AbortController()
    fetch(`${apiUrl}/repuestos/${part.spare_part_id}/saldo-inicial`, { headers: { Authorization: `Bearer ${token}` }, signal: controller.signal })
      .then(async (response) => {
        const data = await response.json()
        if (!response.ok) throw new Error(typeof data.detail === 'string' ? data.detail : 'No se pudo consultar el saldo inicial.')
        setBalance(data)
        setReady(true)
      })
      .catch((err) => { if (err.name !== 'AbortError') setError(err.message) })
      .finally(() => { if (!controller.signal.aborted) setLoading(false) })
    return () => controller.abort()
  }, [apiUrl, token, part.spare_part_id])

  async function save(event) {
    event.preventDefault()
    if (saving || !ready || balance) return
    const form = new FormData(event.currentTarget)
    setSaving(true)
    setError('')
    try {
      const response = await fetch(`${apiUrl}/repuestos/${part.spare_part_id}/saldo-inicial`, {
        method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ cutoff_date: form.get('cutoff_date'), quantity: form.get('quantity'), notes: form.get('notes').trim() || null }),
      })
      const data = await response.json()
      if (!response.ok) throw new Error(typeof data.detail === 'string' ? data.detail : 'Revisa la cantidad y la fecha de corte.')
      setBalance(data)
      window.dispatchEvent(new Event('stock-updated'))
    } catch (err) { setError(err.message) } finally { setSaving(false) }
  }

  return <div className="modal-backdrop"><div className="motor-modal category-modal" role="dialog" aria-modal="true" aria-labelledby="opening-balance-title">
    <div className="modal-header"><h2 id="opening-balance-title">Saldo inicial de bodega</h2><button onClick={onClose} disabled={saving} aria-label="Cerrar"><X /></button></div>
    <p><strong>{part.internal_code}</strong> · {part.description}</p>
    {loading && <p role="status">Consultando saldo inicial…</p>}
    {error && <p role="alert">{error}</p>}
    {balance ? <div role="status">
      <p>Saldo inicial registrado: <strong>{balance.quantity} {balance.unit_of_measure}</strong>.</p>
      <p>Fecha de corte (al cierre del día): <strong>{balance.cutoff_date}</strong>.</p>
      {balance.notes && <p>{balance.notes}</p>}
      <p>Las alertas incluyen este saldo y los movimientos de días posteriores. Ya no se puede registrar otro saldo inicial para este repuesto.</p>
    </div> : ready && <form onSubmit={save}>
      <p>Ingresa el conteo físico al cierre de la fecha de corte. Las compras y consumos de ese día y de días anteriores ya deben estar incluidos en esta cantidad.</p>
      <div className="motor-form-grid">
        <label>Cantidad ({part.unit_of_measure})<input autoFocus name="quantity" type="number" min="0" max="99999999.99" step="0.01" required disabled={saving} /></label>
        <label>Fecha de corte<input name="cutoff_date" type="date" max={maxDate} required disabled={saving} /></label>
        <label className="full-field">Notas<textarea name="notes" maxLength={500} rows={3} disabled={saving} /></label>
        <label className="full-field checkbox-field"><input type="checkbox" required disabled={saving} /> Confirmo la cantidad y la fecha. Este saldo inicial se registra una sola vez.</label>
      </div>
      <div className="modal-actions"><button className="secondary-action" type="button" onClick={onClose} disabled={saving}>Cancelar</button><button className="primary-action" disabled={saving}>{saving ? 'Guardando…' : 'Registrar saldo inicial'}</button></div>
    </form>}
  </div></div>
}
