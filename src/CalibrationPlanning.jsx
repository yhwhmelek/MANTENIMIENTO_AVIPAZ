import { useEffect, useState } from 'react'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import {
  assigneeTypes, controlMethods, durationText, frequencyText, frequencyUnits, instrumentTypes, isoDate, orderStatus,
  procedureTemplates, responsibleGroups,
} from './calibrationSchedule'
import { FormActions, Modal, useSubmit } from './calibrationUi'

const today = () => isoDate(new Date())
const hhmm = value => String(value || '08:00').slice(0, 5)
const monthLabel = month => new Date(`${month}-01T12:00`).toLocaleDateString('es-EC', {month: 'long', year: 'numeric'})
const monthRange = month => { const [y, m] = month.split('-').map(Number); return {start: `${month}-01`, end: isoDate(new Date(y, m, 0, 12))} }
const roleNames = {ADMIN: 'Administrador', MECANICO: 'Mecánico', ELECTRICO: 'Eléctrico', TECNICO: 'Técnico'}

// ---------- Responsable: grupo, persona o contratista ----------
export function AssigneeFields({form, set, options}) {
  return <>
    <label>Tipo de responsable<select value={form.assignee_type} onChange={e => { set('assignee_type', e.target.value); if (e.target.value === 'CONTRATISTA') set('responsible_group', 'EXTERNO') }}>
      {Object.entries(assigneeTypes).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
    {form.assignee_type !== 'CONTRATISTA' && <label>Grupo responsable<select value={form.responsible_group} onChange={e => set('responsible_group', e.target.value)}>
      {Object.entries(responsibleGroups).filter(([k]) => k !== 'EXTERNO').map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>}
    {form.assignee_type === 'USUARIO' && <label>Persona *<select required value={form.assigned_user_id || ''} onChange={e => set('assigned_user_id', e.target.value ? Number(e.target.value) : null)}>
      <option value="">Selecciona…</option>{options.users.map(u => <option key={u.id} value={u.id}>{u.name} · {roleNames[u.role] || u.role}</option>)}</select></label>}
    {form.assignee_type === 'CONTRATISTA' && <label>Contratista *<select required value={form.assigned_contractor_id || ''} onChange={e => set('assigned_contractor_id', e.target.value ? Number(e.target.value) : null)}>
      <option value="">Selecciona…</option>{options.contractors.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}</select></label>}
    {form.assignee_type === 'CONTRATISTA' && !options.contractors.length && <p className="field-help">No hay contratistas activos. Regístralos en Solicitudes → Contratistas.</p>}
  </>
}

const assigneePayload = form => ({assignee_type: form.assignee_type, assigned_user_id: form.assigned_user_id || null, assigned_contractor_id: form.assigned_contractor_id || null, responsible_group: form.responsible_group})

// ---------- Actividades de calibración ----------
export function ActivitiesTab({activities, isAdmin, onEdit}) {
  const [showInactive, setShowInactive] = useState(false)
  const rows = activities.filter(a => showInactive || a.active)
  return <>
    <p className="field-help">Una actividad define el procedimiento, el método y la frecuencia sugerida. Luego se asigna a cada instrumento en «Instrumentos y planes», donde se elige quién la realiza y la primera fecha.</p>
    <label className="checkbox-inline"><input type="checkbox" checked={showInactive} onChange={e => setShowInactive(e.target.checked)} /> Mostrar inactivas</label>
    {!rows.length ? <p className="field-help">{isAdmin ? 'Crea la primera actividad con «Nueva actividad». Ejemplo: «Verificación semanal de balanzas», cada 1 semana, Mantenimiento.' : 'Aún no hay actividades de calibración.'}</p>
      : <div className="users-card table-scroll"><table><thead><tr><th>Actividad</th><th>Método</th><th>Tipo de instrumento</th><th>Frecuencia</th><th>Responsable sugerido</th><th>Duración / personas</th><th>Hora</th><th>Estado</th>{isAdmin && <th></th>}</tr></thead><tbody>
        {rows.map(a => <tr key={a.id} className={a.active ? '' : 'is-inactive'}><td><strong>{a.name}</strong></td><td>{controlMethods[a.control_method]}</td><td>{a.instrument_type ? instrumentTypes[a.instrument_type] : 'Cualquiera'}</td><td>{frequencyText(a)}</td><td>{responsibleGroups[a.responsible_group]}</td><td>{durationText(a.duration_minutes)} · {a.crew_size} persona(s)</td><td>{hhmm(a.start_time)}</td><td>{a.active ? 'Activa' : 'Inactiva'}</td>{isAdmin && <td><button className="secondary-action" onClick={() => onEdit(a)}>Editar</button></td>}</tr>)}
      </tbody></table></div>}
  </>
}

export function ActivityForm({request, item, onClose, onSaved}) {
  const [form, setForm] = useState(() => item ? {...item, instrument_type: item.instrument_type || '', start_time: hhmm(item.start_time)}
    : {name: '', control_method: 'VERIFICACION_INTERNA', instrument_type: 'BALANZA', procedure: procedureTemplates.BALANZA, frequency_every: 1, frequency_unit: 'SEMANAS', responsible_group: 'MANTENIMIENTO', duration_minutes: 30, crew_size: 1, start_time: '08:00', active: true})
  const {busy, error, submit} = useSubmit(onSaved)
  const set = (key, value) => setForm(f => ({...f, [key]: value}))
  const save = e => { e.preventDefault(); submit(() => request(`/calibracion/actividades${item ? `/${item.id}` : ''}`, {method: item ? 'PUT' : 'POST', body: JSON.stringify({
    name: form.name, control_method: form.control_method, instrument_type: form.instrument_type || null, procedure: form.procedure,
    frequency_every: Number(form.frequency_every), frequency_unit: form.frequency_unit, responsible_group: form.responsible_group,
    duration_minutes: Number(form.duration_minutes), crew_size: Number(form.crew_size), start_time: form.start_time, active: form.active,
  })})) }
  return <Modal wide eyebrow="CALIBRACIÓN · ACTIVIDAD" title={item ? `Editar ${item.name}` : 'Nueva actividad de calibración'} onClose={onClose}>
    <form onSubmit={save}><div className="motor-form-grid">
      <label className="full-field">Nombre *<input required maxLength={150} value={form.name} onChange={e => set('name', e.target.value)} placeholder="Verificación semanal de balanzas" /></label>
      <label>Método de control<select value={form.control_method} onChange={e => set('control_method', e.target.value)}>{Object.entries(controlMethods).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
      <label>Tipo de instrumento<select value={form.instrument_type} onChange={e => set('instrument_type', e.target.value)}><option value="">Cualquiera</option>{Object.entries(instrumentTypes).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
      <label>Responsable sugerido<select value={form.responsible_group} onChange={e => set('responsible_group', e.target.value)}>{Object.entries(responsibleGroups).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
      <label>Frecuencia: cada<input required type="number" min="1" max="3650" value={form.frequency_every} onChange={e => set('frequency_every', e.target.value)} /></label>
      <label>Unidad<select value={form.frequency_unit} onChange={e => set('frequency_unit', e.target.value)}>{Object.entries(frequencyUnits).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
      <label>Hora sugerida<input required type="time" value={form.start_time} onChange={e => set('start_time', e.target.value)} /></label>
      <label>Duración (minutos)<input required type="number" min="1" max="10080" value={form.duration_minutes} onChange={e => set('duration_minutes', e.target.value)} /></label>
      <label>Personas<input required type="number" min="1" max="50" value={form.crew_size} onChange={e => set('crew_size', e.target.value)} /></label>
      {item && <label className="checkbox-field"><input type="checkbox" checked={form.active} onChange={e => set('active', e.target.checked)} /> Activa</label>}
      <label className="full-field">Procedimiento *<textarea required rows={8} maxLength={4000} value={form.procedure} onChange={e => set('procedure', e.target.value)} /></label>
    </div>
    {form.instrument_type && procedureTemplates[form.instrument_type] && <button type="button" className="secondary-action" onClick={() => set('procedure', procedureTemplates[form.instrument_type])}>Cargar pasos del MT/03 para {instrumentTypes[form.instrument_type].toLowerCase()}</button>}
    <p className="field-help">Editar la actividad no cambia los planes ni las órdenes ya publicadas: cada plan conserva su frecuencia y responsable.</p>
    {error && <p role="alert" className="preventive-error">{error}</p>}
    <FormActions busy={busy} onClose={onClose} /></form>
  </Modal>
}

// ---------- Plan del instrumento (matriz AMEM) ----------
export function PlanForm({request, instrument, plan, activities, options, onClose, onSaved}) {
  const external = instrument.instrument_type === 'BASCULA_CAMIONERA'
  const [form, setForm] = useState(() => plan ? {...plan, activity_id: plan.activity_id || '', start_time: hhmm(plan.start_time)}
    : {activity_id: '', control_method: external ? 'CALIBRACION_EXTERNA' : 'VERIFICACION_INTERNA', frequency_every: 1, frequency_unit: external ? 'MESES' : 'SEMANAS',
       responsible_group: external ? 'EXTERNO' : 'MANTENIMIENTO', assignee_type: external ? 'CONTRATISTA' : 'GRUPO', assigned_user_id: null, assigned_contractor_id: null,
       start_time: '08:00', next_due: today(), active: true})
  const {busy, error, submit} = useSubmit(onSaved)
  const set = (key, value) => setForm(f => ({...f, [key]: value}))
  const usable = activities.filter(a => a.active && (!a.instrument_type || a.instrument_type === instrument.instrument_type) && (!plan || a.control_method === plan.control_method))
  function chooseActivity(id) {
    const activity = activities.find(a => a.id === Number(id))
    setForm(f => activity ? {...f, activity_id: activity.id, control_method: plan ? f.control_method : activity.control_method, frequency_every: activity.frequency_every,
      frequency_unit: activity.frequency_unit, responsible_group: activity.responsible_group, start_time: hhmm(activity.start_time),
      assignee_type: activity.responsible_group === 'EXTERNO' ? 'CONTRATISTA' : f.assignee_type === 'CONTRATISTA' ? 'GRUPO' : f.assignee_type} : {...f, activity_id: ''})
  }
  const save = e => { e.preventDefault(); const body = JSON.stringify({activity_id: form.activity_id ? Number(form.activity_id) : null, control_method: form.control_method,
    frequency_every: Number(form.frequency_every), frequency_unit: form.frequency_unit, start_time: form.start_time, next_due: form.next_due, active: form.active, ...assigneePayload(form)})
    submit(() => request(plan ? `/calibracion/planes/${plan.id}` : `/calibracion/instrumentos/${instrument.id}/planes`, {method: plan ? 'PUT' : 'POST', body})) }
  return <Modal wide eyebrow="MT 03 / ANEXO 2 · MATRIZ AMEM" title={`${plan ? 'Editar plan' : 'Asignar actividad'} · ${instrument.code}`} onClose={onClose}>
    <form onSubmit={save}><div className="motor-form-grid">
      <label className="full-field">Actividad de calibración<select value={form.activity_id} onChange={e => chooseActivity(e.target.value)}><option value="">Sin actividad (plan manual)</option>{usable.map(a => <option key={a.id} value={a.id}>{a.name} · {controlMethods[a.control_method]} · {frequencyText(a)}</option>)}</select></label>
      <label>Método de control<select disabled={!!plan || !!form.activity_id} value={form.control_method} onChange={e => set('control_method', e.target.value)}>{Object.entries(controlMethods).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
      <label>Frecuencia: cada<input required type="number" min="1" max="3650" value={form.frequency_every} onChange={e => set('frequency_every', e.target.value)} /></label>
      <label>Unidad<select value={form.frequency_unit} onChange={e => set('frequency_unit', e.target.value)}>{Object.entries(frequencyUnits).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
      <label>{plan ? 'Próximo ciclo por publicar' : 'Primera fecha'}<input required type="date" value={form.next_due} onChange={e => set('next_due', e.target.value)} /></label>
      <label>Hora<input required type="time" value={form.start_time} onChange={e => set('start_time', e.target.value)} /></label>
      <AssigneeFields form={form} set={set} options={options} />
      {plan && <label className="checkbox-field"><input type="checkbox" checked={form.active} onChange={e => set('active', e.target.checked)} /> Plan activo</label>}
    </div>
    <p className="field-help">El plan genera ciclos planificados en el calendario. Para asignarlos al responsable, el administrador los publica desde <strong>Programación → Preparar / publicar</strong>. Cambiar el plan no modifica las órdenes ya publicadas.{external && ' La báscula camionera requiere control externo o legal (MT/03 8.1.4).'}</p>
    {error && <p role="alert" className="preventive-error">{error}</p>}
    <FormActions busy={busy} onClose={onClose} /></form>
  </Modal>
}

// ---------- Programación: publicar ciclos y seguir órdenes ----------
export function ScheduleTab({request, isAdmin, options, version, onRegister, onDetail, onChanged}) {
  const [month, setMonth] = useState(today().slice(0, 7))
  const [mine, setMine] = useState(!isAdmin)
  const [orders, setOrders] = useState([]), [error, setError] = useState(''), [message, setMessage] = useState('')
  const [preview, setPreview] = useState(null), [selected, setSelected] = useState([])
  const [editing, setEditing] = useState(null), [cancelling, setCancelling] = useState(null), [reason, setReason] = useState('')
  const [reload, setReload] = useState(0)
  const {start, end} = monthRange(month)
  const {busy, error: actionError, submit} = useSubmit(() => {})

  useEffect(() => {
    let active = true
    request(`/calibracion/ordenes?start=${start}&end=${end}&mine=${mine}`).then(data => { if (active) { setOrders(data); setError('') } }).catch(e => active && setError(e.message))
    return () => { active = false }
  }, [request, start, end, mine, version, reload])

  const shift = delta => { const [y, m] = month.split('-').map(Number); setMonth(isoDate(new Date(y, m - 1 + delta, 1, 12)).slice(0, 7)); setPreview(null) }
  const done = text => { setMessage(text); setReload(v => v + 1); onChanged() }
  const prepare = () => submit(async () => { setMessage(''); const data = await request(`/calibracion/proximos?start=${start}&end=${end}`); setPreview(data); setSelected(data.filter(r => !r.blocked).map(r => r.plan.id)) })
  const publish = () => submit(async () => { const result = await request('/calibracion/publicar', {method: 'POST', body: JSON.stringify({start, end, plan_ids: selected})}); setPreview(null); done(`${result.order_ids.length} orden(es) de calibración publicadas en el calendario.`) })
  const cancel = () => submit(async () => { await request(`/calibracion/ordenes/${cancelling.id}/cancelar`, {method: 'POST', body: JSON.stringify({reason})}); setCancelling(null); setReason(''); done(`Orden #${cancelling.id} cancelada.`) })

  return <>
    <div className="request-toolbar">
      <div className="calibration-month-nav"><button onClick={() => shift(-1)} aria-label="Mes anterior"><ChevronLeft size={18} /></button><strong>{monthLabel(month)}</strong><button onClick={() => shift(1)} aria-label="Mes siguiente"><ChevronRight size={18} /></button></div>
      <label className="checkbox-inline"><input type="checkbox" checked={mine} onChange={e => setMine(e.target.checked)} /> Solo mis asignaciones pendientes</label>
      {isAdmin && <button className="primary-action" disabled={busy} onClick={prepare}>Preparar / publicar calibraciones</button>}
    </div>
    {(error || actionError) && <p role="alert" className="preventive-error">{error || actionError}</p>}
    {message && <p role="status" className="calibration-ok">{message}</p>}

    {preview && <div className="calibration-publish">
      <h3>Ciclos por publicar · {monthLabel(month)}</h3>
      {!preview.length ? <p className="field-help">No hay ciclos planificados por publicar en este mes.</p> : <>
        <p className="field-help">Los ciclos atrasados que nunca se publicaron se agrupan en una sola orden para hoy. Un plan con órdenes abiertas no genera ciclos nuevos hasta cerrarlas o cancelarlas.</p>
        <div className="users-card table-scroll"><table><thead><tr><th><input type="checkbox" aria-label="Seleccionar todos" checked={selected.length === preview.filter(r => !r.blocked).length} onChange={e => setSelected(e.target.checked ? preview.filter(r => !r.blocked).map(r => r.plan.id) : [])} /></th><th>Instrumento</th><th>Actividad</th><th>Fechas</th><th>Responsable</th></tr></thead><tbody>
          {preview.map(row => <tr key={row.plan.id} className={row.blocked ? 'is-inactive' : ''}>
            <td><input type="checkbox" disabled={row.blocked} checked={selected.includes(row.plan.id)} onChange={() => setSelected(list => list.includes(row.plan.id) ? list.filter(id => id !== row.plan.id) : [...list, row.plan.id])} /></td>
            <td><strong>{row.instrument.code}</strong><br />{row.instrument.name}<br /><small>{row.instrument.area}</small></td>
            <td>{row.plan.activity_name || controlMethods[row.plan.control_method]}<br /><small>{frequencyText(row.plan)} · {row.plan.format_code}</small></td>
            <td>{row.cycles.map(c => <div key={c.due}>{c.scheduled} {hhmm(row.plan.start_time)}{c.skipped > 0 && <small className="text-danger"> · vencía {c.due}, {c.skipped} ciclo(s) omitido(s)</small>}</div>)}{row.blocked && <small className="text-danger">Tiene órdenes abiertas</small>}</td>
            <td>{row.plan.assignee}</td>
          </tr>)}
        </tbody></table></div>
        <div className="calibration-actions"><button onClick={() => setPreview(null)}>Cerrar</button><button className="primary-action" disabled={busy || !selected.length} onClick={publish}>Publicar {selected.length} plan(es)</button></div>
      </>}
    </div>}

    <h3>Órdenes de calibración publicadas</h3>
    {!orders.length ? <p className="field-help">{mine ? 'No tienes calibraciones pendientes asignadas en este mes.' : 'No hay órdenes publicadas en este mes.'}</p>
      : <div className="users-card table-scroll"><table><thead><tr><th>Fecha</th><th>Instrumento</th><th>Actividad</th><th>Responsable</th><th>Estado</th><th>Acciones</th></tr></thead><tbody>
        {orders.map(o => <tr key={o.id}>
          <td>{o.scheduled_date} {hhmm(o.start_time)}{o.rescheduled && <><br /><small title={o.change_reason || ''}>Reprogramada (vencía {o.due_date})</small></>}{o.skipped_cycles > 0 && <><br /><small>{o.skipped_cycles} ciclo(s) omitido(s)</small></>}</td>
          <td><strong>{o.instrument_code}</strong><br />{o.instrument_name}<br /><small>{o.area}{o.plant_name && ` · ${o.plant_name}`}</small></td>
          <td>{o.activity_name || controlMethods[o.control_method]}<br /><small>{controlMethods[o.control_method]} · {o.format_code}{o.duration_minutes && ` · ${durationText(o.duration_minutes)}`}</small></td>
          <td>{o.assignee}</td>
          <td><span className={`cal-status status-${o.overdue ? 'NO_CONFORME' : o.status === 'REALIZADA' ? 'CONFORME' : o.status === 'NO_CONFORME' ? 'NO_CONFORME' : 'PENDIENTE'}`}>{o.overdue && o.status === 'PROGRAMADA' ? 'Vencida' : orderStatus[o.status]}</span></td>
          <td className="calibration-row-actions">
            {o.can_execute && <button onClick={() => onRegister(o)}>{o.status === 'NO_CONFORME' ? 'Reverificar' : 'Registrar'}</button>}
            {o.last_record_id && <button onClick={() => onDetail(o.last_record_id)}>Ver registro</button>}
            {isAdmin && ['PROGRAMADA', 'NO_CONFORME'].includes(o.status) && <><button onClick={() => setEditing(o)}>Reprogramar / reasignar</button><button onClick={() => { setCancelling(o); setReason('') }}>Cancelar</button></>}
          </td>
        </tr>)}
      </tbody></table></div>}
    {orders.some(o => o.procedure) && <p className="field-help">El procedimiento de cada actividad se muestra al registrar la orden.</p>}

    {editing && <OrderEditForm request={request} order={editing} options={options} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); done(`Orden #${editing.id} actualizada.`) }} />}
    {cancelling && <Modal eyebrow={`ORDEN #${cancelling.id}`} title={`Cancelar · ${cancelling.instrument_code}`} onClose={() => setCancelling(null)}>
      <p>El ciclo quedará cancelado con su motivo. El plan no retrocede: el siguiente ciclo se publica en su fecha.</p>
      <div className="calibration-actions"><input value={reason} onChange={e => setReason(e.target.value)} maxLength={300} placeholder="Motivo de cancelación" /><button onClick={() => setCancelling(null)}>Volver</button><button className="danger-action" disabled={busy || reason.trim().length < 3} onClick={cancel}>Confirmar cancelación</button></div>
    </Modal>}
  </>
}

function OrderEditForm({request, order, options, onClose, onSaved}) {
  const [form, setForm] = useState({scheduled_date: order.scheduled_date, start_time: hhmm(order.start_time), responsible_group: order.responsible_group, assignee_type: order.assignee_type,
    assigned_user_id: order.assigned_user_id, assigned_contractor_id: order.assigned_contractor_id, reason: ''})
  const {busy, error, submit} = useSubmit(onSaved)
  const set = (key, value) => setForm(f => ({...f, [key]: value}))
  const moved = form.scheduled_date !== order.scheduled_date
  const save = e => { e.preventDefault(); submit(() => request(`/calibracion/ordenes/${order.id}`, {method: 'PUT', body: JSON.stringify({scheduled_date: form.scheduled_date, start_time: form.start_time, reason: form.reason || null, ...assigneePayload(form)})})) }
  return <Modal eyebrow={`ORDEN #${order.id}`} title={`Reprogramar / reasignar · ${order.instrument_code}`} onClose={onClose}>
    <form onSubmit={save}><div className="motor-form-grid">
      <label>Fecha<input required type="date" value={form.scheduled_date} onChange={e => set('scheduled_date', e.target.value)} /></label>
      <label>Hora<input required type="time" value={form.start_time} onChange={e => set('start_time', e.target.value)} /></label>
      <AssigneeFields form={form} set={set} options={options} />
      <label className="full-field">Motivo{moved && ' *'}<input required={moved} maxLength={300} value={form.reason} onChange={e => set('reason', e.target.value)} placeholder="Ej.: parada de línea, equipo en uso, patrón en calibración" /></label>
    </div>
    <p className="field-help">Vencimiento original del ciclo: {order.due_date}. La reprogramación no crea otra orden.</p>
    {error && <p role="alert" className="preventive-error">{error}</p>}
    <FormActions busy={busy} onClose={onClose} /></form>
  </Modal>
}
