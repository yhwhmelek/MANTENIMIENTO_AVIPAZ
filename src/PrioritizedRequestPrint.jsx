import {createPortal} from 'react-dom'
import {PrioritySummary,benefits,criteria} from './RequestPriority'
const time=v=>v?v.replace('T',' ').slice(0,16):'Pendiente'

export default function PrioritizedRequestPrint({row}){
  if(!row)return null
  const r=row.request_data,e=row.execution_data||{},improvement=r.maintenance_type==='MEJORA_TECNICA'
  const block=(title,text)=><section><h3>{title}</h3><p style={{whiteSpace:'pre-wrap'}}>{text||(row.execution_data?'No aplica':'Pendiente')}</p></section>
  return createPortal(<article className="request-print improvement-print">
    <header><img src="/maintenance-request-logo.png" alt="AVIPAZ" width="100"/><h1>{improvement?'SOLICITUD Y ORDEN DE TRABAJO DE MEJORA TÉCNICA':'SOLICITUD DE MANTENIMIENTO'}</h1><p>CÓDIGO: {improvement?'MT/02-08':'MT/02-05'} · VERSIÓN: {improvement?'00':'05'} - PROPUESTA · Solicitud #{row.id}</p></header>
    <p>NOMBRE DEL SOLICITANTE: {row.requester_name} · FECHA / HORA: {time(row.requested_at)}</p>
    <p>ÁREA: {r.requesting_area||r.area} · CÓDIGO: {r.machine_code} · EQUIPO / SISTEMA / ÁREA: {r.target_area||r.machine_name}</p>
    {block(improvement?'SITUACIÓN ACTUAL / PROBLEMA IDENTIFICADO':'DESCRIPCIÓN DE LA ANOMALÍA / DAÑO',r.description)}
    {improvement&&<>{block('PROPUESTA DE MEJORA',r.improvement_proposal)}{block('BENEFICIO / RESULTADO ESPERADO',(r.benefits||[]).map(b=>benefits[b]).join(', '))}{block('OTRO / JUSTIFICACIÓN DEL BENEFICIO',r.benefit_notes)}</>}
    <h3>PREEVALUACIÓN DE PRIORIDAD — SOLICITANTE</h3><p>Según la condición observada; no requiere diagnóstico técnico.</p>
    <table><thead><tr>{criteria.map(([key,label])=><th key={key}>{label}</th>)}</tr></thead><tbody>{[4,3,2,1].map(value=><tr key={value}>{criteria.map(([key,label,options])=><td key={key}>{r.preevaluation?.[key]===value?'[X]':'[ ]'} {value} — {options[value-1]}</td>)}</tr>)}</tbody></table>
    <p className="improvement-signatures">FIRMA DEL SOLICITANTE: ____________________</p>
    {!!r.requested_parts?.length&&<><h3>REPUESTOS PREVISTOS</h3><table><thead><tr><th>Repuesto</th><th>Cantidad</th><th>Stock al solicitar</th></tr></thead><tbody>{r.requested_parts.map(p=><tr key={p.spare_part_id}><td>{p.internal_code} · {p.description}</td><td>{p.quantity} {p.unit_of_measure}</td><td>{p.stock_at_request}</td></tr>)}</tbody></table></>}
    <h3>VALIDACIÓN {improvement?'Y EVALUACIÓN TÉCNICA ':''}— MANTENIMIENTO</h3><PrioritySummary row={row}/>
    <h3>RECEPCIÓN DE {improvement?'SOLICITUD':'MANTENIMIENTO'}</h3><p>RECIBIDO / ATENDIDO POR: {row.assignee_name||'Pendiente'} · FECHA / HORA: {time(row.accepted_at)}</p>
    <p>REALIZADO POR: {row.executor_name||'Pendiente'} · FECHA / HORA: {time(e.repair_finished_at)}</p>
    {block('TRABAJO REALIZADO',e.work_done)}{block(improvement?'RESULTADO DE MEJORA':'POSIBLES CAUSAS',improvement?e.improvement_result:e.cause)}
    <p className="improvement-signatures">FIRMA DEL RESPONSABLE: ____________________ · FIRMA SUPERVISOR DE MANTENIMIENTO: ____________________</p>
    <h3>{improvement?'MATERIALES':'REPUESTOS'} UTILIZADOS</h3><table><thead><tr><th>Repuesto anterior</th><th>Nuevo / material</th><th>Cantidad / unidad</th></tr></thead><tbody>{(e.parts||[]).map(p=><tr key={p.spare_part_id}><td>{p.removed_part||'No aplica'}</td><td>{p.internal_code} · {p.description} · {p.position}</td><td>{p.quantity} {p.unit_of_measure}</td></tr>)}</tbody></table>
    {improvement&&block('OTROS MATERIALES',e.other_materials)}
    <h3>CONCILIACIÓN DE PIEZAS / HERRAMIENTAS</h3><table><thead><tr><th>Descripción</th><th>Ingreso</th><th>Salida</th></tr></thead><tbody>{(e.tools||[]).map((t,i)=><tr key={i}><td>{t.description}</td><td>{t.quantity_in}</td><td>{t.quantity_out}</td></tr>)}</tbody></table>
    <h3>{improvement?'ENTREGA DE LA MEJORA':'ENTREGA DEL TRABAJO REALIZADO AL OPERARIO'}</h3><p>RECIBIDO Y ACEPTADO POR: {row.received_at?(row.receiver_name||row.requester_name):'Pendiente'} · FECHA / HORA: {time(row.received_at)}</p>
    {block('RECOMENDACIONES',e.recommendations)}{block('CONDICIONES DE ENTREGA',e.delivery_conditions)}<p>Conformidad: {row.receipt_notes||'Pendiente de aceptación'} · Estado: {row.status}</p>
    <p className="improvement-signatures">FIRMA DE RECEPCIÓN: ____________________ · FIRMA DIRECTOR DE PRODUCCIÓN: ____________________</p>
    <h3>TIEMPOS REGISTRADOS</h3><p>Detección: {time(r.detected_at)} · Trabajo: {time(e.repair_started_at)} — {time(e.repair_finished_at)}.</p><p>Parada: {time(e.stopped_at||r.stopped_at)} · Retorno: {time(e.restored_at)} · Espera de repuestos: {e.waiting_parts_minutes??'Sin registrar'} min.</p><p>Horómetro: {r.hour_meter??'No registrado'} — {e.hour_meter??'No registrado'}. Falla correctiva: {r.failure?'Sí':'No'}.</p>
    {!!r.priority_history?.length&&<><h3>TRAZABILIDAD DE VALIDACIÓN</h3>{r.priority_history.map((v,i)=><p key={i}>{v.at} · {v.name} · N {v.factors.n}, I {v.factors.i}, C {v.factors.c} · {v.justification}</p>)}</>}
  </article>,document.body)
}
