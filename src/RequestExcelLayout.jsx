import templates from './updated-request-templates.json'
import {benefits,levels,feasibility} from './RequestPriority'

const short=(value,limit=200)=>String(value??'').length>limit?String(value).slice(0,limit)+'… (ver anexo)':String(value??'')
export default function RequestExcelLayout({row}){
  const r=row.request_data,e=row.execution_data||{},improvement=r.maintenance_type==='MEJORA_TECNICA'
  const template=templates[improvement?'improvement':'maintenance'],pre=r.preevaluation||{},v=r.priority_validation
  const values={A4:`NOMBRE DEL SOLICITANTE: ${short(row.requester_name,65)}`,E4:`FECHA: ${row.requested_at?.slice(0,10)||''}`,G4:`HORA: ${row.requested_at?.slice(11,16)||''}`,
    A6:improvement?`ÁREA SOLICITANTE: ${short(r.requesting_area,50)}`:`CÓDIGO: ${r.machine_code||''}`,
    C6:improvement?`CÓDIGO: ${r.machine_code||''}`:`ÁREA: ${short(r.area,50)}`,
    E6:`EQUIPO / SISTEMA / ÁREA: ${short(r.target_area||r.machine_name,90)}`,
    A8:`${improvement?'SITUACIÓN ACTUAL / PROBLEMA IDENTIFICADO':'DESCRIPCIÓN DE LA ANOMALÍA / DAÑO'}:\n${short(r.description,420)}`}
  const first=improvement?24:16,selected=improvement?28:20,preRow=improvement?34:26,official=preRow+1
  for(const [key,col] of [['n','A'],['i','C'],['c','F']]){
    for(let n=4;n>=1;n--){const ref=`${col}${first+4-n}`,cell=template.rows.flatMap(r=>r.cells).find(c=>c.key===ref);values[ref]=(cell?.text||'').replace('☐',pre[key]===n?'☒':'☐')}
    values[`${col}${selected}`]=`${key.toUpperCase()} seleccionado: ${pre[key]??'Sin valorar'}`
  }
  for(const [key,col] of [['n','C'],['i','D'],['c','E']]){values[`${col}${preRow}`]=pre[key]??'';values[`${col}${official}`]=v?.factors[key]??''}
  values[`F${preRow}`]=pre.n&&pre.i&&pre.c?pre.n*pre.i*pre.c:''
  values[`F${official}`]=row.priority?.score??'';values[`G${official}`]=levels[row.priority?.level]||'Sin validar'
  values[improvement?'A44':'A28']=`OBSERVACIÓN TÉCNICA / JUSTIFICACIÓN:\n${short(v?.justification,300)}${row.priority?.escalated?'\nC = 4: mínimo ALTO.':''}`
  function person(line,label,name,date){values[`A${line}`]=`${label}: ${short(name,65)}`;values[`E${line}`]=`FECHA: ${date?.slice(0,10)||''}`;values[`G${line}`]=`HORA: ${date?.slice(11,16)||''}`}
  person(improvement?49:33,'RECIBIDO POR',row.assignee_name,row.accepted_at)
  person(improvement?51:35,'REALIZADO POR',row.completed_at?(row.executor_name||row.assignee_name):'',e.repair_finished_at)
  person(improvement?73:64,'RECIBIDO POR',row.received_at?(row.receiver_name||row.requester_name):'',row.received_at)
  values[improvement?'A53':'A37']=`TRABAJO REALIZADO:\n${short(e.work_done,420)}`
  values[improvement?'A58':'A42']=`${improvement?'RESULTADO DE MEJORA':'POSIBLES CAUSAS'}:\n${short(improvement?e.improvement_result:e.cause,420)}`
  values[improvement?'A75':'A66']=`RECOMENDACIONES:\n${short(e.recommendations,200)}`
  values[improvement?'E75':'E66']=`CONDICIONES DE ENTREGA:\n${short(e.delivery_conditions,200)}`
  if(improvement){
    values.A12=`PROPUESTA DE MEJORA:\n${short(r.improvement_proposal,420)}`
    const mark=key=>`${r.benefits?.includes(key)?'☒':'☐'} ${benefits[key]}`
    values.A18=['SEGURIDAD','PRODUCCION','CALIDAD','AMBIENTE'].map(mark).join('  ')
    values.E18=['ERGONOMIA','COSTOS','CONFIABILIDAD','LEGAL'].map(mark).join('  ')
    values.A19=`OTRO / JUSTIFICACIÓN: ${short(r.benefit_notes,140)}`
    const review=v?.technical_review
    ;['shutdown','materials','modification','training','safety'].forEach((key,i)=>{const line=i+38;for(const [answer,col] of [['SI','E'],['NO','F'],['NA','G']])values[`${col}${line}`]=review?.[key].answer===answer?'☒':'☐';values[`H${line}`]=short(review?.[key].notes,35)})
    values.C43=Object.entries(feasibility).map(([key,label])=>`${review?.feasibility===key?'☒':'☐'} ${label}`).join('  ')
    const materials=(e.parts||[]).map(p=>`${p.internal_code} · ${p.description}: ${p.quantity} ${p.unit_of_measure}`)
    if(e.other_materials)materials.push(e.other_materials)
    for(let i=0;i<4;i++)values[`A${66+i}`]=`${i+1}.- ${short(materials[i],130)}`
  }else{
    for(let i=0;i<3;i++){const p=e.parts?.[i];values[`A${51+i}`]=short(p?.removed_part,100);values[`E${51+i}`]=p?short(`${p.internal_code} · ${p.description}: ${p.quantity} ${p.unit_of_measure}`,110):''}
    for(let i=0;i<4;i++){const t=e.tools?.[i];values[`A${57+i}`]=t?.quantity_in??'';values[`C${57+i}`]=short(t?.description,55);values[`E${57+i}`]=t?.quantity_out??'';values[`G${57+i}`]=short(t?.description,55)}
  }
  return <>{[template.rows.filter(r=>r.number<template.split),template.rows.filter(r=>r.number>=template.split)].map((rows,page)=><section className="excel-request-page" key={page}>
    {page===1&&<p className="excel-continuation">AVIPAZ · {improvement?'MT/02-08':'MT/02-05'} · Solicitud #{row.id} · Continuación</p>}
    <table className="excel-request-table"><colgroup>{Array.from({length:8},(_,i)=><col key={i} style={{width:'12.5%'}}/>)}</colgroup><tbody>{rows.map(line=><tr key={line.number} style={{height:`${line.height*0.75}pt`}}>{line.cells.map(cell=><td key={cell.key} rowSpan={cell.rowSpan} colSpan={cell.colSpan} style={cell.style}>{cell.key==='A1'?<img src="/maintenance-request-logo.png" alt="AVIPAZ"/>:values[cell.key]??cell.text}</td>)}</tr>)}</tbody></table>
    <p className="excel-continuation">Solicitud #{row.id} · Hoja {page+1} del formulario · Información completa, materiales adicionales y confirmaciones en el anexo.</p>
  </section>)}</>
}
