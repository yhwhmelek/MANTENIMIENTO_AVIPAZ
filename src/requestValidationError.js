const labels = {
  repair_started_at: 'Inicio de reparación', repair_finished_at: 'Fin de reparación',
  stopped_at: 'Inicio de parada', restored_at: 'Retorno a servicio',
  work_done: 'Trabajo realizado', hour_meter: 'Horómetro', waiting_parts_minutes: 'Espera por repuestos',
  quantity: 'Cantidad', spare_part_id: 'Repuesto', notes: 'Observaciones',
}

export function requestValidationError(data) {
  if (typeof data.detail === 'string') return data.detail
  if (!Array.isArray(data.detail)) return 'No se pudo procesar la solicitud.'
  return data.detail.map(error => {
    const path = (error.loc || []).filter(part => part !== 'body')
    const field = path.map(part => typeof part === 'number' ? `fila ${part + 1}` : labels[part] || part).join(' / ')
    const message = String(error.msg || 'Valor no válido').replace(/^Value error, /, '')
    return field ? `${field}: ${message}` : message
  }).join('\n') || 'Revisa los datos de la solicitud.'
}
