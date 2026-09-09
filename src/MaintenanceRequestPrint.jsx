import { createPortal } from 'react-dom'
import template from './maintenance-request-template.json'

const stamp = value => value ? value.replace('T', ' ').slice(0, 16) : 'Pendiente'
const short = (value, limit = 170) => value && value.length > limit ? `${value.slice(0, limit)}… (ver anexo)` : value || ''

export default function MaintenanceRequestPrint({ row }) {
  if (!row) return null
  const r = row.request_data, e = row.execution_data || {}, parts = e.parts || [], tools = e.tools || []
  const optional = value => value || (row.execution_data ? 'No aplica' : '')
  const values = {
    A4: `NOMBRE DEL SOLICITANTE: ${row.requester_name}`, D4: `FECHA: ${row.requested_at.slice(0,10)}`, G4: `HORA: ${row.requested_at.slice(11,16)}`,
    A6: `CÓDIGO: ${r.machine_code}`, C6: `ÁREA: ${r.area || ''}`, E6: `EQUIPO: ${r.machine_name}`,
    A8: `DESCRIPCIÓN DEL DAÑO: ${short(r.description)}`,
    A17: `URGENCIA: ${r.urgency}/4\n4 Equipo parado · 3 Puede parar pronto\n2 Funciona con falla · 1 No afecta operación`,
    C17: `IMPACTO: ${r.impact}/4\n4 Para la planta · 3 Para una línea\n2 Baja rendimiento · 1 No afecta producción`,
    E17: `RIESGO: ${r.risk}/4\n4 Peligro grave · 3 Riesgo medio\n2 Riesgo bajo · 1 Sin riesgo`,
    A24: `RECIBIDO POR: ${row.assignee_name || ''}`, D24: `FECHA: ${row.accepted_at?.slice(0,10) || ''}`, G24: `HORA: ${row.accepted_at?.slice(11,16) || ''}`,
    A26: `REALIZADO POR: ${row.completed_at ? row.assignee_name : ''}`, D26: `FECHA: ${e.repair_finished_at?.slice(0,10) || ''}`, G26: `HORA: ${e.repair_finished_at?.slice(11,16) || ''}`,
    A28: `TRABAJO REALIZADO: ${short(e.work_done)}`, A32: `POSIBLES CAUSAS: ${short(optional(e.cause))}`,
    A53: `RECIBIDO POR: ${row.received_at ? row.requester_name : ''}`, D53: `FECHA: ${row.received_at?.slice(0,10) || ''}`, G53: `HORA: ${row.received_at?.slice(11,16) || ''}`,
    A55: `RECOMENDACIÓN DE CÓMO OPERAR LA MÁQUINA: ${short(optional(e.recommendations),120)}`, D55: `CONDICIONES DE ENTREGA: ${short(optional(e.delivery_conditions),120)}`,
  }
  parts.slice(0,3).forEach((part,i) => { values[`A${42+i}`] = short(part.removed_part,65); values[`D${42+i}`] = short(`${part.internal_code}: ${part.quantity} ${part.unit_of_measure} · ${part.description}`,85) })
  tools.slice(0,3).forEach((tool,i) => { values[`A${47+i}`] = tool.quantity_in; values[`B${47+i}`] = short(tool.description,55); values[`D${47+i}`] = tool.quantity_out; values[`E${47+i}`] = short(tool.description,55) })
  const scale = Math.min(1, 735 / template.rows.reduce((sum,row) => sum + row.height,0))
  return createPortal(<article className="request-print">
    <div className="request-print-form"><table><colgroup>{template.widths.map((width,i) => <col key={i} style={{width: `${100*width/template.widths.reduce((a,b)=>a+b,0)}%`}} />)}</colgroup><tbody>
      {template.rows.map((line,i) => <tr key={i} style={{height:`${line.height*scale}pt`}}>{line.cells.map(cell => <td key={cell.key} rowSpan={cell.rowSpan} colSpan={cell.colSpan} style={cell.style}>{cell.key === 'A1' ? <img src="/maintenance-request-logo.png" alt="AVIPAZ" /> : values[cell.key] ?? cell.text}</td>)}</tr>)}
    </tbody></table><p>Solicitud #{row.id} · {row.status} · Confirmaciones de usuario detalladas en el anexo.</p></div>
    <section className="request-print-annex"><h1>Anexo · Solicitud #{row.id}</h1>
      <p>{r.machine_code} · {r.machine_name} · {r.maintenance_type} · Falla: {r.failure ? 'Sí' : 'No'}</p>
      <p>Solicitada por {row.requester_name}: {stamp(row.requested_at)}. Atendida por {row.assignee_name || 'Pendiente'}: {stamp(row.accepted_at)}.</p>
      <p>Entrega registrada: {stamp(row.completed_at)}. Recepción confirmada por {row.received_at ? row.requester_name : 'Pendiente'}: {stamp(row.received_at)}.</p>
      <p>Confirmación de recepción: {row.receipt_notes || 'Pendiente'}</p>
      <h2>Datos para indicadores (hora local de Ecuador)</h2>
      <p>Detección del daño / necesidad: {stamp(r.detected_at)}.</p>
      <p>Planificado: {stamp(r.planned_start)} — {stamp(r.planned_end)}. Reparación: {stamp(e.repair_started_at)} — {stamp(e.repair_finished_at)}.</p>
      <p>Parada: {stamp(e.stopped_at || r.stopped_at)}. Retorno a servicio: {stamp(e.restored_at)}. Espera por repuestos: {e.waiting_parts_minutes ?? 'Sin registrar'} minutos.</p>
      <p>Horómetro inicial: {r.hour_meter ?? 'Sin registrar'}. Final: {e.hour_meter ?? 'Sin registrar'}. Criticidad F × I × U: {r.urgency*r.impact*r.risk}.</p>
      <p>Repuesto previsto: {r.requested_part_code || 'No indicado'}, cantidad: {r.requested_quantity || '—'}. Saldo al solicitar: {r.stock_at_request ?? 'No medido'}.</p>
      {[['Descripción del daño',r.description],['Trabajo realizado',e.work_done],['Posibles causas',optional(e.cause)],['Recomendaciones',optional(e.recommendations)],['Condiciones de entrega',optional(e.delivery_conditions)]].map(([label,text]) => <section key={label}><h2>{label}</h2><p>{text || 'Pendiente'}</p></section>)}
      <h2>Todos los repuestos utilizados</h2><table><thead><tr><th>Anterior</th><th>Nuevo / posición</th><th>Cantidad</th><th>Saldo previo</th></tr></thead><tbody>{parts.map(p=><tr key={p.spare_part_id}><td>{p.removed_part}</td><td>{p.internal_code} · {p.description} · {p.position}</td><td>{p.quantity} {p.unit_of_measure}</td><td>{p.stock_before}</td></tr>)}</tbody></table>
      <h2>Conciliación de piezas / herramientas</h2><table><thead><tr><th>Descripción</th><th>Ingreso</th><th>Salida</th></tr></thead><tbody>{tools.map((t,i)=><tr key={i}><td>{t.description}</td><td>{t.quantity_in}</td><td>{t.quantity_out}</td></tr>)}</tbody></table>
    </section>
  </article>, document.body)
}
