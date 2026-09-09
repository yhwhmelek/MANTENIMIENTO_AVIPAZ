import { useEffect, useState } from 'react'

export default function OperatingPeriods({ request, machines, canCreate }) {
  const [rows,setRows]=useState([]),[error,setError]=useState(''),[busy,setBusy]=useState(false),[version,setVersion]=useState(0)
  useEffect(()=>{const controller=new AbortController();request('/periodos-operacion',{signal:controller.signal}).then(setRows).catch(e=>{if(e.name!=='AbortError')setError(e.message)});return()=>controller.abort()},[version])
  async function save(event){
    event.preventDefault();if(busy)return
    const form=event.currentTarget,data=Object.fromEntries(new FormData(form));data.machine_id=Number(data.machine_id)
    setBusy(true);setError('')
    try{await request('/periodos-operacion',{method:'POST',body:JSON.stringify(data)});form.reset();setVersion(v=>v+1)}catch(e){setError(e.message)}finally{setBusy(false)}
  }
  return <section><h3>Horas de operación por período</h3><p>Registra períodos finalizados (por ejemplo, un turno). Las horas operadas corresponden únicamente al tiempo programado para producir. No se permiten períodos superpuestos para la misma máquina.</p>
    {error&&<p role="alert">{error}</p>}
    {canCreate&&<form onSubmit={save}><fieldset disabled={busy} className="request-fields"><div className="motor-form-grid"><label>Máquina<select name="machine_id" required><option value="">Selecciona</option>{machines.map(m=><option value={m.machine_id} key={m.machine_id}>{m.asset_code} · {m.name}</option>)}</select></label><label>Inicio (hora Ecuador)<input name="starts_at" type="datetime-local" required/></label><label>Fin (hora Ecuador)<input name="ends_at" type="datetime-local" required/></label><label>Horas programadas<input name="scheduled_hours" type="number" min="0.01" step="0.01" required/></label><label>Horas realmente operadas<input name="operating_hours" type="number" min="0" step="0.01" required/></label><label>Notas / turno<input name="notes" maxLength={500} required/></label></div><div className="modal-actions"><button className="primary-action">{busy?'Guardando…':'Registrar período'}</button></div></fieldset></form>}
    <div className="table-scroll"><table><thead><tr><th>Máquina</th><th>Inicio</th><th>Fin</th><th>Horas programadas</th><th>Horas operadas</th><th>Notas</th></tr></thead><tbody>{rows.map(r=><tr key={r.id}><td>{r.machine_code}</td><td>{r.starts_at.replace('T',' ')}</td><td>{r.ends_at.replace('T',' ')}</td><td>{r.scheduled_hours}</td><td>{r.operating_hours}</td><td>{r.notes}</td></tr>)}</tbody></table></div>
  </section>
}
