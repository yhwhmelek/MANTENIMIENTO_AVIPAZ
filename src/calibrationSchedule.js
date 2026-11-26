// Utilidades del módulo de calibración (procedimiento MT/03).

export const instrumentTypes = {
  BALANZA: 'Balanza', SISTEMA_PESAJE: 'Celdas de carga / sistema de pesaje', BASCULA_CAMIONERA: 'Báscula camionera',
  TEMPERATURA_HUMEDAD: 'Temperatura / humedad', MANOMETRO: 'Manómetro / presión', CAUDALIMETRO: 'Caudalímetro de agua', OTRO: 'Otro',
}
export const controlMethods = {VERIFICACION_INTERNA: 'Verificación interna', CALIBRACION_INTERNA: 'Calibración interna', CALIBRACION_EXTERNA: 'Calibración externa'}
export const frequencyUnits = {DIAS: 'días', SEMANAS: 'semanas', MESES: 'meses'}
export const responsibleGroups = {MANTENIMIENTO: 'Mantenimiento (todos)', MECANICO: 'Mecánico', ELECTRICO: 'Eléctrico', TECNICO: 'Técnico', EXTERNO: 'Proveedor externo'}
export const actions = {NINGUNA: 'Ninguna', AJUSTE: 'Ajuste', MANTENIMIENTO: 'Mantenimiento', CALIBRACION_EXTERNA: 'Enviar a calibración externa', RETIRO: 'Retiro del uso', REEMPLAZO: 'Reemplazo'}
export const statusLabels = {PENDIENTE: 'Sin evaluar', CONFORME: 'Conforme', NO_CONFORME: 'No conforme', FUERA_DE_USO: 'Fuera de uso'}
export const magnitudes = {MASA: 'Masa', TEMPERATURA: 'Temperatura', HUMEDAD: 'Humedad', PRESION: 'Presión', VOLUMEN: 'Volumen', OTRA: 'Otra'}
export const assigneeTypes = {GRUPO: 'Grupo de mantenimiento', USUARIO: 'Persona específica', CONTRATISTA: 'Contratista / proveedor externo'}
export const orderStatus = {PROGRAMADA: 'Programada', NO_CONFORME: 'No conforme · reverificar', REALIZADA: 'Realizada', FUERA_DE_USO: 'Cerrada · fuera de uso', CANCELADA: 'Cancelada'}

export const durationText = minutes => minutes >= 60 ? `${Math.round(minutes / 6) / 10} h` : `${minutes} min`

// Pasos base tomados del procedimiento MT/03 v06 para iniciar el procedimiento de cada actividad.
export const procedureTemplates = {
  BALANZA: `MT/03 6.1 – 6.2 · Balanzas
1. Verificar que la balanza esté limpia, nivelada, estable y sobre una superficie adecuada.
2. Confirmar que la balanza indique cero antes de iniciar.
3. Colocar la pesa patrón en el centro y en las cuatro esquinas (puntos 1 a 5), de forma estable y sin golpes.
4. Registrar valor patrón, valor medido, error y conformidad (|error| ≤ EMP).
5. Si no cumple: ajuste, mantenimiento, nueva calibración interna o retiro del uso; repetir la prueba tras el ajuste.`,
  SISTEMA_PESAJE: `MT/03 7.2 · Celdas de carga y sistemas de pesaje
1. Verificar condición de cero sin carga.
2. Inspeccionar estructura, celdas, cableado, caja suma, apoyos y acumulación de material.
3. Aplicar progresivamente las pesas patrón (200 kg ≈ 20 %) y, cuando aplique, carga por sustitución (50 % y ≥80 %).
4. Realizar al menos tres repeticiones en carga baja para evaluar repetibilidad.
5. Calcular el error y evaluarlo frente al EMP; registrar en MT/03-05.`,
  BASCULA_CAMIONERA: `MT/03 8 · Báscula camionera
1. Coordinar con Adquisiciones la calibración o control metrológico legal externo.
2. Recibir y revisar el certificado: identificación, resultados, fecha, trazabilidad y próxima intervención.
3. Verificación operativa interna: cero, limpieza de plataforma, inspección de celdas, cableado e indicador, estabilidad de lectura.`,
  TEMPERATURA_HUMEDAD: `MT/03 9.2 · Temperatura y humedad
1. Colocar el equipo verificado junto al equipo patrón calibrado y esperar la estabilización.
2. Evitar corrientes de aire, fuentes de calor, humedad localizada y radiación solar directa.
3. Tomar lecturas de temperatura cada 15 s y de humedad relativa cada 30 s.
4. Calcular el error y la repetibilidad; registrar en MT/03-03.
5. Equipo operativo fuera del EMP: retirar y reemplazar (9.3).`,
  MANOMETRO: `MT/03 9.5 · Manómetros
1. Conectar el manómetro y el patrón al mismo sistema de presión (bomba manual, banco o línea controlada).
2. Aplicar presión de forma segura y gradual en puntos del rango habitual de trabajo.
3. Registrar lectura del patrón y del manómetro; calcular el error y registrar en MT/03-06.
4. Fuera del EMP, fuga, aguja trabada o daño: retirar y reemplazar; verificar el nuevo antes de liberarlo.`,
  CAUDALIMETRO: `MT/03 10 · Caudalímetros de agua
1. Hacer circular agua hacia un recipiente de volumen conocido (≥ 20 L), con flujo estable y sin fugas.
2. Registrar lectura inicial, lectura final, volumen indicado y volumen recolectado.
3. Calcular error y % de error; evaluar frente al EMP y registrar en MT/03-07.`,
}

// Puntos sugeridos por tipo de instrumento. Se pueden editar, agregar o quitar.
const pointTemplates = {
  // Figura del formato MT/03-04: 1 centro, 2-5 esquinas (prueba de excentricidad).
  BALANZA: ['1 · Centro', '2 · Esquina inferior izquierda', '3 · Esquina superior izquierda', '4 · Esquina superior derecha', '5 · Esquina inferior derecha'],
  // MT/03 7.2.6: cero, carga baja con repeticiones, media y alta por sustitución.
  SISTEMA_PESAJE: ['Cero (0 %)', 'Carga baja ~20 % · R1', 'Carga baja ~20 % · R2', 'Carga baja ~20 % · R3', 'Carga media ~50 % (sustitución)', 'Carga alta ≥80 % (sustitución)'],
  TEMPERATURA_HUMEDAD: ['Temperatura · lectura 1', 'Temperatura · lectura 2', 'Temperatura · lectura 3', 'Humedad relativa · lectura 1', 'Humedad relativa · lectura 2', 'Humedad relativa · lectura 3'],
  MANOMETRO: ['Punto 1 · rango de trabajo', 'Punto 2 · rango de trabajo', 'Punto 3 · rango de trabajo'],
  CAUDALIMETRO: ['Prueba 1 (≥ 20 L)', 'Prueba 2 (≥ 20 L)', 'Prueba 3 (≥ 20 L)'],
}

export function pointTemplate(type) {
  return (pointTemplates[type] || ['Punto 1']).map(label => ({label, reference_value: '', measured_value: '', emp: ''}))
}

const toNumber = value => value === '' || value == null ? NaN : Number(String(value).replace(',', '.'))

// Error = valor medido − valor patrón; conforme cuando |error| ≤ EMP (MT/03 6.2.4).
// Se redondea a 4 decimales, la misma precisión que guarda la base de datos.
export function evaluatePoint(point, defaultEmp) {
  const reference = toNumber(point.reference_value), measured = toNumber(point.measured_value)
  const emp = point.emp === '' || point.emp == null ? toNumber(defaultEmp) : toNumber(point.emp)
  if ([reference, measured, emp].some(Number.isNaN)) return null
  const error = Math.round((measured - reference) * 10000) / 10000
  const percent = reference !== 0 ? Math.round(error / reference * 1000000) / 10000 : null
  return {error, percent, emp, conforms: Math.abs(error) <= emp + 1e-9}
}

export function recordResult(points, defaultEmp) {
  const evaluated = points.map(point => evaluatePoint(point, defaultEmp))
  if (!evaluated.length || evaluated.some(item => !item)) return null
  return evaluated.every(item => item.conforms) ? 'CONFORME' : 'NO_CONFORME'
}

// Utilidades de fecha compartidas con el calendario estándar.
export { addDays, isoDate, monthGrid } from './calendarEvents.js'

export const frequencyText = plan => `Cada ${plan.frequency_every} ${frequencyUnits[plan.frequency_unit] || plan.frequency_unit}`

export function dueText(days) {
  if (days == null) return ''
  if (days < 0) return `Vencida hace ${-days} día(s)`
  if (days === 0) return 'Vence hoy'
  return `En ${days} día(s)`
}
