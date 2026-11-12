import {useState} from 'react'
import {effectiveFrequency, frequencyLabel, needsOperatingHours, operatingHoursNotice} from './preventiveFrequency'

const today = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}` }

export default function GeneralPreventivePlans({activities, plans, machines, request, onSaved, isAdmin}) {
  const [editing, setEditing] = useState(null)
  const [form, setForm] = useState(null)
  const [search, setSearch] = useState('')
  const [plant, setPlant] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')
  const general = activities.filter(a => a.scope === 'GENERAL')
  const availableGeneral = general.filter(a => !a.plant_id || !form?.plant_id || String(a.plant_id) === String(form.plant_id))
  const plants = [...new Map(machines.filter(m => m.plant_id).map(m => [m.plant_id, m.plant_name])).entries()]
  const activity = availableGeneral.find(a => a.id === Number(form?.activity_id))
  const hourly = needsOperatingHours(form, activity)
  const shown = machines.filter(m => (!plant || String(m.plant_id) === plant) && `${m.asset_code} ${m.name} ${m.tower_name || ''}`.toLocaleLowerCase().includes(search.toLocaleLowerCase()))
  const change = (key, value) => setForm(current => ({...current, [key]:value}))
  function edit(plan) {
    setError(''); setMessage(''); setSearch(''); setPlant(''); setEditing(plan?.id || null)
    if (plan) { const {id, next_due, ...value} = plan; const plantIds=[...new Set(machines.filter(m => value.machine_ids?.includes(m.machine_id)).map(m => m.plant_id))]; const plant_id=value.plant_id|| (plantIds.length===1?plantIds[0]:''); setForm(structuredClone({...value,plant_id,coverage_mode:value.coverage_mode||'SELECTED',excluded_machine_ids:value.excluded_machine_ids||[]})); return }
    const firstPlant=plants[0]?.[0]
    const first = general.find(a => a.active && (!a.plant_id || String(a.plant_id) === String(firstPlant)))
    setForm({hour_base:0,hour_bases:{},first_service_done:false,scope:'GENERAL', activity_id:first?.id || '', machine_id:null, machine_ids:[], plant_id:firstPlant || '', coverage_mode:'PLANT', excluded_machine_ids:[], element_id:null,
      first_due:today(), start_time:first?.start_time || '08:00', frequency_override:null, override_reason:'', route:'', points:[], active:true, revision:0})
  }
  async function save(event) {
    event.preventDefault()
    if (busy) return
    if (!form.plant_id) { setError('Selecciona una planta.'); return }
    setBusy(true); setError(''); setMessage('')
    try {
      await request(`/preventivos/planes${editing ? `/${editing}` : ''}`, {method:editing ? 'PUT' : 'POST', body:JSON.stringify({...form,plant_id:Number(form.plant_id)||null,machine_ids:[],excluded_machine_ids:[],coverage_mode:'PLANT',hour_bases:Object.fromEntries(Object.entries(form.hour_bases||{}).filter(([id])=>machines.some(m=>String(m.machine_id)===id&&String(m.plant_id)===String(form.plant_id))))})})
      setForm(null); await onSaved(); setMessage(hourly ? `Plan general guardado. ${operatingHoursNotice}` : 'Plan general guardado. Se publicará una sola orden por fecha programada.')
    } catch (e) { setError(e.message) } finally { setBusy(false) }
  }
  async function remove(plan) {
    if (busy || !window.confirm('¿Eliminar este plan general? Solo se puede eliminar si todavía no tiene órdenes publicadas ni historial.')) return
    setBusy(true); setError(''); setMessage('')
    try { await request(`/preventivos/planes/${plan.id}`, {method:'DELETE'}); setForm(null); await onSaved(); setMessage('Plan general eliminado.') }
    catch (e) { setError(e.message) } finally { setBusy(false) }
  }
  return <section className="general-preventive-plans">
    <h2>Actividades generales</h2>
    <p>Selecciona las máquinas que abarca el trabajo. El calendario y las alertas mostrarán una sola actividad; la duración corresponde al trabajo completo.</p>
    {error && <p role="alert">{error}</p>}{message && <p role="status">{message}</p>}
    {isAdmin && !form && <button className="primary-action" disabled={!general.some(a => a.active)} onClick={() => edit()}>Asignar actividad general</button>}
    {!general.length && <p>Crea una actividad con alcance «General para varias máquinas» en Actividades y frecuencias.</p>}
    <div className="table-scroll"><table><thead><tr><th>Actividad</th><th>Máquinas incluidas</th><th>Próximo vencimiento</th><th>Inicio / duración total</th><th>Estado</th>{isAdmin && <th>Acciones</th>}</tr></thead><tbody>
      {plans.map(plan => { const a = activities.find(a => a.id === plan.activity_id); return <tr key={plan.id}><td>{a?.name}{plan.route && <small> · {plan.route}</small>}</td><td>{plan.coverage_mode === 'ALL' ? `Todos los activos${plan.excluded_machine_ids?.length ? ` · ${plan.excluded_machine_ids.length} excluidos` : ''}` : plan.machine_ids.length}</td><td>{frequencyLabel(effectiveFrequency(plan,a))}<br/>{needsOperatingHours(plan,a)?'Consultar Horómetros y avisos':plan.next_due}</td><td>{plan.start_time.slice(0,5)} · {a?.duration_minutes%1440===0?`${a.duration_minutes/1440} día(s)`:`${a?.duration_minutes/60} hora(s)`}</td><td>{plan.active ? 'Activo' : 'Inactivo'}</td>{isAdmin && <td><button disabled={busy} onClick={() => edit(plan)}>Editar selección</button><button className="danger" disabled={busy} onClick={() => remove(plan)}>Eliminar</button></td>}</tr> })}
    </tbody></table></div>
    {form && <form className="general-plan-editor" onSubmit={save}><fieldset disabled={busy}>
      <h3>{editing ? 'Editar plan general' : 'Asignar actividad general'}</h3>
      <div className="motor-form-grid">
        <label>Actividad general<select required disabled={!!editing} value={form.activity_id} onChange={e => { const a = availableGeneral.find(a => a.id === Number(e.target.value)); setForm(current => ({...current, activity_id:a?.id || '', start_time:a?.start_time || '08:00', excluded_machine_ids:a?.excluded_machine_ids || []})) }}>
          <option value="">Selecciona</option>{availableGeneral.filter(a => a.active || a.id === form.activity_id).map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
        </select></label>
        <label>{hourly ? 'Fecha de referencia del plan' : 'Primera intervención'}<input type="date" required disabled={!!editing} value={form.first_due} onChange={e => change('first_due', e.target.value)}/></label>
        <label>Hora de inicio<input type="time" required value={form.start_time} onChange={e => change('start_time', e.target.value)}/></label>
        <label>Nombre de ruta (opcional)<input maxLength={150} value={form.route} onChange={e => change('route', e.target.value)}/></label>
      </div>
      {activity && <p>Duración total sugerida: <strong>{activity.duration_minutes%1440===0?`${activity.duration_minutes/1440} día(s)`:`${activity.duration_minutes/60} hora(s)`}</strong>. Se configura en la actividad, junto con su frecuencia.</p>}
      {activity && <p>Frecuencia: <strong>{frequencyLabel(effectiveFrequency(form, activity))}</strong></p>}
      {hourly && <><p role="status">{operatingHoursNotice}</p><label className="checkbox-field"><input type="checkbox" checked={!!form.first_service_done} onChange={e=>change('first_service_done',e.target.checked)}/>El primer cambio ya fue realizado; las referencias corresponden al último cambio</label></>}
      <label>Planta del mantenimiento<select required value={form.plant_id} onChange={e => { const plant_id=e.target.value; const selected=general.find(a => a.id === Number(form.activity_id)); setForm(current => ({...current,plant_id,activity_id:selected?.plant_id && String(selected.plant_id)!==String(plant_id)?'':current.activity_id})) }}><option value="">Selecciona una planta</option>{plants.map(([id,name]) => <option key={id} value={id}>{name}</option>)}</select></label>
      <p>Se generará una actividad general independiente para la planta seleccionada. Las máquinas activas de la planta se incluirán automáticamente.</p>
      <div className="request-toolbar"><label>Buscar máquina<input value={search} onChange={e => setSearch(e.target.value)} placeholder="Código, nombre o torre"/></label><label>Planta<select value={plant} onChange={e => setPlant(e.target.value)}><option value="">Todas</option>{[...new Map(machines.filter(m => m.plant_id).map(m => [m.plant_id, m.plant_name])).entries()].map(([id,name]) => <option key={id} value={id}>{name}</option>)}</select></label>
        <span role="status">La selección se realiza por planta.</span>
      </div>
      <p role="status">{form.plant_id ? `${machines.filter(m => String(m.plant_id) === String(form.plant_id) && m.status !== 'FUERA_SERVICIO').length} máquinas activas en la planta seleccionada` : 'Selecciona una planta'}</p>
      <div className="general-machine-list table-scroll"><table><thead><tr><th>Incluir</th><th>Código</th><th>Máquina</th><th>Planta / torre</th>{hourly&&<th>Referencia acumulada (h)</th>}</tr></thead><tbody>{shown.map(m => <tr key={m.machine_id}>
        <td>{String(m.plant_id) === String(form.plant_id) && m.status !== 'FUERA_SERVICIO' ? 'Incluida automáticamente' : 'No incluida'}</td>
        <td>{m.asset_code}</td><td>{m.name}{m.status === 'FUERA_SERVICIO' && ' · Fuera de servicio'}</td><td>{m.plant_name} / {m.tower_name}</td>{hourly&&<td><input aria-label={`Referencia de ${m.name}`} type="number" min="0" max="999999999" step="0.01" disabled={String(m.plant_id)!==String(form.plant_id)||m.status==='FUERA_SERVICIO'} value={form.hour_bases?.[m.machine_id]??0} onChange={e=>change('hour_bases',{...form.hour_bases,[m.machine_id]:e.target.value||0})}/></td>}
      </tr>)}</tbody></table></div>
      <label className="checkbox-field"><input type="checkbox" checked={form.active} onChange={e => change('active', e.target.checked)}/>Plan activo</label>
      <p>Los cambios de selección se aplican a futuras órdenes. Las órdenes publicadas conservan sus máquinas originales.</p>
      <div className="modal-actions"><button type="button" onClick={() => setForm(null)}>Cancelar</button>{editing && <button type="button" className="danger" disabled={busy} onClick={() => remove(plans.find(plan => plan.id === editing))}>Eliminar plan</button>}<button className="primary-action" disabled={!form.plant_id}>{busy ? 'Guardando…' : 'Guardar plan general'}</button></div>
    </fieldset></form>}
  </section>
}
