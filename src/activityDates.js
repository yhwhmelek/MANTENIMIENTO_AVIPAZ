const FLOW_DATE_FIELDS = [
  ['Solicitud', 'requested_at'],
  ['Aceptación', 'accepted_at'],
  ['Finalización', 'completed_at'],
  ['Recepción', 'received_at'],
]

export function activityDateEntries(row) {
  return FLOW_DATE_FIELDS
    .map(([label, field]) => ({label, value: row?.[field]}))
    .filter(({value}) => value)
}

export function latestActivityDate(row) {
  const dates = activityDateEntries(row).map(({value}) => Date.parse(value)).filter(Number.isFinite)
  return dates.length ? Math.max(...dates) : 0
}

export function formatActivityDate(value) {
  return value ? String(value).replace('T', ' ').slice(0, 16) : 'Sin fecha registrada'
}
