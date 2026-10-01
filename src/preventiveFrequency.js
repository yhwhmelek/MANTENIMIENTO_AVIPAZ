export const frequencyUnits = {SEMANAS:'semanas', HORAS:'horas de funcionamiento'}
export const legacyFrequencyUnits = {DIAS:'días', MESES:'meses'}
export const frequencyLabel = frequency => !frequency ? 'Sin frecuencia' : frequency.unit==='HORAS'
  ? `Primer cambio: ${frequency.first_hours || frequency.every} h · luego cada ${frequency.every} h · avisar ${frequency.advance_hours || 0} h antes`
  : `Cada ${frequency.every} ${frequencyUnits[frequency.unit] || legacyFrequencyUnits[frequency.unit] || frequency.unit}`
export const effectiveFrequency = (plan, activity) => plan?.frequency_override || activity?.frequency
export const needsOperatingHours = (plan, activity) => effectiveFrequency(plan, activity)?.unit === 'HORAS'
export const operatingHoursNotice = 'Los avisos se calculan con las lecturas de Horómetros y avisos. Registra la lectura final al entregar el trabajo antes de resetear el PLC; el reset conserva el historial.'
