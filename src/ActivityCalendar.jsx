import { useEffect, useMemo, useState } from 'react'
import { ChevronLeft, ChevronRight, X } from 'lucide-react'
import {
  calendarStates, calibrationEvent, filterEvents, isoDate, monthGrid, projectPreventivePlans, roleFilters, sources as sourceLabels, weekEntryEvent,
} from './calendarEvents'
import './activityCalendar.css'

const weekDays = ['Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom']
const today = () => isoDate(new Date())
const monthLabel = month => new Date(`${month}-01T12:00`).toLocaleDateString('es-EC', {month: 'long', year: 'numeric'})

// Carga y normaliza las fuentes pedidas para el rango visible. Una fuente que falla
// (por ejemplo, calibración sin migración) no impide mostrar las demás.
async function loadEvents(request, grid, wanted) {
  const current = today(), warnings = {}, events = []
  let hourPlans = 0
  const tasks = []
  if (wanted.includes('PM') || wanted.includes('REQ')) {
    tasks.push(Promise.allSettled(grid.mondays.map(week => request(`/preventivos/semana?week=${week}`))).then(results => {
      const seen = new Set()
      results.forEach(result => result.status === 'fulfilled' && (result.value.entries || []).forEach(row => {
        if (seen.has(row.key)) return
        seen.add(row.key)
        const event = weekEntryEvent(row, current)
        if (wanted.includes(event.source)) events.push(event)
      }))
      if (results.some(result => result.status === 'rejected')) warnings.PM = warnings.REQ = 'No se pudo cargar parte de la programación semanal MT/02-03.'
    }))
  }
  if (wanted.includes('PLAN')) {
    tasks.push(Promise.all([request('/preventivos/catalogo'), request('/maquinas')]).then(([catalog, machines]) => {
      const projected = projectPreventivePlans({...catalog, machines}, grid.start, grid.end, current)
      events.push(...projected.events); hourPlans = projected.hourPlans
    }).catch(() => { warnings.PLAN = 'No se pudieron proyectar los planes preventivos.' }))
  }
  if (wanted.includes('CAL') || wanted.includes('CALPLAN')) {
    tasks.push(request(`/calibracion/calendario?start=${grid.start}&end=${grid.end}`)
      .then(items => events.push(...items.map(calibrationEvent).filter(event => wanted.includes(event.source))))
      .catch(() => { warnings.CAL = warnings.CALPLAN = 'Calibración no disponible (requiere las migraciones 024 y 025).' }))
  }
  await Promise.all(tasks)
  events.sort((a, b) => a.date.localeCompare(b.date) || String(a.time || '').localeCompare(String(b.time || '')) || a.label.localeCompare(b.label))
  return {events, warnings, hourPlans}
}

function defaultAction(event) {
  if (event.ref.request_id) return {label: 'Abrir solicitud', run: () => window.dispatchEvent(new CustomEvent('maintenance-open-request', {detail: event.ref.request_id}))}
  if (event.source === 'CAL') return {label: event.ref.done ? 'Ver registro' : 'Registrar calibración', run: () => window.dispatchEvent(new CustomEvent('calibration-open', {detail: event.ref}))}
  if (event.source === 'CALPLAN') return {label: 'Ir a Programación de calibración', run: () => window.dispatchEvent(new CustomEvent('calibration-open', {detail: event.ref}))}
  if (event.source === 'PLAN') return {label: 'Ir a Preventivos', run: () => window.dispatchEvent(new CustomEvent('preventive-open-element', {detail: null}))}
  return null
}

/**
 * Calendario mensual estándar.
 * sources: fuentes disponibles ('PM', 'PLAN', 'REQ', 'CAL', 'CALPLAN'); hidden: fuentes desactivadas al inicio.
 * onAction(event): devuelve {label, run} para reemplazar la acción predeterminada de un evento.
 */
export default function ActivityCalendar({request, sources = ['PM', 'PLAN', 'REQ', 'CAL', 'CALPLAN'], hidden = [], onAction, version = 0, note}) {
  const [month, setMonth] = useState(today().slice(0, 7))
  const [data, setData] = useState({events: [], warnings: {}, hourPlans: 0})
  const [visible, setVisible] = useState(sources.filter(source => !hidden.includes(source)))
  const [role, setRole] = useState(''), [plant, setPlant] = useState('')
  const [selected, setSelected] = useState(null)
  const [loading, setLoading] = useState(false)
  const grid = useMemo(() => monthGrid(month), [month])
  const sourceKey = sources.join(',')

  useEffect(() => {
    let active = true
    setLoading(true)
    loadEvents(request, grid, sourceKey.split(',')).then(result => active && setData(result)).finally(() => active && setLoading(false))
    return () => { active = false }
  }, [request, grid, sourceKey, version])

  const shift = delta => { const [y, m] = month.split('-').map(Number); setMonth(isoDate(new Date(y, m - 1 + delta, 1, 12)).slice(0, 7)); setSelected(null) }
  const shown = filterEvents(data.events, {visible, role, plant})
  const plants = [...new Set(data.events.flatMap(event => event.plants))].sort()
  const pending = shown.filter(event => event.state === 'VENCIDA' || (event.state === 'PENDIENTE' && event.date >= grid.start))
  const warnings = visible.map(source => data.warnings[source]).filter((text, i, list) => text && list.indexOf(text) === i)
  const toggle = source => setVisible(list => list.includes(source) ? list.filter(item => item !== source) : [...list, source])
  const actionFor = event => onAction?.(event) || defaultAction(event)
  const counts = Object.fromEntries(sources.map(source => [source, shown.filter(event => event.source === source && event.date.startsWith(month)).length]))

  return <div className="activity-calendar-view">
    <div className="request-toolbar activity-calendar-toolbar">
      <div className="activity-calendar-month"><button onClick={() => shift(-1)} aria-label="Mes anterior"><ChevronLeft size={18} /></button><strong>{monthLabel(month)}</strong><button onClick={() => shift(1)} aria-label="Mes siguiente"><ChevronRight size={18} /></button><button onClick={() => { setMonth(today().slice(0, 7)); setSelected(null) }}>Hoy</button></div>
      {sources.length > 1 && sources.map(source => <label key={source} className={`activity-source-toggle src-${source}`}><input type="checkbox" checked={visible.includes(source)} onChange={() => toggle(source)} /> {sourceLabels[source]} <small>({counts[source]})</small></label>)}
      <label>Grupo<select value={role} onChange={e => setRole(e.target.value)}><option value="">Todos</option>{Object.entries(roleFilters).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
      {plants.length > 1 && <label>Planta<select value={plant} onChange={e => setPlant(e.target.value)}><option value="">Todas</option>{plants.map(p => <option key={p}>{p}</option>)}</select></label>}
      {loading && <span className="field-help">Cargando…</span>}
    </div>
    <div className="activity-legend">
      {sources.map(source => <span key={source} className={`act-chip src-${source} state-PROGRAMADA`}>{sourceLabels[source]}</span>)}
      <span className="legend-divider" />
      {['VENCIDA', 'PENDIENTE', 'EN_PROCESO', 'REALIZADA', 'INCUMPLIDA'].map(state => <span key={state} className={`act-chip state-${state}`}>{calendarStates[state]}</span>)}
    </div>
    {warnings.map(text => <p key={text} className="field-help">{text}</p>)}
    {visible.includes('PLAN') && data.hourPlans > 0 && <p className="field-help">{data.hourPlans} plan(es) por horas de funcionamiento no se proyectan por fecha: se avisan desde Horómetros y avisos.</p>}

    <div className="activity-calendar-scroll"><div className="activity-calendar">
      {weekDays.map(day => <div key={day} className="calendar-head">{day}</div>)}
      {grid.days.map(day => <div key={day} className={`calendar-day${day.slice(0, 7) !== month ? ' is-outside' : ''}${day === today() ? ' is-today' : ''}`}>
        <span className="calendar-date">{Number(day.slice(8))}</span>
        {shown.filter(event => event.date === day).map(event => <button key={event.key} className={`act-chip src-${event.source} state-${event.state}${selected?.key === event.key ? ' is-selected' : ''}`} title={`${sourceLabels[event.source]} · ${event.title} · ${calendarStates[event.state]}`} onClick={() => setSelected(event)}>
          {event.time && <span className="act-time">{String(event.time).slice(0, 5)}</span>}{event.label}
        </button>)}
      </div>)}
    </div></div>

    {selected && <EventCard event={selected} action={actionFor(selected)} onClose={() => setSelected(null)} />}
    {note && <p className="field-help">{note}</p>}

    <h3>Pendientes y vencidas</h3>
    {!pending.length ? <p className="field-help">No hay actividades pendientes o vencidas en el período visible.</p>
      : <div className="users-card table-scroll"><table><thead><tr><th>Fecha</th><th>Tipo</th><th>Actividad</th><th>Planta</th><th>Estado</th><th></th></tr></thead><tbody>
        {pending.map(event => { const action = actionFor(event); return <tr key={event.key}><td>{event.date}{event.time && <><br /><small>{String(event.time).slice(0, 5)}</small></>}</td><td><span className={`act-chip src-${event.source} state-PROGRAMADA`}>{sourceLabels[event.source]}</span></td><td>{event.title}</td><td>{event.plants.join(', ')}</td><td><span className={`act-chip state-${event.state}`}>{calendarStates[event.state]}</span></td><td>{action && <button className="secondary-action" onClick={action.run}>{action.label}</button>}</td></tr> })}
      </tbody></table></div>}
  </div>
}

function EventCard({event, action, onClose}) {
  return <div className={`activity-event-card src-${event.source}`} role="region" aria-label="Detalle de la actividad">
    <div className="activity-event-head"><div><p className="eyebrow">{sourceLabels[event.source]} · {event.date}{event.time ? ` · ${String(event.time).slice(0, 5)}` : ''}</p><strong>{event.title}</strong></div><button onClick={onClose} aria-label="Cerrar detalle"><X size={16} /></button></div>
    <dl>{[['Estado', calendarStates[event.state]], ...event.details].filter(([, value]) => value).map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}</dl>
    {action && <button className="primary-action" onClick={action.run}>{action.label}</button>}
  </div>
}
