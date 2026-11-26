import { useState } from 'react'
import { X } from 'lucide-react'

export function Modal({eyebrow, title, onClose, children, wide = false}) {
  return <div className="modal-backdrop" role="presentation"><div className={`motor-modal${wide ? ' calibration-wide' : ''}`} role="dialog" aria-modal="true" aria-label={title}>
    <div className="modal-header"><div><p className="eyebrow">{eyebrow}</p><h2>{title}</h2></div><button onClick={onClose} aria-label="Cerrar"><X /></button></div>
    {children}
  </div></div>
}

export function useSubmit(onDone) {
  const [busy, setBusy] = useState(false), [error, setError] = useState('')
  const submit = async fn => { if (busy) return; setBusy(true); setError(''); try { onDone(await fn()) } catch (e) { setError(e.message) } finally { setBusy(false) } }
  return {busy, error, submit}
}

export function FormActions({busy, onClose, label = 'Guardar'}) {
  return <div className="calibration-actions"><button type="button" onClick={onClose}>Cancelar</button><button className="primary-action" disabled={busy}>{busy ? 'Guardando…' : label}</button></div>
}
