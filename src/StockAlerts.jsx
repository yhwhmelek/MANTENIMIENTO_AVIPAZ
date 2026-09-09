import { useEffect, useRef, useState } from 'react'
import { AlertTriangle, X } from 'lucide-react'

export default function StockAlerts({ apiUrl, token, section }) {
  const [alerts, setAlerts] = useState([])
  const [error, setError] = useState('')
  const [updated, setUpdated] = useState(null)
  const [open, setOpen] = useState(false)
  const dialog = useRef(null)
  const trigger = useRef(null)

  useEffect(() => {
    const controller = new AbortController()
    let busy = false
    async function refresh() {
      if (busy || controller.signal.aborted) return
      busy = true
      try {
        const response = await fetch(`${apiUrl}/alertas-stock`, { headers: { Authorization: `Bearer ${token}` }, signal: controller.signal })
        const data = await response.json()
        if (!response.ok) throw new Error('No se pudo verificar el stock. Revisa la conexión y las migraciones 003 y 004.')
        setAlerts(data)
        setError('')
        setUpdated(new Date())
      } catch (err) {
        if (err.name !== 'AbortError') setError(err.message)
      } finally { busy = false }
    }
    refresh()
    const timer = setInterval(refresh, 30000)
    window.addEventListener('focus', refresh)
    window.addEventListener('stock-updated', refresh)
    return () => { controller.abort(); clearInterval(timer); window.removeEventListener('focus', refresh); window.removeEventListener('stock-updated', refresh) }
  }, [apiUrl, token, section, open])

  useEffect(() => {
    if (open) dialog.current?.showModal()
    else if (dialog.current?.open) dialog.current.close()
  }, [open])

  return <>
    <button ref={trigger} className={`stock-alert-trigger ${error || alerts.length ? 'needs-attention' : ''}`} onClick={() => setOpen(true)} aria-haspopup="dialog">
      <AlertTriangle size={20} /><span role="status">{error ? 'Stock sin verificar' : !updated ? 'Verificando stock…' : `Alertas de stock: ${alerts.length}`}</span>
    </button>
    <dialog ref={dialog} className="stock-alert-dialog" aria-labelledby="stock-alert-title" onClose={() => { setOpen(false); trigger.current?.focus() }}>
      <div className="modal-header"><h2 id="stock-alert-title">Alertas de stock mínimo</h2><button aria-label="Cerrar alertas" onClick={() => setOpen(false)}><X /></button></div>
      <p>Repuestos activos con mínimo mayor que cero y saldo igual o inferior al mínimo. Configura el mínimo en Inventario para incluir un repuesto.</p>
      <p>Saldo inicial al cierre de la fecha de corte, más compras y menos consumos no anulados de días posteriores. Sin saldo inicial, se cuentan todos los movimientos. Actualización automática cada 30 segundos.</p>
      {error && <p role="alert">{error} {updated && 'Los datos mostrados corresponden a la última consulta correcta.'}</p>}
      {updated && <p>Última consulta: {updated.toLocaleTimeString()}</p>}
      {!!alerts.length && <div className="table-scroll"><table><thead><tr><th>Código</th><th>Repuesto</th><th>Saldo</th><th>Mínimo</th><th>Faltante al mínimo</th><th>Unidad</th><th>Ubicación</th></tr></thead><tbody>
        {alerts.map((part) => <tr key={part.spare_part_id}><td>{part.internal_code}</td><td>{part.description}</td><td><strong>{part.current_stock}</strong></td><td>{part.minimum_stock}</td><td>{Math.max(0, Number(part.minimum_stock) - Number(part.current_stock)).toLocaleString('es-EC', { maximumFractionDigits: 2 })}</td><td>{part.unit_of_measure}</td><td>{part.storage_location || '—'}</td></tr>)}
      </tbody></table></div>}
      {!error && updated && !alerts.length && <p className="empty-state">No hay repuestos en el mínimo o por debajo de él.</p>}
      {!error && !updated && <p role="status">Consultando existencias…</p>}
    </dialog>
  </>
}
