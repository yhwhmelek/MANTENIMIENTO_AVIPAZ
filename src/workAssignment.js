export const assignmentGroups = {
  MECANICO: {label:'Mecánico', roles:['MECANICO']},
  ELECTRICO: {label:'Eléctrico', roles:['ELECTRICO']},
  TECNICO: {label:'Técnico', roles:['TECNICO']},
  MECANICO_ELECTRICO: {label:'Mecánico / Eléctrico', roles:['MECANICO','ELECTRICO']},
  MANTENIMIENTO: {label:'Mantenimiento (todos)', roles:['MECANICO','ELECTRICO','TECNICO','ADMIN']},
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

// Group assignments retain their category after a technician accepts the work.
export function scheduleGroup(plan = {}) {
  if (plan.assignment_type === 'CONTRACTOR' || plan.responsible_role === 'CONTRATISTA') return {key:'CONTRATISTA', label:'Contratista'}
  const key = assignmentGroups[plan.assignment_type] ? plan.assignment_type : plan.responsible_role
  return assignmentGroups[key] ? {key, label:assignmentGroups[key].label} : {key:'SIN_GRUPO', label:'Sin grupo'}
}
