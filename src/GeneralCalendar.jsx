import { useCallback } from 'react'
import ActivityCalendar from './ActivityCalendar'
import { requestValidationError } from './requestValidationError'

// Calendario general: todas las actividades programadas de mantenimiento en una sola vista.
export default function GeneralCalendar({apiUrl, token}) {
  const request = useCallback(async path => {
    const response = await fetch(`${apiUrl}${path}`, {headers: {Authorization: `Bearer ${token}`}})
    const data = await response.json().catch(() => ({}))
    if (!response.ok) throw new Error(requestValidationError(data))
    return data
  }, [apiUrl, token])

  return <section className="general-calendar">
    <div className="page-heading"><div><p className="eyebrow">MANTENIMIENTO</p><h1>Calendario general</h1><p>Preventivos publicados y planificados, solicitudes programadas y calibraciones en una sola vista mensual.</p></div></div>
    <ActivityCalendar request={request} sources={['PM', 'PLAN', 'REQ', 'CAL', 'CALPLAN']}
      note="Selecciona una actividad para ver su detalle. Desde el detalle puedes abrir la solicitud, registrar la calibración o ir a Preventivos." />
  </section>
}
