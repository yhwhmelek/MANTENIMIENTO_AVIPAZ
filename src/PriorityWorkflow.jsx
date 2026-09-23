import {useState} from 'react'
import {NICFields,PrioritySummary,checks,feasibility,conditions} from './RequestPriority'
import SparePartPlanningPicker from './SparePartPlanningPicker'

export default function PriorityWorkflow({row,isAdmin,request,onSaved}){
  const [mode,setMode]=useState(''),[form,setForm]=useState({}),[busy,setBusy]=useState(false),[error,setError]=useState('')
  const [showParts,setShowParts]=useState(false)
  const r=row.request_data,improvement=r.maintenance_type==='MEJORA_TECNICA'
  function start(kind){
    setError('');setMode(kind)
    setForm(kind==='evaluate'?{factors:{...(r.priority_validation?.factors||r.preevaluation||{})},justification:'',technical_review:improvement?(r.priority_validation?.technical_review||{...Object.fromEntries(Object.keys(checks).map(k=>[k,{answer:'',notes:''}])),feasibility:''}):null,expected_revision:r.priority_revision||0}
      :{responsible:r.planning?.responsible||row.assignee_name||'',resources:r.planning?.resources||'',permits:r.planning?.permits||'',window:r.planning?.window||'',starts_at:r.planning?.starts_at?.slice(0,16)||'',ends_at:r.planning?.ends_at?.slice(0,16)||'',condition:r.planning?.condition||'ESPERA_RECURSOS',notes:r.planning?.notes||'',requested_parts:r.planning?.requested_parts||[],expected_revision:r.priority_revision||0})
  }
  function change(key,value){setForm(f=>({...f,[key]:value}))}
  async function save(e){
    e.preventDefault();if(busy)return;setBusy(true);setError('')
    try{
      const payload=mode==='plan'?{...form,starts_at:form.starts_at||null,ends_at:form.ends_at||null,requested_parts:(form.requested_parts||[]).map(part=>({machine_spare_part_id:Number(part.machine_spare_part_id),quantity:String(part.quantity)}))}:form
      await request(`/solicitudes-mantenimiento/${row.id}/${mode==='plan'?'programar':'evaluar'}`,{method:'POST',body:JSON.stringify(payload)})
      setMode('');onSaved()
    }catch(err){setError(err.message)}finally{setBusy(false)}
  }
  return <section className="request-detail"><PrioritySummary row={row}/>
    {showParts&&<SparePartPlanningPicker request={request} requestMachineId={r.machine_id} initial={form.requested_parts||[]} onChange={parts=>change('requested_parts',parts)} onClose={()=>setShowParts(false)}/>}
    {isAdmin&&['PENDIENTE','EN_PROCESO'].includes(row.status)&&!mode&&<div className="request-toolbar"><button type="button" onClick={()=>start('evaluate')}>{r.priority_validation?'Reevaluar prioridad':'Validar prioridad y evaluar'}</button><button type="button" disabled={!r.priority_validation} onClick={()=>start('plan')}>Programar actividad</button></div>}
    {error&&<p role="alert">{error}</p>}
    {mode&&<form onSubmit={save}><fieldset disabled={busy} className="request-fields"><h3>{mode==='evaluate'?'Evaluación oficial de Mantenimiento':'Programación de la actividad'}</h3>
      {mode==='evaluate'?<><p>Confirma o ajusta los factores. Los datos originales del solicitante se conservan.</p><NICFields value={form.factors} onChange={value=>change('factors',value)}/>
        {improvement&&<><h4>Verificación técnica</h4>{Object.entries(checks).map(([key,label])=><div className="motor-form-grid" key={key}><label>{label} *<select required value={form.technical_review[key].answer} onChange={e=>change('technical_review',{...form.technical_review,[key]:{...form.technical_review[key],answer:e.target.value}})}><option value="">Selecciona</option><option value="SI">Sí</option><option value="NO">No</option><option value="NA">No aplica</option></select></label><label>Observación<input maxLength={500} value={form.technical_review[key].notes} onChange={e=>change('technical_review',{...form.technical_review,[key]:{...form.technical_review[key],notes:e.target.value}})}/></label></div>)}
        <label>Viabilidad técnica *<select required value={form.technical_review.feasibility} onChange={e=>change('technical_review',{...form.technical_review,feasibility:e.target.value})}><option value="">Selecciona</option>{Object.entries(feasibility).map(([key,label])=><option key={key} value={key}>{label}</option>)}</select></label></>}
        <label>Observación técnica / justificación *<textarea required maxLength={2000} rows={3} value={form.justification} onChange={e=>change('justification',e.target.value)}/></label>
      </>:<><p>La falta de repuestos, recursos, permisos o ventana de parada no reduce la prioridad.</p><div className="full-field"><h4>Repuestos previstos</h4><button type="button" className="secondary-action" onClick={()=>setShowParts(true)}>Seleccionar repuestos de máquinas</button>{form.requested_parts?.length?<div className="table-scroll"><table><thead><tr><th>Repuesto</th><th>Máquina / elemento</th><th>Cantidad</th><th>Acción</th></tr></thead><tbody>{form.requested_parts.map(part=><tr key={part.machine_spare_part_id}><td>{part.internal_code} · {part.description}</td><td>{part.machine_code}{part.element_name?` / ${part.element_name}`:''}</td><td>{part.quantity} {part.unit_of_measure}</td><td><button type="button" className="secondary-action" onClick={()=>change('requested_parts',form.requested_parts.filter(item=>item.machine_spare_part_id!==part.machine_spare_part_id))}>Quitar</button></td></tr>)}</tbody></table></div>:<p>No se han seleccionado repuestos del catálogo.</p>}</div><div className="motor-form-grid">{[['responsible','Responsable / técnico ejecutor',150],['resources','Otros recursos y personal (indica No aplica si no corresponde)',1000],['permits','Permisos (indica No aplica cuando corresponda)',1000],['window','Ventana de intervención / parada',1000]].map(([key,label,max])=><label key={key}>{label} *<input required maxLength={max} value={form[key]} onChange={e=>change(key,e.target.value)}/></label>)}
        <label>Condición *<select value={form.condition} onChange={e=>change('condition',e.target.value)}>{Object.entries(conditions).map(([key,label])=><option key={key} value={key}>{label}</option>)}</select></label>
        <p className="full-field">Para habilitar «Iniciar trabajo programado», selecciona «Lista para ejecutar» cuando estén resueltos los pendientes y guarda la programación. Inicio y fin pueden ser el mismo día, con la hora de fin posterior al inicio; por ejemplo, hoy de 10:00 a 11:00.</p>
        {['starts_at','ends_at'].map((key,i)=><label key={key}>{i?'Fin programado':'Inicio programado'}<input type="datetime-local" required={form.condition==='LISTA'||Boolean(form.starts_at||form.ends_at)} value={form[key]} onChange={e=>change(key,e.target.value)}/></label>)}
        <label>Observaciones / condición pendiente<textarea required={form.condition!=='LISTA'} maxLength={1000} value={form.notes} onChange={e=>change('notes',e.target.value)}/></label></div></>}
      <div className="modal-actions"><button type="button" onClick={()=>setMode('')}>Cancelar</button><button className="primary-action">{busy?'Guardando…':'Guardar'}</button></div>
    </fieldset></form>}
    {!!r.priority_history?.length&&<details><summary>Historial de evaluaciones ({r.priority_history.length})</summary>{r.priority_history.map((v,i)=><p key={i}>{v.at} · {v.name} · N {v.factors.n}, I {v.factors.i}, C {v.factors.c} · {v.justification}</p>)}</details>}
    {!!r.planning_history?.length&&<details><summary>Historial de programación ({r.planning_history.length})</summary>{r.planning_history.map((p,i)=><div key={i}><p>{p.at} · {p.name} · {p.responsible} · {conditions[p.condition]} · {p.starts_at||'Sin fecha'} — {p.ends_at||'Sin fecha'} · Recursos: {p.resources} · Permisos: {p.permits} · Ventana: {p.window} · {p.notes}</p>{!!p.requested_parts?.length&&<ul>{p.requested_parts.map(part=><li key={part.machine_spare_part_id}>{part.internal_code} · {part.description}: {part.quantity} {part.unit_of_measure}</li>)}</ul>}</div>)}</details>}
  </section>
}
