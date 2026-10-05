export const plantStaffRoles = ['MECANICO', 'ELECTRICO', 'TECNICO']

export function plantAlertMatches(work, user) {
  if (!plantStaffRoles.includes(user.rol)) return true
  // The server reads the current assignment on every refresh, including existing sessions.
  if (typeof work.alert_in_plant === 'boolean') return work.alert_in_plant
  if (user.planta_id == null) return false
  const data = work.request_data
  const machines = data.preventive?.machines || []
  return machines.length
    ? machines.some(m => Number(m.plant_id) === Number(user.planta_id))
    : Number(data.plant_id || work.machine_plant_id) === Number(user.planta_id)
}

export function plantAlertCoverage(work, user) {
  const machines = work.request_data.preventive?.machines || []
  if (!plantStaffRoles.includes(user.rol)) return machines
  const plantId = work.alert_plant_id ?? user.planta_id
  return plantId == null ? [] : machines.filter(m => Number(m.plant_id) === Number(plantId))
}
