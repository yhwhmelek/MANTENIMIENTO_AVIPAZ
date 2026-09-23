import {useEffect,useRef,useState} from 'react'
import {NICFields,PrioritySummary,checks,feasibility,conditions} from './RequestPriority'
import SparePartPlanningPicker from './SparePartPlanningPicker'

const localInput=()=>{const date=new Date();return `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}-${String(date.getDate()).padStart(2,'0')}T${String(date.getHours()).padStart(2,'0')}:${String(date.getMinutes()).padStart(2,'0')}`}
const roleLabel=role=>({ADMIN:'Administrador',USUARIO:'Usuario',OPERADOR:'Operador',MECANICO:'Mecánico',ELECTRICO:'Eléctrico'}[role]||role)
function savedDuration(plan){
  if(plan?.estimated_duration_days!=null||plan?.estimated_duration_minutes!=null)return {days:plan.estimated_duration_days||0,minutes:plan.estimated_duration_minutes||0}
  if(plan?.starts_at&&plan?.ends_at){const total=Math.max(1,Math.round((new Date(plan.ends_at)-new Date(plan.starts_at))/60000));return {days:Math.floor(total/1440),minutes:total%1440}}
  return {days:0,minutes:60}
}

export default function PriorityWorkflow({row,isAdmin,request,onSaved,initialMode='',onCancel,compact=false}){
  const [mode,setMode]=useState(''),[form,setForm]=useState({}),[busy,setBusy]=useState(false),[error,setError]=useState('')
  const [showParts,setShowParts]=useState(false)
  const [users,setUsers]=useState([])
  const [contractors,setContractors]=useState([])
  const opened=useRef(false)
  const r=row.request_data,improvement=r.maintenance_type==='MEJORA_TECNICA'
  async function start(kind){
    setError('')
    if(kind==='plan'&&!users.length&&!contractors.length){
      setBusy(true)
      try{const [people,external]=await Promise.all([request('/usuarios'),request('/contratistas')]);setUsers(people.filter(user=>user.activo&&['MECANICO','ELECTRICO'].includes(user.rol)));setContractors(external.filter(item=>item.active))}catch(err){setError(err.message);setBusy(false);return}
      setBusy(false)
    }
    setMode(kind)
    const duration=savedDuration(r.planning)
    setForm(kind==='evaluate'?{factors:{...(r.priority_validation?.factors||r.preevaluation||{})},justification:'',technical_review:improvement?(r.priority_validation?.technical_review||{...Object.fromEntries(Object.keys(checks).map(k=>[k,{answer:'',notes:''}])),feasibility:''}):null,expected_revision:r.priority_revision||0}
      :{assignment_type:r.planning?.assignment_type||'USER',assigned_user_id:r.planning?.assigned_user_id||row.assigned_to||'',contractor_id:r.planning?.contractor_id||'',resources:r.planning?.resources||'',permits:r.planning?.permits||'',window:r.planning?.window||'',starts_at:r.planning?.starts_at?.slice(0,16)||localInput(),estimated_duration_days:duration.days,estimated_duration_minutes:duration.minutes,condition:r.planning?.condition||'ESPERA_RECURSOS',notes:r.planning?.notes||'',requested_parts:r.planning?.requested_parts||[],expected_revision:r.priority_revision||0})
  }
  function change(key,value){setForm(f=>({...f,[key]:value}))}
  async function save(e){
    e.preventDefault();if(busy)return;setBusy(true);setError('')
    try{
      const payload=mode==='plan'?{...form,assigned_user_id:form.assignment_type==='USER'?Number(form.assigned_user_id):null,contractor_id:form.assignment_type==='CONTRACTOR'?Number(form.contractor_id):null,starts_at:form.starts_at||null,estimated_duration_days:Number(form.estimated_duration_days),estimated_duration_minutes:Number(form.estimated_duration_minutes),requested_parts:(form.requested_parts||[]).map(part=>({machine_spare_part_id:Number(part.machine_spare_part_id),quantity:String(part.quantity)}))}:form
      await request(`/solicitudes-mantenimiento/${row.id}/${mode==='plan'?'programar':'evaluar'}`,{method:'POST',body:JSON.stringify(payload)})
      setMode('');onSaved();onCancel?.()
    }catch(err){setError(err.message)}finally{setBusy(false)}
  }
  useEffect(()=>{if(initialMode&&!opened.current){opened.current=true;start(initialMode)}},[initialMode,row.id])
  return <section className="request-detail">{!compact&&<PrioritySummary row={row}/>}
    {showParts&&<SparePartPlanningPicker request={request} requestMachineId={r.machine_id} initial={form.requested_parts||[]} onChange={parts=>change('requested_parts',parts)} onClose={()=>setShowParts(false)}/>}
    {!compact&&isAdmin&&['PENDIENTE','EN_PROCESO'].includes(row.status)&&!mode&&<div className="request-toolbar"><button type="button" disabled={busy} onClick={()=>start('evaluate')}>{r.priority_validation?'Reevaluar prioridad':'Validar prioridad y evaluar'}</button><button type="button" disabled={busy||!r.priority_validation} onClick={()=>start('plan')}>Programar actividad</button></div>}
    {error&&<p role="alert">{error}</p>}
    {mode&&<form onSubmit={save}><fieldset disabled={busy} className="request-fields"><h3>{mode==='evaluate'?'Evaluación oficial de Mantenimiento':'Programación de la actividad'}</h3>
      {mode==='evaluate'?<><p>Confirma o ajusta los factores. Los datos originales del solicitante se conservan.</p><NICFields value={form.factors} onChange={value=>change('factors',value)}/>
        {improvement&&<><h4>Verificación técnica</h4>{Object.entries(checks).map(([key,label])=><div className="motor-form-grid" key={key}><label>{label} *<select required value={form.technical_review[key].answer} onChange={e=>change('technical_review',{...form.technical_review,[key]:{...form.technical_review[key],answer:e.target.value}})}><option value="">Selecciona</option><option value="SI">Sí</option><option value="NO">No</option><option value="NA">No aplica</option></select></label><label>Observación<input maxLength={500} value={form.technical_review[key].notes} onChange={e=>change('technical_review',{...form.technical_review,[key]:{...form.technical_review[key],notes:e.target.value}})}/></label></div>)}
        <label>Viabilidad técnica *<select required value={form.technical_review.feasibility} onChange={e=>change('technical_review',{...form.technical_review,feasibility:e.target.value})}><option value="">Selecciona</option>{Object.entries(feasibility).map(([key,label])=><option key={key} value={key}>{label}</option>)}</select></label></>}
        <label>Observación técnica / justificación *<textarea required maxLength={2000} rows={3} value={form.justification} onChange={e=>change('justification',e.target.value)}/></label>
      </>:<><p>La falta de repuestos, recursos, permisos o ventana de parada no reduce la prioridad.</p><div className="full-field"><h4>Repuestos previstos</h4><button type="button" className="secondary-action" onClick={()=>setShowParts(true)}>Seleccionar repuestos de máquinas</button>{form.requested_parts?.length?<div className="table-scroll"><table><thead><tr><th>Repuesto</th><th>Máquina / elemento</th><th>Cantidad</th><th>Acción</th></tr></thead><tbody>{form.requested_parts.map(part=><tr key={part.machine_spare_part_id}><td>{part.internal_code} · {part.description}</td><td>{part.machine_code}{part.element_name?` / ${part.element_name}`:''}</td><td>{part.quantity} {part.unit_of_measure}</td><td><button type="button" className="secondary-action" onClick={()=>change('requested_parts',form.requested_parts.filter(item=>item.machine_spare_part_id!==part.machine_spare_part_id))}>Quitar</button></td></tr>)}</tbody></table></div>:<p>No se han seleccionado repuestos del catálogo.</p>}</div><div className="motor-form-grid"><label>Tipo de responsable *<select value={form.assignment_type} onChange={e=>change('assignment_type',e.target.value)}><option value="USER">Mecánico / Eléctrico</option><option value="CONTRACTOR">Contratista</option></select></label>{form.assignment_type==='USER'?<label>Usuario responsable *<select required value={form.assigned_user_id} onChange={e=>change('assigned_user_id',e.target.value)}><option value="">Selecciona un usuario</option>{users.map(user=><option key={user.id} value={user.id}>{user.nombre_completo||user.nombre} · {roleLabel(user.rol)}</option>)}</select></label>:<label>Contratista responsable *<select required value={form.contractor_id} onChange={e=>change('contractor_id',e.target.value)}><option value="">Selecciona un contratista</option>{contractors.map(item=><option key={item.id} value={item.id}>{item.name} · {roleLabel(item.specialty)}</option>)}</select></label>}{[['resources','Otros recursos y personal (indica No aplica si no corresponde)',1000],['permits','Permisos (indica No aplica cuando corresponda)',1000],['window','Ventana de intervención / parada',1000]].map(([key,label,max])=><label key={key}>{label} *<input required maxLength={max} value={form[key]} onChange={e=>change(key,e.target.value)}/></label>)}
        <label>Condición *<select value={form.condition} onChange={e=>change('condition',e.target.value)}>{Object.entries(conditions).map(([key,label])=><option key={key} value={key}>{label}</option>)}</select></label>
        <p className="full-field">La fecha de inicio se completa con el momento actual y puede modificarse. Indica cuánto se estima que durará la actividad; el fin previsto se calcula automáticamente.</p>
        <label>Inicio programado<input type="datetime-local" required value={form.starts_at} onChange={e=>change('starts_at',e.target.value)}/></label>
        <label>Duración estimada: días<input type="number" min="0" max="3650" step="1" required value={form.estimated_duration_days} onChange={e=>change('estimated_duration_days',e.target.value)}/></label>
        <label>Duración estimada: minutos adicionales<input type="number" min="0" max="1439" step="1" required value={form.estimated_duration_minutes} onChange={e=>change('estimated_duration_minutes',e.target.value)}/><span className="field-help">Entre 0 y 1439 minutos, adicionales a los días.</span></label>
        <label>Observaciones / condición pendiente<textarea required={form.condition!=='LISTA'} maxLength={1000} value={form.notes} onChange={e=>change('notes',e.target.value)}/></label></div></>}
      <div className="modal-actions"><button type="button" onClick={()=>{setMode('');onCancel?.()}}>Cancelar</button><button className="primary-action">{busy?'Guardando…':'Guardar'}</button></div>
    </fieldset></form>}
    {!!r.priority_history?.length&&<details><summary>Historial de evaluaciones ({r.priority_history.length})</summary>{r.priority_history.map((v,i)=><p key={i}>{v.at} · {v.name} · N {v.factors.n}, I {v.factors.i}, C {v.factors.c} · {v.justification}</p>)}</details>}
    {!!r.planning_history?.length&&<details><summary>Historial de programación ({r.planning_history.length})</summary>{r.planning_history.map((p,i)=>{const duration=savedDuration(p);return <div key={i}><p>{p.at} · {p.name} · {p.responsible} · {conditions[p.condition]} · Inicio: {p.starts_at||'Sin fecha'} · Duración: {duration.days} día(s) y {duration.minutes} minuto(s) · Recursos: {p.resources} · Permisos: {p.permits} · Ventana: {p.window} · {p.notes}</p>{!!p.requested_parts?.length&&<ul>{p.requested_parts.map(part=><li key={part.machine_spare_part_id}>{part.internal_code} · {part.description}: {part.quantity} {part.unit_of_measure}</li>)}</ul>}</div>})}</details>}
  </section>
}
