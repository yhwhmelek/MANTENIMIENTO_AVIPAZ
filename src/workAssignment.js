export const assignmentGroups = {
  MECANICO: {label:'Mecánico', roles:['MECANICO']},
  ELECTRICO: {label:'Eléctrico', roles:['ELECTRICO']},
  MECANICO_ELECTRICO: {label:'Mecánico / Eléctrico', roles:['MECANICO','ELECTRICO']},
  MANTENIMIENTO: {label:'Mantenimiento (todos)', roles:['MECANICO','ELECTRICO','ADMIN']},
}

export function canExecuteWork(row, user) {
  if (!row || user.rol === 'OPERADOR') return false
  const plan = row.request_data.planning
  if (!plan) return false
  if (plan.assignment_type === 'CONTRACTOR') return user.rol === 'ADMIN'
  if (row.assigned_to != null) return Number(row.assigned_to) === Number(user.id)
  const group = assignmentGroups[plan.assignment_type]
  if (group) return row.status === 'PENDIENTE' && group.roles.includes(user.rol)
  return plan.assigned_user_id != null && Number(plan.assigned_user_id) === Number(user.id)
}
