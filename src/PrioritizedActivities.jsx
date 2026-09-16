import {useState} from 'react'
import {PriorityBadge,levels,conditions} from './RequestPriority'
import {compareActivities} from './priorityOrder'

export default function PrioritizedActivities({rows,onOpen,busy}){
  const [level,setLevel]=useState(''),[type,setType]=useState('')
  const pending=rows.filter(r=>r.status!=='CERRADA')
  const sorted=pending.filter(r=>(!level||(r.priority?.level||'SIN_VALIDAR')===level)&&(!type||r.request_data.maintenance_type===type)).sort(compareActivities)
  function exportList(){
    const escape=value=>'"'+String(value??'').replace(/^[=+@\-\t\r]/,"'$&").replaceAll('"','""')+'"'
    const data=[['Solicitud','Fecha','Tipo','Equipo / area','Actividad','N solicitante','I solicitante','C solicitante','N validado','I validado','C validado','PR','Nivel base','Prioridad final','Escalamiento','Estado','Responsable','Recursos','Permisos','Ventana','Inicio programado','Fin programado','Condicion','Observaciones'],...sorted.map(row=>{
      const r=row.request_data,p=r.preevaluation||{},v=r.priority_validation?.factors||{},plan=r.planning||{}
      return [row.id,row.requested_at,r.maintenance_type,r.target_area||r.machine_name,r.description,p.n,p.i,p.c,v.n,v.i,v.c,row.priority?.score,levels[row.priority?.base],levels[row.priority?.level]||'Sin validar',row.priority?.escalated?'C=4: minimo ALTO':'',row.status,plan.responsible,plan.resources,plan.permits,plan.window,plan.starts_at,plan.ends_at,conditions[plan.condition],plan.notes]
    })].map(line=>line.map(escape).join(';')).join('\r\n')
    const url=URL.createObjectURL(new Blob(['\ufeff'+data],{type:'text/csv;charset=utf-8'})),a=document.createElement('a');a.href=url;a.download='Actividades_priorizadas.csv';a.click();setTimeout(()=>URL.revokeObjectURL(url),60000)
  }
  return <section><h3>Lista única de actividades priorizadas</h3><p>Orden: prioridad final → mayor C → mayor I → mayor N → solicitud más antigua. Las actividades sin validar aparecen al final y aún no tienen prioridad oficial.</p>
    <p>Ante peligro inminente o exigencia legal, controla la condición de inmediato según los procedimientos de seguridad aplicables, sin esperar la programación.</p>
    <div className="request-toolbar">{Object.entries(levels).map(([key,label])=><span key={key} className={`priority-badge priority-${key}`}>{label}: {pending.filter(r=>r.priority?.level===key).length}</span>)}<span>Sin validar: {pending.filter(r=>!r.priority).length}</span></div>
    <div className="request-toolbar"><label>Prioridad<select value={level} onChange={e=>setLevel(e.target.value)}><option value="">Todas</option>{Object.entries(levels).map(([key,label])=><option key={key} value={key}>{label}</option>)}<option value="SIN_VALIDAR">Sin validar</option></select></label><label>Tipo<select value={type} onChange={e=>setType(e.target.value)}><option value="">Todos</option><option value="CORRECTIVO">Correctivo</option><option value="PREVENTIVO">Preventivo</option><option value="MEJORA_TECNICA">Mejora técnica</option></select></label><button type="button" onClick={exportList}>Exportar lista CSV para Excel</button></div>
    <div className="table-scroll"><table><thead><tr><th>Orden / solicitud</th><th>Actividad</th><th>Prioridad oficial</th><th>N / I / C validados</th><th>Estado</th><th>Programación</th><th>Acción</th></tr></thead><tbody>{sorted.map((row,index)=>{const r=row.request_data,v=r.priority_validation?.factors,p=r.planning;return <tr key={row.id}><td>{index+1}. #{row.id}<br/>{row.requested_at.replace('T',' ').slice(0,16)}</td><td>{r.maintenance_type==='MEJORA_TECNICA'?'Mejora técnica':r.maintenance_type}<br/>{r.target_area||r.machine_name}<br/>{r.description}</td><td><PriorityBadge priority={row.priority}/>{row.priority?.escalated&&<p>C = 4: mínimo ALTO</p>}</td><td>{v?`${v.n} / ${v.i} / ${v.c}`:'Sin validar'}</td><td>{row.status==='POR_RECIBIR'?'Pendiente de aceptación':row.status==='EN_PROCESO'?'En proceso':'Pendiente'}</td><td>{p?<>{p.responsible}<br/>{conditions[p.condition]}<br/>{p.starts_at?.replace('T',' ')||'Sin fecha'}<br/>{p.notes}</>:'Por programar'}</td><td><button disabled={busy} onClick={()=>onOpen(row.id)}>Ver actividad</button></td></tr>})}</tbody></table></div>{!sorted.length&&<p>No hay actividades con estos filtros.</p>}
  </section>
}
