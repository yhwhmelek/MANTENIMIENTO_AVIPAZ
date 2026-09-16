const labels = {
  preevaluation: 'Preevaluación del solicitante', factors: 'Factores validados',
  n: 'Necesidad de intervención (N)', i: 'Impacto operativo (I)', c: 'Consecuencia (C)',
  technical_review: 'Verificación técnica', feasibility: 'Viabilidad técnica',
  justification: 'Observación técnica / justificación', benefits: 'Beneficio esperado',
  starts_at: 'Inicio programado', ends_at: 'Fin programado', responsible: 'Responsable',
  resources: 'Repuestos y recursos', permits: 'Permisos', window: 'Ventana de intervención',
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
