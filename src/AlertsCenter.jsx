import PreventiveHourAlerts from './PreventiveHourAlerts'
import { useRef, useState } from 'react'
import { Bell, X } from 'lucide-react'
import StockAlerts from './StockAlerts'
import RequisitionAlerts from './RequisitionAlerts'

export default function AlertsCenter({ apiUrl, token, section, isOperator, isAdmin, canPreventives, onRequestsSlot, onNavigate }) {
  const dialog = useRef(null)
  const trigger = useRef(null)
  const [open, setOpen] = useState(false)
  function close() { dialog.current?.close() }
  function navigate(section) { close(); onNavigate(section) }

  return <>
    <button ref={trigger} className="alerts-center-trigger" aria-haspopup="dialog" aria-expanded={open} onClick={() => { setOpen(true); dialog.current.showModal() }}>
      <span className="alerts-bell" aria-hidden="true"><Bell size={20} /><span className="alerts-indicator" /></span><span>Alertas disponibles</span>
    </button>
    <dialog ref={dialog} className="stock-alert-dialog alerts-center" aria-labelledby="alerts-center-title" onClose={() => { setOpen(false); trigger.current?.focus() }}>
      <div className="modal-header"><h2 id="alerts-center-title">Alertas</h2><button onClick={close} aria-label="Cerrar alertas"><X /></button></div>
      <p>Selecciona una categoría para consultar sus pendientes.</p>
      <section className="alert-category"><h3>Mantenimiento</h3><p>Trabajos disponibles, en curso y pendientes de recepción.</p><div ref={onRequestsSlot} />{canPreventives&&<PreventiveHourAlerts apiUrl={apiUrl} token={token} section={`${section}:${open}`} onOpen={()=>navigate('preventive')}/>}</section>
      {!isOperator && <section className="alert-category"><h3>Inventario</h3><StockAlerts apiUrl={apiUrl} token={token} section={`${section}:${open}`} /></section>}
      {isAdmin && <section className="alert-category"><h3>Requisiciones de compra</h3><RequisitionAlerts apiUrl={apiUrl} token={token} section={`${section}:${open}`} onOpen={() => navigate('requisitions')} /></section>}
    </dialog>
  </>
}
