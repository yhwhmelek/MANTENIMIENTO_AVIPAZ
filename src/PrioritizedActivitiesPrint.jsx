import {createPortal} from 'react-dom'
import {levels,conditions} from './RequestPriority'

const date=value=>value?String(value).replace('T',' ').slice(0,16):'Sin registrar'
const typeLabel={MEJORA_TECNICA:'Mejora técnica',CORRECTIVO:'Correctivo',PREVENTIVO:'Preventivo'}

export default function PrioritizedActivitiesPrint({report}){
  if(!report)return null
  const {rows,photos,filters,createdAt}=report
  return createPortal(<article className="priority-report-print">
    <header className="priority-report-header"><img src="/maintenance-request-logo.png" alt="AVIPAZ"/><div><h1>Resumen de actividades priorizadas</h1><p>Generado: {createdAt} · {rows.length} actividades</p><p>Filtros: {filters}</p></div></header>
    <p className="priority-report-order">Orden: prioridad final de mayor a menor; dentro del mismo nivel, mayor C, I y N, y luego la solicitud más antigua. Las actividades sin validar aparecen al final.</p>
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
        <p><b>Programación:</b> {plan?`${conditions[plan.condition]||plan.condition||'Sin condición'} · ${date(plan.starts_at)} a ${date(plan.ends_at)} · Responsable: ${plan.responsible||'Sin asignar'}`:'Sin programar'}</p>
        {plan?.notes&&<p><b>Observaciones:</b> {plan.notes}</p>}
        {data.image_path&&<figure>{photos[row.id]?<img src={photos[row.id]} alt={`Foto de la solicitud ${row.id}`}/>:<figcaption>Foto no disponible al generar el PDF</figcaption>}</figure>}
      </section>
    })}
  </article>,document.body)
}
