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
  const activity = general.find(a => a.id === Number(form?.activity_id))
  const hourly = needsOperatingHours(form, activity)
  const shown = machines.filter(m => (!plant || String(m.plant_id) === plant) && `${m.asset_code} ${m.name} ${m.tower_name || ''}`.toLocaleLowerCase().includes(search.toLocaleLowerCase()))
  const change = (key, value) => setForm(current => ({...current, [key]:value}))
  function edit(plan) {
    setError(''); setMessage(''); setSearch(''); setPlant(''); setEditing(plan?.id || null)
    if (plan) { const {id, next_due, ...value} = plan; setForm(structuredClone(value)); return }
    const first = general.find(a => a.active)
    setForm({scope:'GENERAL', activity_id:first?.id || '', machine_id:null, machine_ids:[], element_id:null,
      first_due:today(), start_time:first?.start_time || '08:00', frequency_override:null, override_reason:'', route:'', points:[], active:true, revision:0})
  }
  async function save(event) {
    event.preventDefault()
    if (busy) return
    if (!form.machine_ids.length) { setError('Selecciona al menos una máquina.'); return }
    setBusy(true); setError(''); setMessage('')
    try {
      await request(`/preventivos/planes${editing ? `/${editing}` : ''}`, {method:editing ? 'PUT' : 'POST', body:JSON.stringify(form)})
      setForm(null); await onSaved(); setMessage(hourly ? `Plan general guardado. ${operatingHoursNotice}` : 'Plan general guardado. Se publicará una sola orden por fecha programada.')
    } catch (e) { setError(e.message) } finally { setBusy(false) }
  }
  return <section className="general-preventive-plans">
    <h2>Actividades generales</h2>
    <p>Selecciona las máquinas que abarca el trabajo. El calendario y las alertas mostrarán una sola actividad; la duración corresponde al trabajo completo.</p>
    {error && <p role="alert">{error}</p>}{message && <p role="status">{message}</p>}
    {isAdmin && !form && <button className="primary-action" disabled={!general.some(a => a.active)} onClick={() => edit()}>Asignar actividad general</button>}
    {!general.length && <p>Crea una actividad con alcance «General para varias máquinas» en Actividades y frecuencias.</p>}
    <div className="table-scroll"><table><thead><tr><th>Actividad</th><th>Máquinas incluidas</th><th>Próximo vencimiento</th><th>Inicio / duración total</th><th>Estado</th>{isAdmin && <th>Acciones</th>}</tr></thead><tbody>
      {plans.map(plan => { const a = activities.find(a => a.id === plan.activity_id); return <tr key={plan.id}><td>{a?.name}{plan.route && <small> · {plan.route}</small>}</td><td>{plan.machine_ids.length}</td><td>{frequencyLabel(effectiveFrequency(plan,a))}<br/>{needsOperatingHours(plan,a)?'Pendiente de horas de funcionamiento':plan.next_due}</td><td>{plan.start_time.slice(0,5)} · {a?.duration_minutes} min</td><td>{plan.active ? 'Activo' : 'Inactivo'}</td>{isAdmin && <td><button disabled={busy} onClick={() => edit(plan)}>Editar selección</button></td>}</tr> })}
    </tbody></table></div>
    {form && <form className="general-plan-editor" onSubmit={save}><fieldset disabled={busy}>
      <h3>{editing ? 'Editar plan general' : 'Asignar actividad general'}</h3>
      <div className="motor-form-grid">
        <label>Actividad general<select required disabled={!!editing} value={form.activity_id} onChange={e => { const a = general.find(a => a.id === Number(e.target.value)); setForm(current => ({...current, activity_id:a?.id || '', start_time:a?.start_time || '08:00'})) }}>
          <option value="">Selecciona</option>{general.filter(a => a.active || a.id === form.activity_id).map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
        </select></label>
        <label>{hourly ? 'Fecha de referencia del plan' : 'Primera intervención'}<input type="date" required disabled={!!editing} value={form.first_due} onChange={e => change('first_due', e.target.value)}/></label>
        <label>Hora de inicio<input type="time" required value={form.start_time} onChange={e => change('start_time', e.target.value)}/></label>
        <label>Nombre de ruta (opcional)<input maxLength={150} value={form.route} onChange={e => change('route', e.target.value)}/></label>
      </div>
      {activity && <p>Duración total sugerida: <strong>{activity.duration_minutes} minutos</strong>. Se configura en la actividad, junto con su frecuencia.</p>}
      {activity && <p>Frecuencia: <strong>{frequencyLabel(effectiveFrequency(form, activity))}</strong></p>}
      {hourly && <p role="status">{operatingHoursNotice}</p>}
      <p>Marca las máquinas que corresponden; por ejemplo, las que tienen elementos móviles para el engrase general.</p>
      <div className="request-toolbar"><label>Buscar máquina<input value={search} onChange={e => setSearch(e.target.value)} placeholder="Código, nombre o torre"/></label><label>Planta<select value={plant} onChange={e => setPlant(e.target.value)}><option value="">Todas</option>{[...new Map(machines.filter(m => m.plant_id).map(m => [m.plant_id, m.plant_name])).entries()].map(([id,name]) => <option key={id} value={id}>{name}</option>)}</select></label>
        <button type="button" onClick={() => change('machine_ids', [...new Set([...form.machine_ids, ...shown.filter(m => m.status !== 'FUERA_SERVICIO').map(m => m.machine_id)])])}>Seleccionar todas las visibles</button>
        <button type="button" onClick={() => change('machine_ids', form.machine_ids.filter(id => !shown.some(m => m.machine_id === id)))}>Quitar selección visible</button>
      </div>
      <p role="status">{form.machine_ids.length} máquinas seleccionadas · {shown.length} visibles</p>
      <div className="general-machine-list table-scroll"><table><thead><tr><th>Incluir</th><th>Código</th><th>Máquina</th><th>Planta / torre</th></tr></thead><tbody>{shown.map(m => <tr key={m.machine_id}>
        <td><input type="checkbox" aria-label={`Incluir ${m.asset_code} ${m.name}`} checked={form.machine_ids.includes(m.machine_id)} disabled={m.status === 'FUERA_SERVICIO' && !form.machine_ids.includes(m.machine_id)} onChange={e => change('machine_ids', e.target.checked ? [...form.machine_ids, m.machine_id] : form.machine_ids.filter(id => id !== m.machine_id))}/></td>
        <td>{m.asset_code}</td><td>{m.name}{m.status === 'FUERA_SERVICIO' && ' · Fuera de servicio'}</td><td>{m.plant_name} / {m.tower_name}</td>
      </tr>)}</tbody></table></div>
      <label className="checkbox-field"><input type="checkbox" checked={form.active} onChange={e => change('active', e.target.checked)}/>Plan activo</label>
      <p>Los cambios de selección se aplican a futuras órdenes. Las órdenes publicadas conservan sus máquinas originales.</p>
      <div className="modal-actions"><button type="button" onClick={() => setForm(null)}>Cancelar</button><button className="primary-action" disabled={!form.machine_ids.length}>{busy ? 'Guardando…' : 'Guardar plan general'}</button></div>
    </fieldset></form>}
  </section>
}
