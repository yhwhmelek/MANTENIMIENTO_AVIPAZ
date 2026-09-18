import {createPortal} from 'react-dom'
import {evaluationFields} from './TechnicalImprovementFields'

const stamp=value=>value?value.replace('T',' ').slice(0,16):'Pendiente'
export default function TechnicalImprovementPrint({row}){
  if(!row)return null
  const r=row.request_data,e=row.execution_data||{}
  const block=(title,text)=><section className="improvement-print-block"><h3>{title}</h3><p style={{whiteSpace:'pre-wrap'}}>{text||'Pendiente'}</p></section>
  return createPortal(<article className="request-print improvement-print">
    <header><img src="/maintenance-request-logo.png" alt="AVIPAZ" width="100"/><h1>SOLICITUD Y ORDEN DE TRABAJO DE MEJORA TÉCNICA</h1><p>CÓDIGO: MT/02-08 · VERSIÓN: 00 · Solicitud #{row.id}</p></header>
    <p>NOMBRE DEL SOLICITANTE: {r.source_requester||row.requester_name} · FECHA / HORA: {stamp(row.requested_at)}</p>
    <p>ÁREA SOLICITANTE: {r.requesting_area} · CÓDIGO: {r.machine_code}</p><p>EQUIPO / SISTEMA / ÁREA: {r.target_area||r.machine_name}</p>
    {block('SITUACIÓN ACTUAL / PROBLEMA IDENTIFICADO',r.description)}
    {block('PROPUESTA DE MEJORA',r.improvement_proposal)}
    <h3>EVALUACIÓN TÉCNICA</h3><table><thead><tr><th>Ítem</th><th>Sí</th><th>No</th><th>Observaciones</th></tr></thead><tbody>{evaluationFields.map(([key,notes,label])=><tr key={key}><td>{label}</td><td>{r.technical_evaluation?.[key]===true?'X':''}</td><td>{r.technical_evaluation?.[key]===false?'X':''}</td><td>{r.technical_evaluation?.[notes]||''}</td></tr>)}</tbody></table>
    <p className="improvement-signatures">Firma del solicitante: ____________________</p>
    <h3>RECEPCIÓN DE SOLICITUD</h3><p>RECIBIDO POR: {row.assignee_name||'Pendiente'} · FECHA / HORA: {stamp(row.accepted_at)}</p>
    <p>REALIZADO POR: {row.executor_name||'Pendiente'} · FECHA / HORA: {stamp(e.repair_finished_at)}</p>
    {block('TRABAJO REALIZADO',e.work_done)}{block('RESULTADO DE MEJORA',e.improvement_result)}
    <p className="improvement-signatures">Firma del responsable: ____________________ · Firma supervisor de mantenimiento: ____________________</p>
    <h3>MATERIALES UTILIZADOS</h3><table><thead><tr><th>Código</th><th>Material</th><th>Cantidad</th><th>Unidad</th></tr></thead><tbody>{(e.parts||[]).map(p=><tr key={p.spare_part_id}><td>{p.internal_code}</td><td>{p.description}</td><td>{p.quantity}</td><td>{p.unit_of_measure}</td></tr>)}</tbody></table>
    <p style={{whiteSpace:'pre-wrap'}}>{e.other_materials||(row.execution_data?'Sin otros materiales':'Pendiente')}</p>
    <h3>ENTREGA DE LA MEJORA</h3><p>RECIBIDO POR: {row.received_at?(row.receiver_name||row.requester_name):'Pendiente'} · FECHA / HORA: {stamp(row.received_at)}</p>
    {block('RECOMENDACIONES',e.recommendations||(row.execution_data?'No aplica':''))}{block('CONDICIONES DE ENTREGA',e.delivery_conditions||(row.execution_data?'No aplica':''))}
    <p>Conformidad: {row.receipt_notes||'Pendiente'} · Estado: {row.status}</p>
    <p className="improvement-signatures">Firma de recepción: ____________________ · Firma director de producción: ____________________</p>
  </article>,document.body)
}
