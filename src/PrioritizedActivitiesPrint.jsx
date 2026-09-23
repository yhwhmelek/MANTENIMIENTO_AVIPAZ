import {createPortal} from 'react-dom'
import {levels,conditions} from './RequestPriority'

const date=value=>value?String(value).replace('T',' ').slice(0,16):'Sin registrar'
const duration=plan=>{const total=plan.estimated_duration_days!=null||plan.estimated_duration_minutes!=null?Number(plan.estimated_duration_days||0)*1440+Number(plan.estimated_duration_minutes||0):plan.starts_at&&plan.ends_at?Math.max(1,Math.round((new Date(plan.ends_at)-new Date(plan.starts_at))/60000)):0;return `${Math.floor(total/1440)} día(s) y ${total%1440} minuto(s)`}
const typeLabel={MEJORA_TECNICA:'Mejora técnica',CORRECTIVO:'Correctivo',PREVENTIVO:'Preventivo'}

export default function PrioritizedActivitiesPrint({report}){
  if(!report)return null
  const {rows,photos,filters,createdAt}=report
  return createPortal(<article className="priority-report-print">
    <header className="priority-report-header"><img src="/maintenance-request-logo.png" alt="AVIPAZ"/><div><h1>Resumen de actividades priorizadas</h1><p>Generado: {createdAt} · {rows.length} actividades</p><p>Filtros: {filters}</p></div></header>
    <p className="priority-report-order">Orden: actividades por programar primero y programadas después; dentro de cada grupo, solicitudes sin validar y luego prioridad final de mayor a menor.</p>
    <div className="priority-report-counts">{Object.entries(levels).map(([key,label])=><span key={key}>{label}: {rows.filter(row=>row.priority?.level===key).length}</span>)}<span>Sin validar: {rows.filter(row=>!row.priority).length}</span></div>
    {rows.map((row,index)=>{
      const data=row.request_data,validation=data.priority_validation?.factors,plan=data.planning
      return <section className="priority-report-item" key={row.id}>
        <div className="priority-report-item-header"><h2>{index+1}. Solicitud #{row.id} · {typeLabel[data.maintenance_type]||data.maintenance_type}</h2><strong>{levels[row.priority?.level]||'Sin validar'}</strong></div>
        <p><b>Planta:</b> {data.plant_name||'No registrada'} · <b>Torre:</b> {data.tower_name||'Sin torre'} · <b>Equipo o área:</b> {data.target_area||data.machine_name||'No registrado'}</p>
        <p><b>Solicitante:</b> {data.source_requester||row.requester_name||'No registrado'} · <b>Fecha:</b> {date(row.requested_at)} · <b>Estado:</b> {row.status.replaceAll('_',' ')}</p>
        <p><b>Situación / actividad:</b> {data.description}</p>
        {data.maintenance_type==='MEJORA_TECNICA'&&<p><b>Propuesta:</b> {data.improvement_proposal||'Sin registrar'}</p>}
        <p><b>Prioridad:</b> {levels[row.priority?.level]||'Sin validar'}{row.priority?.score!=null?` · PR ${row.priority.score}`:''} · <b>N / I / C:</b> {validation?`${validation.n} / ${validation.i} / ${validation.c}`:'Sin validar'}</p>
        <p><b>Programación:</b> {plan?`${conditions[plan.condition]||plan.condition||'Sin condición'} · Inicio: ${date(plan.starts_at)} · Duración: ${duration(plan)} · Responsable: ${plan.responsible||'Sin asignar'}`:'Sin programar'}</p>
        {plan?.notes&&<p><b>Observaciones:</b> {plan.notes}</p>}
        {(photos[row.id]||[]).map((url,photoIndex)=><figure key={photoIndex}>{url?<img src={url} alt={`Foto ${photoIndex+1} de la solicitud ${row.id}`}/>:<figcaption>Foto {photoIndex+1} no disponible al generar el PDF</figcaption>}</figure>)}
      </section>
    })}
  </article>,document.body)
}
