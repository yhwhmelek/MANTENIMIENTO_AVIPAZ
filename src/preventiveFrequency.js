export const frequencyUnits = {SEMANAS:'semanas', HORAS:'horas de funcionamiento'}
export const legacyFrequencyUnits = {DIAS:'días', MESES:'meses'}
export const frequencyLabel = frequency => frequency
  ? `Cada ${frequency.every} ${frequencyUnits[frequency.unit] || legacyFrequencyUnits[frequency.unit] || frequency.unit}`
  : 'Sin frecuencia'
export const effectiveFrequency = (plan, activity) => plan?.frequency_override || activity?.frequency
export const needsOperatingHours = (plan, activity) => effectiveFrequency(plan, activity)?.unit === 'HORAS'
export const operatingHoursNotice = 'Pendiente de registrar horas de funcionamiento. Se habilitará la programación cuando se incorporen esas lecturas.'
