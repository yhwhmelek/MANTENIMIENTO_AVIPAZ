import { useCallback, useEffect, useRef, useState } from 'react'
import { Plus, X } from 'lucide-react'
import { requestValidationError } from './requestValidationError'
import ActivityCalendar from './ActivityCalendar'
import { ActivitiesTab, ActivityForm, PlanForm, ScheduleTab } from './CalibrationPlanning'
import { Modal, useSubmit } from './calibrationUi'
import {
  actions, addDays, controlMethods, dueText, evaluatePoint, frequencyText, instrumentTypes,
  isoDate, magnitudes, pointTemplate, recordResult, statusLabels,
} from './calibrationSchedule'
import './calibration.css'

const today = () => isoDate(new Date())
const number = value => value == null || value === '' ? '' : Number(value).toLocaleString('es-EC', {maximumFractionDigits: 4})

export default function Calibration({apiUrl, token, currentUser, initialAction = null}) {
  const isAdmin = currentUser.rol === 'ADMIN'
  const [tab, setTab] = useState('calendar')
  const [instruments, setInstruments] = useState([])
  const [standards, setStandards] = useState([])
  const [activities, setActivities] = useState([])
  const [options, setOptions] = useState({users: [], contractors: []})
  const [plants, setPlants] = useState([])
  const [summary, setSummary] = useState(null)
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')
  const [modal, setModal] = useState(null)
  const [version, setVersion] = useState(0)

  const request = useCallback(async (path, options = {}) => {
    const response = await fetch(`${apiUrl}${path}`, {...options, headers: {Authorization: `Bearer ${token}`, 'Content-Type': 'application/json'}})
    const data = await response.json().catch(() => ({}))
    if (!response.ok) throw new Error(requestValidationError(data))
    return data
  }, [apiUrl, token])

  const refresh = useCallback(async () => {
    const [instrumentData, standardData, summaryData, activityData, optionData, plantData] = await Promise.all([
      request('/calibracion/instrumentos'), request('/calibracion/patrones'), request('/calibracion/resumen'), request('/calibracion/actividades'),
      request('/calibracion/responsables'), request('/plantas').catch(() => []),
    ])
    setInstruments(instrumentData); setStandards(standardData); setSummary(summaryData); setActivities(activityData); setOptions(optionData); setPlants(plantData)
  }, [request])

  useEffect(() => { let active = true; refresh().then(() => active && setError('')).catch(e => active && setError(e.message)); return () => { active = false } }, [refresh, version])

  const saved = text => { setModal(null); setMessage(text); setError(''); setVersion(v => v + 1) }
  const openRecord = (instrument, plan, scheduledFor, order = null) => { setMessage(''); setModal({kind: 'record', instrument, plan, scheduledFor, order}) }
  const openOrder = order => { const owner = instruments.find(item => item.id === order.instrument_id); openRecord(owner, owner?.plans.find(plan => plan.id === order.plan_id), order.scheduled_date, order) }
  // Acción de un evento de calibración del calendario (también llega desde el Calendario general).
  const calibrationAction = ref => {
    if (ref.tab) return setTab(ref.tab)
    if (ref.done && ref.record_id) return setModal({kind: 'detail', id: ref.record_id})
    if (ref.order_id) return request(`/calibracion/ordenes/${ref.order_id}`).then(order => order.can_execute ? openOrder(order) : order.last_record_id ? setModal({kind: 'detail', id: order.last_record_id}) : setError('Esta calibración está asignada a otro responsable.')).catch(e => setError(e.message))
    setTab('schedule')
  }
  const handled = useRef(null)
  useEffect(() => { if (initialAction && instruments.length && handled.current !== initialAction) { handled.current = initialAction; calibrationAction(initialAction) } }, [initialAction, instruments])

  const newButton = {activities: ['activity', 'Nueva actividad'], instruments: ['instrument', 'Nuevo instrumento'], standards: ['standard', 'Nuevo patrón']}[tab]
  return <section className="calibration-module">
    <div className="page-heading"><div><p className="eyebrow">MANTENIMIENTO · MT/03</p><h1>Calibración</h1><p>Actividades, planificación, publicación y registro del control metrológico de equipos e instrumentos.</p></div>
      {isAdmin && newButton && <button className="primary-action" onClick={() => setModal({kind: newButton[0]})}><Plus size={18} /> {newButton[1]}</button>}
    </div>
    <p className="calibration-draft-note">Borrador del módulo de calibración. Revisa los datos antes de usarlo como registro oficial.</p>
    {summary && <div className="calibration-summary">
      <span className={summary.overdue ? 'is-danger' : ''}>Órdenes vencidas <strong>{summary.overdue}</strong></span>
      <span>Órdenes abiertas <strong>{summary.open_orders}</strong></span>
      <span className={summary.mine ? 'is-warning' : ''}>Asignadas a mí <strong>{summary.mine}</strong></span>
      {isAdmin && <span className={summary.to_publish ? 'is-warning' : ''}>Ciclos por publicar (7 días) <strong>{summary.to_publish}</strong></span>}
      <span className={summary.nonconforming ? 'is-danger' : ''}>Instrumentos no conformes <strong>{summary.nonconforming}</strong></span>
      <span className={summary.expired_standards ? 'is-danger' : ''}>Patrones vencidos <strong>{summary.expired_standards}</strong></span>
      <span>Registros por revisar <strong>{summary.pending_review}</strong></span>
    </div>}
    <nav className="spare-parts-nav">
      {[['calendar', 'Calendario'], ['schedule', 'Programación'], ['activities', 'Actividades y frecuencias'], ['instruments', 'Instrumentos y planes'], ['records', 'Registros'], ['standards', 'Patrones']].map(([value, label]) =>
        <button key={value} aria-current={tab === value ? 'page' : undefined} onClick={() => { setTab(value); setMessage('') }}>{label}</button>)}
    </nav>
    {error && <p role="alert" className="preventive-error">{error}</p>}
    {message && <p role="status" className="calibration-ok">{message}</p>}

    {tab === 'calendar' && <ActivityCalendar request={request} sources={['CAL', 'CALPLAN', 'PM']} version={version}
      onAction={event => event.source === 'CAL' || event.source === 'CALPLAN' ? {label: event.source === 'CALPLAN' ? 'Ir a Programación' : event.ref.done ? 'Ver registro' : 'Registrar', run: () => calibrationAction(event.ref)} : null}
      note="Calibración planificada: ciclos aún no publicados. Calibración publicada: órdenes asignadas a su responsable. Los preventivos publicados se muestran como referencia." />}
    {tab === 'schedule' && <ScheduleTab request={request} isAdmin={isAdmin} options={options} version={version} onRegister={openOrder} onDetail={id => setModal({kind: 'detail', id})} onChanged={() => setVersion(v => v + 1)} />}
    {tab === 'activities' && <ActivitiesTab activities={activities} isAdmin={isAdmin} onEdit={item => setModal({kind: 'activity', item})} />}
    {tab === 'instruments' && <InstrumentsTab instruments={instruments} isAdmin={isAdmin} onEdit={item => setModal({kind: 'instrument', item})} onPlan={(instrument, plan) => setModal({kind: 'plan', instrument, plan})} onRegister={openRecord} />}
    {tab === 'records' && <RecordsTab request={request} instruments={instruments} version={version} onOpen={id => setModal({kind: 'detail', id})} />}
    {tab === 'standards' && <StandardsTab standards={standards} isAdmin={isAdmin} onEdit={item => setModal({kind: 'standard', item})} />}

    {modal?.kind === 'activity' && <ActivityForm request={request} item={modal.item} onClose={() => setModal(null)} onSaved={() => saved('Actividad de calibración guardada.')} />}
    {modal?.kind === 'instrument' && <InstrumentForm request={request} plants={plants} item={modal.item} onClose={() => setModal(null)} onSaved={() => saved('Instrumento guardado.')} />}
    {modal?.kind === 'plan' && <PlanForm request={request} instrument={modal.instrument} plan={modal.plan} activities={activities} options={options} onClose={() => setModal(null)} onSaved={() => saved('Plan guardado. Sus ciclos aparecen como planificados; publícalos desde Programación.')} />}
    {modal?.kind === 'standard' && <StandardForm request={request} item={modal.item} onClose={() => setModal(null)} onSaved={() => saved('Patrón guardado.')} />}
    {modal?.kind === 'record' && <RecordForm request={request} instruments={instruments} standards={standards} initial={modal} onClose={() => setModal(null)} onSaved={record => saved(`Registro ${record.format_code} #${record.id} guardado: ${record.result === 'CONFORME' ? 'conforme' : 'no conforme'}.`)} />}
    {modal?.kind === 'detail' && <RecordDetail request={request} id={modal.id} isAdmin={isAdmin} onClose={() => setModal(null)} onChanged={() => setVersion(v => v + 1)} />}
  </section>
}

// ---------- Instrumentos (Anexo 1) y matriz AMEM (Anexo 2) ----------
function InstrumentsTab({instruments, isAdmin, onEdit, onPlan, onRegister}) {
  const [type, setType] = useState(''), [search, setSearch] = useState(''), [showInactive, setShowInactive] = useState(false)
  const rows = instruments.filter(item => (showInactive || item.active) && (!type || item.instrument_type === type) &&
    (!search || `${item.code} ${item.name} ${item.area} ${item.brand_model || ''}`.toLowerCase().includes(search.toLowerCase())))
  return <>
    <div className="request-toolbar">
      <label>Buscar<input value={search} onChange={e => setSearch(e.target.value)} placeholder="Código, nombre o área" /></label>
      <label>Tipo<select value={type} onChange={e => setType(e.target.value)}><option value="">Todos</option>{Object.entries(instrumentTypes).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
      <label className="checkbox-inline"><input type="checkbox" checked={showInactive} onChange={e => setShowInactive(e.target.checked)} /> Mostrar inactivos</label>
    </div>
    {!rows.length ? <p className="field-help">{instruments.length ? 'Sin resultados para el filtro.' : isAdmin ? 'Registra el primer instrumento con «Nuevo instrumento» y luego asígnale una actividad de calibración.' : 'Aún no hay instrumentos registrados.'}</p>
      : <div className="users-card table-scroll"><table><thead><tr><th>Código</th><th>Equipo / instrumento</th><th>Área / planta</th><th>Rango</th><th>EMP</th><th>Estado</th><th>Planes (actividad · frecuencia · responsable)</th><th>Acciones</th></tr></thead><tbody>
        {rows.map(item => <tr key={item.id} className={item.active ? '' : 'is-inactive'}>
          <td><strong>{item.code}</strong></td>
          <td>{item.name}<br /><small>{instrumentTypes[item.instrument_type]}{item.brand_model && ` · ${item.brand_model}`}</small></td>
          <td>{item.area}{item.plant_name && <><br /><small>{item.plant_name}</small></>}</td>
          <td>{item.range_min != null || item.range_max != null ? `${number(item.range_min)} – ${number(item.range_max)} ${item.unit}` : item.unit}</td>
          <td>± {number(item.emp)} {item.unit}</td>
          <td><span className={`cal-status status-${item.status}`}>{statusLabels[item.status]}</span>{item.last_performed_on && <><br /><small>Último: {item.last_performed_on}</small></>}</td>
          <td>{!item.plans.length ? <small>Sin plan</small> : item.plans.map(plan => <div key={plan.id} className="calibration-plan-line">
            <span>{plan.activity_name ? <strong>{plan.activity_name}</strong> : controlMethods[plan.control_method]} · {frequencyText(plan)}<br /><small>Responsable: {plan.assignee} · Por publicar: {plan.next_due} <span className={plan.days_to_due < 0 ? 'text-danger' : ''}>({dueText(plan.days_to_due)})</span>{plan.open_orders > 0 && ` · ${plan.open_orders} orden(es) abierta(s)`}</small></span>
            <span className="calibration-row-actions">{item.active && <button onClick={() => onRegister(item, plan, plan.next_due)}>Registrar</button>}{isAdmin && <button onClick={() => onPlan(item, plan)}>Editar</button>}</span>
          </div>)}</td>
          <td className="calibration-row-actions">{isAdmin && <button onClick={() => onEdit(item)}>Editar</button>}{isAdmin && item.active && <button onClick={() => onPlan(item, null)}>Asignar actividad</button>}{item.active && <button onClick={() => onRegister(item, null, null)}>Registro sin plan</button>}</td>
        </tr>)}
      </tbody></table></div>}
  </>
}

function InstrumentForm({request, plants, item, onClose, onSaved}) {
  const [form, setForm] = useState(() => item ? {...item, plant_id: item.plant_id ?? '', range_min: item.range_min ?? '', range_max: item.range_max ?? '', resolution: item.resolution ?? '', brand_model: item.brand_model ?? '', notes: item.notes ?? ''}
    : {code: '', name: '', instrument_type: 'BALANZA', brand_model: '', plant_id: '', area: '', range_min: '', range_max: '', unit: 'kg', resolution: '', emp: '', criticality: 'MEDIA', notes: '', active: true})
  const {busy, error, submit} = useSubmit(onSaved)
  const set = (key, value) => setForm(f => ({...f, [key]: value}))
  const opt = value => value === '' ? null : value
  const save = e => { e.preventDefault(); submit(() => request(`/calibracion/instrumentos${item ? `/${item.id}` : ''}`, {method: item ? 'PUT' : 'POST', body: JSON.stringify({
    code: form.code, name: form.name, instrument_type: form.instrument_type, brand_model: form.brand_model, plant_id: form.plant_id ? Number(form.plant_id) : null,
    area: form.area, range_min: opt(form.range_min), range_max: opt(form.range_max), unit: form.unit, resolution: opt(form.resolution), emp: form.emp,
    criticality: form.criticality, notes: form.notes, active: form.active,
  })})) }
  return <Modal eyebrow="MT 03 / ANEXO 1" title={item ? `Editar ${item.code}` : 'Nuevo instrumento'} onClose={onClose}>
    <form onSubmit={save}><div className="motor-form-grid">
      <label>Código *<input required value={form.code} onChange={e => set('code', e.target.value)} placeholder="Ext-Bal1" /></label>
      <label>Nombre *<input required value={form.name} onChange={e => set('name', e.target.value)} placeholder="Balanza Camry" /></label>
      <label>Tipo *<select value={form.instrument_type} onChange={e => set('instrument_type', e.target.value)}>{Object.entries(instrumentTypes).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
      <label>Marca / modelo<input value={form.brand_model} onChange={e => set('brand_model', e.target.value)} /></label>
      <label>Planta<select value={form.plant_id} onChange={e => set('plant_id', e.target.value)}><option value="">Sin planta</option>{plants.map(p => <option key={p.plant_id} value={p.plant_id}>{p.name}</option>)}</select></label>
      <label>Área *<input required value={form.area} onChange={e => set('area', e.target.value)} placeholder="Producción, Despacho, Micros…" /></label>
      <label>Rango mínimo<input type="number" step="any" value={form.range_min} onChange={e => set('range_min', e.target.value)} /></label>
      <label>Rango máximo<input type="number" step="any" value={form.range_max} onChange={e => set('range_max', e.target.value)} /></label>
      <label>Unidad *<input required value={form.unit} onChange={e => set('unit', e.target.value)} placeholder="kg, °C, %HR, psi, L" /></label>
      <label>Resolución<input type="number" step="any" min="0" value={form.resolution} onChange={e => set('resolution', e.target.value)} /></label>
      <label>EMP (± en la unidad) *<input required type="number" step="any" min="0" value={form.emp} onChange={e => set('emp', e.target.value)} placeholder="0.05" /></label>
      <label>Criticidad<select value={form.criticality} onChange={e => set('criticality', e.target.value)}><option value="ALTA">Alta</option><option value="MEDIA">Media</option><option value="BAJA">Baja</option></select></label>
      <label className="full-field">Observaciones<textarea rows={2} value={form.notes} onChange={e => set('notes', e.target.value)} /></label>
      {item && <label className="checkbox-field"><input type="checkbox" checked={form.active} onChange={e => set('active', e.target.checked)} /> Activo (al desactivar se desactivan sus planes)</label>}
    </div>
    {error && <p role="alert" className="preventive-error">{error}</p>}
    <div className="calibration-actions"><button type="button" onClick={onClose}>Cancelar</button><button className="primary-action" disabled={busy}>{busy ? 'Guardando…' : 'Guardar'}</button></div></form>
  </Modal>
}

// ---------- Registro de verificación / calibración ----------
function RecordForm({request, instruments, standards, initial, onClose, onSaved}) {
  const [instrumentId, setInstrumentId] = useState(initial.instrument?.id || '')
  const instrument = instruments.find(item => item.id === Number(instrumentId))
  const order = initial.order
  const [planId, setPlanId] = useState(initial.plan?.id || '')
  const plan = instrument?.plans.find(item => item.id === Number(planId))
  const [method, setMethod] = useState(initial.plan?.control_method || 'VERIFICACION_INTERNA')
  const effectiveMethod = plan?.control_method || method
  const external = effectiveMethod === 'CALIBRACION_EXTERNA'
  const [points, setPoints] = useState(() => pointTemplate(initial.instrument?.instrument_type))
  const [common, setCommon] = useState('')
  const [form, setForm] = useState({performed_on: today(), standard_ids: [], action_taken: 'NINGUNA', area_responsible: '', external_provider: '', certificate_number: '', observations: '', result: ''})
  const {busy, error, submit} = useSubmit(onSaved)
  const set = (key, value) => setForm(f => ({...f, [key]: value}))
  const emp = instrument?.emp
  const computed = recordResult(points, emp)
  const usable = standards.filter(s => s.active)

  function chooseInstrument(id) {
    setInstrumentId(id); setPlanId('')
    setPoints(pointTemplate(instruments.find(item => item.id === Number(id))?.instrument_type))
  }
  const setPoint = (index, key, value) => setPoints(list => list.map((point, i) => i === index ? {...point, [key]: value} : point))
  const toggleStandard = id => set('standard_ids', form.standard_ids.includes(id) ? form.standard_ids.filter(x => x !== id) : [...form.standard_ids, id])

  function save(e) {
    e.preventDefault()
    const filled = points.filter(point => point.reference_value !== '' || point.measured_value !== '')
    const decimal = value => String(value).replace(',', '.')
    submit(() => request('/calibracion/registros', {method: 'POST', body: JSON.stringify({
      instrument_id: Number(instrumentId), order_id: order ? order.id : null, plan_id: plan ? plan.id : null, control_method: plan ? null : method,
      scheduled_for: initial.scheduledFor || null, performed_on: form.performed_on,
      points: filled.map(point => ({label: point.label, reference_value: decimal(point.reference_value), measured_value: decimal(point.measured_value), emp: point.emp === '' ? null : decimal(point.emp)})),
      standard_ids: form.standard_ids, result: filled.length ? null : form.result || null, action_taken: form.action_taken,
      area_responsible: form.area_responsible, external_provider: form.external_provider, certificate_number: form.certificate_number, observations: form.observations,
    })}))
  }

  const finalResult = computed || (external ? form.result : null)
  return <Modal wide eyebrow={instrument ? `REGISTRO ${plan?.format_code || ''}`.trim() : 'REGISTRO'} title={instrument ? `${controlMethods[effectiveMethod]} · ${instrument.code}` : 'Nuevo registro'} onClose={onClose}>
    <form onSubmit={save}>
      <div className="motor-form-grid">
        {order && <div className="full-field calibration-order-banner"><strong>Orden #{order.id} · {order.activity_name || controlMethods[order.control_method]}</strong><span>Programada {order.scheduled_date} · Responsable: {order.assignee}{order.status === 'NO_CONFORME' && ' · Reverificación después de ajuste'}</span>{order.procedure && <details><summary>Ver procedimiento</summary><pre>{order.procedure}</pre></details>}</div>}
        <label>Instrumento *<select required disabled={!!order} value={instrumentId} onChange={e => chooseInstrument(e.target.value)}><option value="">Selecciona…</option>{instruments.filter(i => i.active).map(i => <option key={i.id} value={i.id}>{i.code} · {i.name}</option>)}</select></label>
        <label>Plan (matriz AMEM)<select value={planId} onChange={e => setPlanId(e.target.value)} disabled={!instrument || !!order}><option value="">Sin plan (evaluación eventual, política 5.4)</option>{instrument?.plans.map(p => <option key={p.id} value={p.id}>{controlMethods[p.control_method]} · {frequencyText(p)} · vence {p.next_due}</option>)}</select></label>
        {!plan && <label>Método<select value={method} onChange={e => setMethod(e.target.value)}>{Object.entries(controlMethods).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>}
        <label>Fecha de ejecución *<input required type="date" max={today()} value={form.performed_on} onChange={e => set('performed_on', e.target.value)} /></label>
        {instrument && <p className="field-help full-field">Área: {instrument.area}{instrument.plant_name && ` · ${instrument.plant_name}`} · Rango: {number(instrument.range_min)} – {number(instrument.range_max)} {instrument.unit} · EMP: ± {number(emp)} {instrument.unit}{initial.scheduledFor && ` · Programada: ${initial.scheduledFor}`}</p>}
      </div>

      {instrument && <>
        <h3>Patrones utilizados {!external && '*'}</h3>
        {!usable.length ? <p className="field-help">No hay patrones activos. Regístralos en la pestaña Patrones (MT 03/Anexo 3).</p>
          : <div className="calibration-standards-pick">{usable.map(s => <label key={s.id} className={`checkbox-inline${s.expired ? ' is-expired' : ''}`}><input type="checkbox" disabled={s.expired} checked={form.standard_ids.includes(s.id)} onChange={() => toggleStandard(s.id)} /> {s.code} · {s.description}{s.expired && ' (vencido)'}</label>)}</div>}

        <h3>Puntos de medición {external && <small>(opcional para calibración externa)</small>}</h3>
        <div className="request-toolbar"><label>Valor patrón común<input type="number" step="any" value={common} onChange={e => setCommon(e.target.value)} placeholder="40.00" /></label><button type="button" onClick={() => setPoints(list => list.map(p => ({...p, reference_value: common})))} disabled={common === ''}>Aplicar a todos los puntos</button>
          <button type="button" onClick={() => setPoints(list => [...list, {label: `Punto ${list.length + 1}`, reference_value: common, measured_value: '', emp: ''}])}><Plus size={16} /> Agregar punto</button></div>
        {instrument.instrument_type === 'BALANZA' && <div className="calibration-eccentricity" aria-hidden="true"><span>3</span><span>4</span><span className="center">1</span><span>2</span><span>5</span></div>}
        <div className="users-card table-scroll"><table className="calibration-points"><thead><tr><th>N.°</th><th>Punto</th><th>Valor patrón</th><th>Valor medido</th><th>EMP</th><th>Error</th>{instrument.instrument_type === 'CAUDALIMETRO' && <th>% error</th>}<th>Cumple</th><th></th></tr></thead><tbody>
          {points.map((point, index) => { const result = evaluatePoint(point, emp); return <tr key={index}>
            <td>{index + 1}</td>
            <td><input value={point.label} onChange={e => setPoint(index, 'label', e.target.value)} maxLength={60} /></td>
            <td><input type="number" step="any" value={point.reference_value} onChange={e => setPoint(index, 'reference_value', e.target.value)} /></td>
            <td><input type="number" step="any" value={point.measured_value} onChange={e => setPoint(index, 'measured_value', e.target.value)} /></td>
            <td><input type="number" step="any" min="0" value={point.emp} placeholder={number(emp)} onChange={e => setPoint(index, 'emp', e.target.value)} /></td>
            <td>{result ? number(result.error) : '—'}</td>
            {instrument.instrument_type === 'CAUDALIMETRO' && <td>{result?.percent != null ? `${number(result.percent)} %` : '—'}</td>}
            <td>{result ? <span className={`cal-status status-${result.conforms ? 'CONFORME' : 'NO_CONFORME'}`}>{result.conforms ? 'S' : 'N'}</span> : '—'}</td>
            <td><button type="button" aria-label="Quitar punto" onClick={() => setPoints(list => list.filter((_, i) => i !== index))}><X size={15} /></button></td>
          </tr> })}
        </tbody></table></div>
        <p className="field-help">Error = valor medido − valor patrón. Conforme cuando |error| ≤ EMP (MT/03 6.2.4). Las filas vacías no se guardan.</p>

        <div className="motor-form-grid">
          {external && !computed && <label>Resultado del certificado *<select value={form.result} onChange={e => set('result', e.target.value)}><option value="">Selecciona…</option><option value="CONFORME">Conforme</option><option value="NO_CONFORME">No conforme</option></select></label>}
          {external && <label>Proveedor / laboratorio<input value={form.external_provider} onChange={e => set('external_provider', e.target.value)} maxLength={150} /></label>}
          {external && <label>N.° de certificado o informe *<input value={form.certificate_number} onChange={e => set('certificate_number', e.target.value)} maxLength={80} /></label>}
          <label>Acción tomada{finalResult === 'NO_CONFORME' && ' *'}<select value={form.action_taken} onChange={e => set('action_taken', e.target.value)}>{Object.entries(actions).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
          <label>Responsable de área<input value={form.area_responsible} onChange={e => set('area_responsible', e.target.value)} maxLength={150} placeholder="Nombre de quien firma por el área" /></label>
          <label className="full-field">Observaciones<textarea rows={2} value={form.observations} onChange={e => set('observations', e.target.value)} maxLength={1000} /></label>
        </div>
        {finalResult && <p className={`calibration-result result-${finalResult}`}>Resultado: {finalResult === 'CONFORME' ? 'CONFORME — el equipo puede liberarse para uso.' : 'NO CONFORME — identificar el equipo, retirarlo del uso cuando sea posible y evaluar el impacto desde la última condición conforme (políticas 5.6 y 5.7).'}</p>}
      </>}
      {error && <p role="alert" className="preventive-error">{error}</p>}
      <div className="calibration-actions"><button type="button" onClick={onClose}>Cancelar</button><button className="primary-action" disabled={busy || !instrument}>{busy ? 'Guardando…' : 'Guardar registro'}</button></div>
    </form>
  </Modal>
}

function RecordDetail({request, id, isAdmin, onClose, onChanged}) {
  const [record, setRecord] = useState(null), [voiding, setVoiding] = useState(false), [reason, setReason] = useState('')
  const {busy, error, submit} = useSubmit(data => { setRecord(data); setVoiding(false); onChanged() })
  useEffect(() => { let active = true; request(`/calibracion/registros/${id}`).then(data => active && setRecord(data)).catch(() => {}); return () => { active = false } }, [request, id])
  if (!record) return <Modal eyebrow="REGISTRO" title="Cargando…" onClose={onClose}><p>Cargando registro…</p></Modal>
  return <Modal wide eyebrow={`${record.format_code} · REGISTRO #${record.id}`} title={`${record.instrument_code} · ${record.instrument_name}`} onClose={onClose}>
    <div className="calibration-detail-grid">
      <span>Método<strong>{controlMethods[record.control_method]}</strong></span>
      <span>Área<strong>{record.area}{record.plant_name && ` · ${record.plant_name}`}</strong></span>
      <span>Programada<strong>{record.scheduled_for || '—'}</strong></span>
      <span>Ejecutada<strong>{record.performed_on}</strong></span>
      <span>Resultado<strong className={`cal-status status-${record.result}`}>{statusLabels[record.result]}</strong></span>
      <span>Acción<strong>{actions[record.action_taken]}</strong></span>
      <span>Registró<strong>{record.registered_by}</strong></span>
      <span>Responsable de área<strong>{record.area_responsible || '—'}</strong></span>
      <span>Revisión jefe de mantenimiento<strong>{record.reviewed_at ? `${record.reviewed_by} · ${String(record.reviewed_at).replace('T', ' ').slice(0, 16)}` : 'Pendiente'}</strong></span>
      {record.certificate_number && <span>Certificado<strong>{record.certificate_number}{record.external_provider && ` · ${record.external_provider}`}</strong></span>}
    </div>
    {record.voided && <p role="alert" className="preventive-error">Registro anulado: {record.void_reason}</p>}
    {!!record.standards.length && <p><strong>Patrones:</strong> {record.standards.map(s => `${s.code}${s.certificate_number ? ` (cert. ${s.certificate_number})` : ''}`).join(', ')}</p>}
    {!!record.points.length && <div className="users-card table-scroll"><table><thead><tr><th>N.°</th><th>Punto</th><th>Valor patrón</th><th>Valor medido</th><th>Error</th><th>EMP</th><th>Cumple</th></tr></thead><tbody>
      {record.points.map(p => <tr key={p.position}><td>{p.position}</td><td>{p.label}</td><td>{number(p.reference_value)}</td><td>{number(p.measured_value)}</td><td>{number(p.error)}</td><td>{number(p.emp)}</td><td><span className={`cal-status status-${p.conforms ? 'CONFORME' : 'NO_CONFORME'}`}>{p.conforms ? 'S' : 'N'}</span></td></tr>)}
    </tbody></table></div>}
    {record.observations && <p><strong>Observaciones:</strong> {record.observations}</p>}
    {error && <p role="alert" className="preventive-error">{error}</p>}
    {isAdmin && !record.voided && <div className="calibration-actions">
      {voiding ? <><input value={reason} onChange={e => setReason(e.target.value)} placeholder="Motivo de anulación" maxLength={300} /><button onClick={() => setVoiding(false)}>Cancelar</button><button className="danger-action" disabled={busy || reason.trim().length < 3} onClick={() => submit(() => request(`/calibracion/registros/${id}/anular`, {method: 'POST', body: JSON.stringify({reason})}))}>Confirmar anulación</button></>
        : <><button onClick={() => setVoiding(true)}>Anular</button>{!record.reviewed_at && <button className="primary-action" disabled={busy} onClick={() => submit(() => request(`/calibracion/registros/${id}/revisar`, {method: 'POST'}))}>Revisar y firmar</button>}</>}
    </div>}
  </Modal>
}

function RecordsTab({request, instruments, version, onOpen}) {
  const [instrumentId, setInstrumentId] = useState(''), [start, setStart] = useState(addDays(today(), -90)), [end, setEnd] = useState(today()), [includeVoided, setIncludeVoided] = useState(false)
  const [records, setRecords] = useState([]), [error, setError] = useState('')
  useEffect(() => {
    let active = true
    const query = new URLSearchParams({...(instrumentId && {instrument_id: instrumentId}), ...(start && {start}), ...(end && {end}), include_voided: includeVoided})
    request(`/calibracion/registros?${query}`).then(data => { if (active) { setRecords(data); setError('') } }).catch(e => active && setError(e.message))
    return () => { active = false }
  }, [request, instrumentId, start, end, includeVoided, version])
  return <>
    <div className="request-toolbar">
      <label>Instrumento<select value={instrumentId} onChange={e => setInstrumentId(e.target.value)}><option value="">Todos</option>{instruments.map(i => <option key={i.id} value={i.id}>{i.code} · {i.name}</option>)}</select></label>
      <label>Desde<input type="date" value={start} onChange={e => setStart(e.target.value)} /></label>
      <label>Hasta<input type="date" value={end} onChange={e => setEnd(e.target.value)} /></label>
      <label className="checkbox-inline"><input type="checkbox" checked={includeVoided} onChange={e => setIncludeVoided(e.target.checked)} /> Incluir anulados</label>
    </div>
    {error && <p role="alert" className="preventive-error">{error}</p>}
    {!records.length ? <p className="field-help">No hay registros en el período.</p> : <div className="users-card table-scroll"><table><thead><tr><th>Fecha</th><th>Formato</th><th>Instrumento</th><th>Área</th><th>Método</th><th>Resultado</th><th>Acción</th><th>Registró</th><th>Revisión</th><th></th></tr></thead><tbody>
      {records.map(r => <tr key={r.id} className={r.voided ? 'is-inactive' : ''}><td>{r.performed_on}</td><td>{r.format_code}</td><td><strong>{r.instrument_code}</strong><br />{r.instrument_name}</td><td>{r.area}</td><td>{controlMethods[r.control_method]}</td><td><span className={`cal-status status-${r.result}`}>{statusLabels[r.result]}</span>{r.voided && <><br /><small>Anulado</small></>}</td><td>{actions[r.action_taken]}</td><td>{r.registered_by}</td><td>{r.reviewed_at ? 'Revisado' : 'Pendiente'}</td><td><button className="secondary-action" onClick={() => onOpen(r.id)}>Ver</button></td></tr>)}
    </tbody></table></div>}
    <p className="field-help">Los registros no se eliminan: se anulan con motivo para conservar la trazabilidad (retención mínima de 1 año, MT/03 sección 11).</p>
  </>
}

// ---------- Patrones (Anexo 3) ----------
function StandardsTab({standards, isAdmin, onEdit}) {
  return !standards.length ? <p className="field-help">{isAdmin ? 'Registra las pesas patrón y equipos de referencia con «Nuevo patrón». Ejemplo: 10 pesas de 20 kg (MT/03 7.2.3).' : 'Aún no hay patrones registrados.'}</p>
    : <div className="users-card table-scroll"><table><thead><tr><th>Código</th><th>Descripción</th><th>Magnitud</th><th>Valor nominal</th><th>Cantidad</th><th>Clase</th><th>Certificado</th><th>Vigencia</th><th>Estado</th>{isAdmin && <th></th>}</tr></thead><tbody>
      {standards.map(s => <tr key={s.id} className={s.active ? '' : 'is-inactive'}><td><strong>{s.code}</strong></td><td>{s.description}</td><td>{magnitudes[s.magnitude]}</td><td>{number(s.nominal_value)} {s.unit}</td><td>{s.quantity}</td><td>{s.accuracy_class || '—'}</td><td>{s.certificate_number || '—'}{s.laboratory && <><br /><small>{s.laboratory}</small></>}</td><td>{s.calibrated_on || '—'} → {s.valid_until || '—'}</td><td><span className={`cal-status status-${!s.active ? 'FUERA_DE_USO' : s.expired ? 'NO_CONFORME' : 'CONFORME'}`}>{!s.active ? 'Inactivo' : s.expired ? 'Vencido' : 'Vigente'}</span></td>{isAdmin && <td><button className="secondary-action" onClick={() => onEdit(s)}>Editar</button></td>}</tr>)}
    </tbody></table></div>
}

function StandardForm({request, item, onClose, onSaved}) {
  const [form, setForm] = useState(() => item ? Object.fromEntries(Object.entries(item).map(([k, v]) => [k, v ?? ''])) : {code: '', description: '', magnitude: 'MASA', nominal_value: '', unit: 'kg', accuracy_class: '', quantity: 1, certificate_number: '', laboratory: '', calibrated_on: '', valid_until: '', notes: '', active: true})
  const {busy, error, submit} = useSubmit(onSaved)
  const set = (key, value) => setForm(f => ({...f, [key]: value}))
  const opt = value => value === '' ? null : value
  const save = e => { e.preventDefault(); submit(() => request(`/calibracion/patrones${item ? `/${item.id}` : ''}`, {method: item ? 'PUT' : 'POST', body: JSON.stringify({
    code: form.code, description: form.description, magnitude: form.magnitude, nominal_value: opt(form.nominal_value), unit: form.unit, accuracy_class: form.accuracy_class,
    quantity: Number(form.quantity), certificate_number: form.certificate_number, laboratory: form.laboratory, calibrated_on: opt(form.calibrated_on), valid_until: opt(form.valid_until), notes: form.notes, active: form.active,
  })})) }
  return <Modal eyebrow="MT 03 / ANEXO 3" title={item ? `Editar ${item.code}` : 'Nuevo patrón'} onClose={onClose}>
    <form onSubmit={save}><div className="motor-form-grid">
      <label>Código *<input required value={form.code} onChange={e => set('code', e.target.value)} placeholder="PP-20-01" /></label>
      <label>Descripción *<input required value={form.description} onChange={e => set('description', e.target.value)} placeholder="Pesa patrón 20 kg" /></label>
      <label>Magnitud<select value={form.magnitude} onChange={e => set('magnitude', e.target.value)}>{Object.entries(magnitudes).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
      <label>Valor nominal<input type="number" step="any" value={form.nominal_value} onChange={e => set('nominal_value', e.target.value)} /></label>
      <label>Unidad<input value={form.unit} onChange={e => set('unit', e.target.value)} /></label>
      <label>Cantidad<input type="number" min="1" value={form.quantity} onChange={e => set('quantity', e.target.value)} /></label>
      <label>Clase de exactitud<input value={form.accuracy_class} onChange={e => set('accuracy_class', e.target.value)} placeholder="M1, F2…" /></label>
      <label>N.° de certificado<input value={form.certificate_number} onChange={e => set('certificate_number', e.target.value)} /></label>
      <label>Laboratorio<input value={form.laboratory} onChange={e => set('laboratory', e.target.value)} /></label>
      <label>Fecha de calibración<input type="date" value={form.calibrated_on} onChange={e => set('calibrated_on', e.target.value)} /></label>
      <label>Vigente hasta<input type="date" value={form.valid_until} onChange={e => set('valid_until', e.target.value)} /></label>
      {item && <label className="checkbox-field"><input type="checkbox" checked={!!form.active} onChange={e => set('active', e.target.checked)} /> Activo</label>}
      <label className="full-field">Observaciones<textarea rows={2} value={form.notes} onChange={e => set('notes', e.target.value)} /></label>
    </div>
    <p className="field-help">Un patrón vencido no puede usarse en nuevos registros (política 5.3).</p>
    {error && <p role="alert" className="preventive-error">{error}</p>}
    <div className="calibration-actions"><button type="button" onClick={onClose}>Cancelar</button><button className="primary-action" disabled={busy}>{busy ? 'Guardando…' : 'Guardar'}</button></div></form>
  </Modal>
}
