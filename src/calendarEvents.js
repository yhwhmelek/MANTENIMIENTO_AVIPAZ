// Calendario mensual estándar de actividades: preventivos, solicitudes programadas y calibraciones.
// Cada fuente se normaliza al mismo formato de evento para que todas las vistas usen
// la misma cuadrícula, estados, colores y filtros.

export const isoDate = value => {
  const d = value instanceof Date ? value : new Date(`${value}T12:00`)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

export function addDays(value, days) {
  const d = new Date(`${isoDate(value)}T12:00`)
  d.setDate(d.getDate() + days)
  return isoDate(d)
}

export const mondayOf = value => { const d = new Date(`${isoDate(value)}T12:00`); return addDays(d, -((d.getDay() + 6) % 7)) }

// Cuadrícula mensual de lunes a domingo (5 o 6 semanas).
export function monthGrid(month) {
  const [year, monthIndex] = month.split('-').map(Number)
  const start = mondayOf(new Date(year, monthIndex - 1, 1, 12))
  const last = new Date(year, monthIndex, 0, 12)
  const end = addDays(last, 6 - ((last.getDay() + 6) % 7))
  const days = []
  for (let day = start; day <= end; day = addDays(day, 1)) days.push(day)
  const mondays = days.filter((_, index) => index % 7 === 0)
  return {start, end, days, mondays}
}

export const sources = {
  PM: 'Preventivo publicado',
  PLAN: 'Preventivo planificado',
  REQ: 'Solicitud programada',
  CAL: 'Calibración publicada',
  CALPLAN: 'Calibración planificada',
}

export const calendarStates = {
  VENCIDA: 'Vencida', PENDIENTE: 'Pendiente', PROGRAMADA: 'Programada', EN_PROCESO: 'En proceso',
  REALIZADA: 'Realizada', INCUMPLIDA: 'No conforme / no realizada', REPROGRAMADA: 'Reprogramada',
}

export const roleFilters = {MECANICO: 'Mecánico', ELECTRICO: 'Eléctrico', TECNICO: 'Técnico', EXTERNO: 'Externo / contratista'}

// Roles que ejecutan cada grupo (mismo criterio de workAssignment.js).
const groupRoles = {
  MECANICO: ['MECANICO'], ELECTRICO: ['ELECTRICO'], TECNICO: ['TECNICO'], MECANICO_ELECTRICO: ['MECANICO', 'ELECTRICO'],
  MANTENIMIENTO: ['MECANICO', 'ELECTRICO', 'TECNICO'], CONTRACTOR: ['EXTERNO'], EXTERNO: ['EXTERNO'],
}
export const rolesOf = group => groupRoles[group] || []

// ---------- Preventivos (frecuencia por calendario; igual que preventive_maintenance.next_due) ----------
export function nextPreventiveDue(current, frequency, anchorDay) {
  if (frequency.unit === 'DIAS') return addDays(current, frequency.every)
  if (frequency.unit === 'SEMANAS') return addDays(current, frequency.every * 7)
  if (frequency.unit !== 'MESES') return null
  const [year, month] = current.split('-').map(Number)
  const index = month - 1 + frequency.every
  const y = year + Math.floor(index / 12), m = index % 12 + 1
  const lastDay = new Date(y, m, 0).getDate()
  return `${y}-${String(m).padStart(2, '0')}-${String(Math.min(anchorDay, lastDay)).padStart(2, '0')}`
}

// Ciclos aún no publicados de cada plan activo, desde su próximo vencimiento.
// Los ciclos publicados ya avanzaron NextDue y aparecen como «Preventivo publicado».
export function projectPreventivePlans({plans = [], activities = [], machines = []}, start, end, today, limit = 400) {
  const events = []
  let hourPlans = 0
  for (const plan of plans) {
    const activity = activities.find(item => item.id === plan.activity_id)
    if (!plan.active || !activity?.active || !plan.next_due) continue
    const frequency = plan.frequency_override || activity.frequency
    if (!frequency || frequency.unit === 'HORAS') { hourPlans += 1; continue }
    const machine = machines.find(item => item.machine_id === plan.machine_id)
    const general = plan.scope === 'GENERAL'
    const plantNames = general ? [...new Set((plan.machine_ids || []).map(id => machines.find(m => m.machine_id === id)?.plant_name).filter(Boolean))] : [machine?.plant_name].filter(Boolean)
    const anchor = Number((plan.first_due || plan.next_due).slice(8, 10))
    let current = plan.next_due, guard = 0
    while (current && current <= end && guard < limit) {
      guard += 1
      if (current >= start) {
        events.push({
          key: `plan-${plan.id}-${current}`, source: 'PLAN', date: current, time: plan.start_time || activity.start_time,
          state: current === plan.next_due && current < today ? 'VENCIDA' : 'PROGRAMADA',
          label: general ? activity.name : machine?.name || `Máquina ${plan.machine_id}`,
          title: general ? `${activity.name} · ${plan.machine_ids?.length || 0} máquinas` : `${machine ? `${machine.asset_code} · ${machine.name}` : `Máquina ${plan.machine_id}`} · ${activity.name}`,
          details: [['Actividad', activity.name], ['Frecuencia', `Cada ${frequency.every} ${frequency.unit.toLowerCase()}`], ['Ruta', plan.route], ['Publicación', `Semana del ${mondayOf(current)} en Calendario MT/02-03`]],
          roles: rolesOf(activity.group), plants: plantNames, ref: {plan_id: plan.id},
        })
      }
      current = nextPreventiveDue(current, frequency, anchor)
    }
  }
  return {events, hourPlans}
}

// ---------- Programación semanal MT/02-03 (preventivos publicados y otras solicitudes) ----------
const weekStatus = {PENDIENTE: 'PENDIENTE', EN_PROCESO: 'EN_PROCESO', EJECUTADO: 'REALIZADA', POR_VALIDAR: 'REALIZADA', PARCIAL: 'INCUMPLIDA', NO_REALIZADO: 'INCUMPLIDA', REPROGRAMADO: 'REPROGRAMADA'}

export function weekEntryEvent(row, today) {
  const status = weekStatus[row.status] || 'PENDIENTE'
  const general = row.scope === 'GENERAL'
  return {
    key: `week-${row.key}`, source: row.preventive ? 'PM' : 'REQ', date: row.scheduled, time: row.start_time,
    state: status === 'PENDIENTE' && row.scheduled < today ? 'VENCIDA' : status,
    label: general ? row.activity : row.machine || row.activity || `Solicitud #${row.request_id}`,
    title: general ? `${row.activity} · ${row.machines?.length || 0} máquinas` : [row.machine, row.element, row.activity].filter(Boolean).join(' · '),
    details: [['Solicitud', `#${row.request_id}`], ['Ejecutor', row.assignee || 'Por aceptar'], ['Prioridad', row.priority], ['Ruta', row.route], ['Ubicación', [row.plant, row.tower].filter(Boolean).join(' · ')]],
    roles: rolesOf(row.group), plants: [...new Set(row.machines?.length ? row.machines.map(m => m.plant) : [row.plant])].filter(Boolean),
    ref: {request_id: row.request_id},
  }
}

// ---------- Calibraciones (MT/03) ----------
// kind: PLANIFICADA (ciclo aún no publicado), ORDEN (publicada y asignada) o REGISTRO (realizado sin orden).
const calibrationStates = {VENCIDA: 'VENCIDA', PENDIENTE: 'PENDIENTE', PROYECTADA: 'PROGRAMADA', REALIZADA: 'REALIZADA', NO_CONFORME: 'INCUMPLIDA'}
const methodShort = {VERIFICACION_INTERNA: 'Verif.', CALIBRACION_INTERNA: 'Cal.', CALIBRACION_EXTERNA: 'Ext.'}
const methodLong = {VERIFICACION_INTERNA: 'Verificación interna', CALIBRACION_INTERNA: 'Calibración interna', CALIBRACION_EXTERNA: 'Calibración externa'}

export function calibrationEvent(item) {
  const planned = item.kind === 'PLANIFICADA'
  const state = item.state === 'REALIZADA' && item.result === 'NO_CONFORME' ? 'INCUMPLIDA' : calibrationStates[item.state] || 'PROGRAMADA'
  const done = item.state === 'REALIZADA'
  return {
    key: `cal-${item.kind || ''}-${item.order_id || item.plan_id || ''}-${item.record_id || ''}-${item.date}`, source: planned ? 'CALPLAN' : 'CAL',
    date: item.date, time: item.time, state,
    label: `${item.instrument_code} · ${methodShort[item.control_method] || ''}`,
    title: `${item.instrument_code} · ${item.instrument_name} · ${item.activity_name || methodLong[item.control_method] || item.control_method}`,
    details: [['Responsable', item.assignee], ['Orden', item.order_id ? `#${item.order_id}${item.rescheduled ? ' (reprogramada)' : ''}` : null],
      ['Publicación', planned ? 'Pendiente: Calibración → Programación' : null], ['Formato', item.format_code],
      ['Área', [item.area, item.plant_name].filter(Boolean).join(' · ')], ['Resultado', item.result === 'NO_CONFORME' ? 'No conforme · reverificar' : item.result === 'CONFORME' ? 'Conforme' : null]],
    roles: done ? [] : item.assignee_type === 'CONTRATISTA' ? ['EXTERNO'] : rolesOf(item.responsible_group), plants: [item.plant_name].filter(Boolean),
    ref: planned ? {tab: 'schedule'} : {instrument_id: item.instrument_id, plan_id: item.plan_id, order_id: item.order_id, record_id: item.record_id, date: item.date, done},
  }
}

export function filterEvents(events, {visible, role, plant}) {
  return events.filter(event => visible.includes(event.source) && (!role || !event.roles.length || event.roles.includes(role)) && (!plant || event.plants.includes(plant)))
}
