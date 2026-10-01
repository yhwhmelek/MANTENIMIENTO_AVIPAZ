import {useCallback, useEffect, useState} from 'react'
import {frequencyLabel} from './preventiveFrequency'

const states = {SIN_LECTURA:'Falta lectura',AL_DIA:'Al día',PROXIMO:'Próximo mantenimiento',VENCIDO:'Mantenimiento vencido',EN_TRABAJO:'Orden abierta',REVISAR_REFERENCIA:'La referencia supera la última lectura; revisa o actualiza el horómetro'}

export default function PreventiveHourReadings({request, machines}) {
  const [readings,setReadings] = useState([]), [plans,setPlans] = useState([])
  const [machineId,setMachineId] = useState(''), [hours,setHours] = useState(''), [reset,setReset] = useState(false)
  const [busy,setBusy] = useState(false), [error,setError] = useState(''), [message,setMessage] = useState('')
  const load = useCallback(async () => {const [r,p] = await Promise.all([request('/preventivos/horometros'),request('/preventivos/estado-horas')]);setReadings(r);setPlans(p)},[request])
  useEffect(()=>{load().catch(e=>setError(e.message))},[load])
  const current = readings.find(r=>r.machine_id===Number(machineId))
  const name = id => {const m=machines.find(m=>m.machine_id===id);return m?`${m.asset_code} · ${m.name}`:`Máquina ${id}`}
  async function save(event) {
    event.preventDefault();if(busy)return;setBusy(true);setError('');setMessage('')
    try {await request('/preventivos/horometros',{method:'POST',body:JSON.stringify({machine_id:Number(machineId),hours,counter_reset:reset})});setHours('');setReset(false);await load();window.dispatchEvent(new Event('preventive-hours-updated'));setMessage('Lectura guardada. Los avisos se han actualizado.')}
    catch(e){setError(e.message)}finally{setBusy(false)}
  }
  return <section className="preventive-hour-readings"><h2>Horómetros y avisos</h2>
    <p>Registra el contador que muestra el PLC. El aviso aparece cuando faltan las horas de anticipación configuradas; la frecuencia posterior se cuenta desde el último cambio realizado.</p>
    {error&&<p role="alert">{error}</p>}{message&&<p role="status">{message}</p>}
    <form onSubmit={save}><fieldset disabled={busy} className="request-fields"><div className="motor-form-grid">
      <label>Máquina<select required value={machineId} onChange={e=>{setMachineId(e.target.value);setHours('');setReset(false)}}><option value="">Selecciona</option>{machines.map(m=><option key={m.machine_id} value={m.machine_id}>{name(m.machine_id)}</option>)}</select></label>
      <label>Lectura actual del PLC (horas)<input type="number" required min="0" max="999999999" step="0.01" value={hours} onChange={e=>setHours(e.target.value)}/></label>
    </div>{current&&<p>Última lectura: {current.counter_hours} h · {current.observed_at.replace('T',' ').slice(0,16)}. Acumulado conservado: {current.hours} h.</p>}
      <label className="checkbox-field"><input type="checkbox" checked={reset} disabled={!current} onChange={e=>setReset(e.target.checked)}/>El contador del PLC se reinició desde la última lectura</label>
      <p>Antes de resetear, registra la lectura final. Reiniciar el contador por sí solo no registra un cambio de aceite ni cierra una orden.</p>
      <button className="primary-action">{busy?'Guardando…':'Registrar lectura'}</button>
    </fieldset></form>
    <h3>Seguimiento por actividad</h3>{!plans.length&&<p>No hay planes activos con frecuencia por horas.</p>}
    {plans.map(plan=><section key={plan.plan_id}><h4>{plan.activity}</h4><p>{frequencyLabel(plan.frequency)}</p><div className="table-scroll"><table><thead><tr><th>Máquina</th><th>Contador PLC</th><th>Horas desde el inicio / último cambio</th><th>Horas restantes</th><th>Estado</th></tr></thead><tbody>{plan.machines.map(m=><tr key={m.machine_id}><td>{name(m.machine_id)}</td><td>{m.counter_hours??'Sin lectura'}</td><td>{m.service_hours??'—'}</td><td>{m.remaining_hours==null?'—':Number(m.remaining_hours)<0?`${Math.abs(Number(m.remaining_hours))} h excedidas`:`${m.remaining_hours} h`}</td><td>{states[m.state]}{m.request_id&&` #${m.request_id}`}</td></tr>)}</tbody></table></div></section>)}
  </section>
}
