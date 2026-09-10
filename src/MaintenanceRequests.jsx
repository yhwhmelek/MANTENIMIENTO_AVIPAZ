import { useEffect, useRef, useState } from 'react'
import { Bell, X } from 'lucide-react'
import MaintenanceRequestPrint from './MaintenanceRequestPrint'
import OperatingPeriods from './OperatingPeriods'
import { requestValidationError } from './requestValidationError'

const states = { PENDIENTE:'Pendiente', EN_PROCESO:'En proceso', POR_RECIBIR:'Por recibir', CERRADA:'Cerrada' }
const time = value => value ? value.replace('T',' ').slice(0,16) : '—'
const localInput = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}T${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}` }
function Field({label,name,type='text',value,onChange,...props}) { return <label>{label}<input name={name} type={type} value={value ?? ''} onChange={e=>onChange(name,e.target.value)} {...props}/></label> }
function Text({label,name,form,change,maxLength=1000,required=true,placeholder}) { return <label className="full-field">{label}{!required && ' (opcional)'}<textarea required={required} placeholder={placeholder ?? (required ? undefined : 'No aplica si se deja vacío')} rows={3} maxLength={maxLength} value={form[name] || ''} onChange={e=>change(name,e.target.value)}/></label> }

export default function MaintenanceRequests({ apiUrl, token, currentUser, open, onOpen, onClose }) {
  const [rows,setRows] = useState([]), [machines,setMachines] = useState([]), [parts,setParts] = useState([])
  const [error,setError] = useState(''), [formError,setFormError] = useState(''), [busy,setBusy] = useState(false)
  const [loaded,setLoaded] = useState(false), [catalogReady,setCatalogReady] = useState(false)
  const [selected,setSelected] = useState(null), [form,setForm] = useState(null), [mode,setMode] = useState('')
  const [filter,setFilter] = useState(''), [version,setVersion] = useState(0), [printRow,setPrintRow] = useState(null)
  const [showPeriods,setShowPeriods] = useState(false)
  const dialog=useRef(null), submitting=useRef(false)
  const detail=useRef(null)
  const isAdmin=currentUser.rol==='ADMIN'
  const canCreate=['ADMIN','OPERADOR'].includes(currentUser.rol)
  const actionCount=rows.filter(r=>(r.status==='PENDIENTE' && isAdmin) || (r.status==='EN_PROCESO' && isAdmin) || (r.status==='POR_RECIBIR' && (isAdmin || r.requested_by===currentUser.id))).length
  async function request(path,options={}) {
    const response=await fetch(`${apiUrl}${path}`,{...options,headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'}})
    const data=await response.json().catch(()=>({}))
    if (!response.ok) throw new Error(requestValidationError(data))
    return data
  }
  useEffect(()=>{
    const controller=new AbortController(); let pending=false
    async function refresh(){
      if(pending || controller.signal.aborted)return
      pending=true
      try{const data=await request('/solicitudes-mantenimiento',{signal:controller.signal});setRows(data);setError('');setLoaded(true)}
      catch(err){if(err.name!=='AbortError')setError(err.message)}finally{pending=false}
    }
    refresh(); const timer=setInterval(refresh,30000);window.addEventListener('focus',refresh)
    return()=>{controller.abort();clearInterval(timer);window.removeEventListener('focus',refresh)}
  },[apiUrl,token,version,open])
  useEffect(()=>{
    if(open)dialog.current?.showModal();else dialog.current?.close()
  },[open])
  useEffect(()=>{
    if(!open)return
    const controller=new AbortController();setCatalogReady(false)
    Promise.all(['/maquinas','/repuestos'].map(path=>request(path,{signal:controller.signal})))
      .then(([m,p])=>{setMachines(m);setParts(p.filter(x=>x.active));setCatalogReady(true)})
      .catch(err=>{if(err.name!=='AbortError')setFormError(err.message)})
    return()=>controller.abort()
  },[open,apiUrl,token])
  useEffect(()=>{
    if(!printRow)return
    let cancelled=false
    document.body.classList.add('maintenance-request-printing')
    const reset=()=>{document.body.classList.remove('maintenance-request-printing');setPrintRow(null)}
    window.addEventListener('afterprint',reset)
    const img=document.querySelector('.request-print img')
    Promise.all([document.fonts.ready,img?.decode().catch(()=>{})]).then(()=>{if(!cancelled)window.print()})
    return()=>{cancelled=true;window.removeEventListener('afterprint',reset);document.body.classList.remove('maintenance-request-printing')}
  },[printRow])
  useEffect(()=>{const refresh=()=>setVersion(v=>v+1);window.addEventListener('maintenance-flow-deleted',refresh);return()=>window.removeEventListener('maintenance-flow-deleted',refresh)},[])
  const row=rows.find(r=>r.id===selected)
  const showingDetail=Boolean(row && !form && !showPeriods)
  useEffect(()=>{
    if(open && showingDetail){
      detail.current?.focus({preventScroll:true})
      if(dialog.current)dialog.current.scrollTop=0
    }
  },[open,showingDetail,row?.id])
  function change(name,value){setForm(f=>({...f,[name]:value,...(name==='urgency' && Number(value)!==4 ? {stopped_at:''} : {})}))}
  function start(modeName){
    setMode(modeName);setFormError('')
    if(modeName==='new')setForm({maintenance_type:'CORRECTIVO',urgency:'',impact:'3',risk:'2',failure:false,description:'',detected_at:localInput()})
    if(modeName==='complete'){
      const original=row.request_data
      const plannedPart=original.requested_part_id
      const available=parts.some(part=>String(part.spare_part_id)===String(plannedPart))
      setForm({repair_started_at:row.accepted_at.slice(0,16),repair_finished_at:localInput(),
        stopped_at:original.stopped_at?.slice(0,16)||'',restored_at:original.stopped_at?localInput():'',
        hour_meter:original.hour_meter??'',waiting_parts_minutes:'0',work_done:original.description||'',
        parts:plannedPart?[{spare_part_id:available?String(plannedPart):'',quantity:String(original.requested_quantity??1),removed_part:'',position:''}]:[],tools:[]})
      if(plannedPart&&!available)setFormError(`El repuesto previsto ${original.requested_part_code || plannedPart} ya no est? disponible en el cat?logo activo. Selecciona otro repuesto o quita la fila si no se utiliz?.`)
    }
    if(modeName==='receive')setForm({notes:''})
  }
  async function mutate(suffix,payload){
    if(submitting.current)return
    submitting.current=true;setBusy(true);setFormError('')
    try{const result=await request(`/solicitudes-mantenimiento${suffix}`,{method:'POST',body:payload?JSON.stringify(payload):undefined});setSelected(result.id);setForm(null);setMode('');setVersion(v=>v+1);window.dispatchEvent(new Event('stock-updated'))}
    catch(err){setFormError(err.message)}finally{submitting.current=false;setBusy(false)}
  }
  async function deleteRequest(){
    if(currentUser.rol!=='ADMIN'||submitting.current||!window.confirm(`?Eliminar definitivamente la solicitud #${selected}, su intervenci?n, todos sus consumos y confirmaciones? Se recalcular? el stock. Esta acci?n no se puede deshacer.`))return
    submitting.current=true;setBusy(true);setFormError('')
    try{
      await request(`/solicitudes-mantenimiento/${selected}`,{method:'DELETE'})
      setRows(items=>items.filter(item=>item.id!==selected));setSelected(null)
      window.dispatchEvent(new Event('stock-updated'));window.dispatchEvent(new Event('maintenance-flow-deleted'))
    }catch(err){setFormError(err.message)}finally{submitting.current=false;setBusy(false)}
  }
  function save(event){
    event.preventDefault();const payload={...form}
    if(submitting.current)return
    if(mode==='receive' && !window.confirm('Al aceptar, confirmas que recibiste el trabajo y estás conforme con la entrega. Si no ingresaste observaciones, se registrará «Entrega conforme». ¿Deseas aceptar?'))return
    if(mode==='new'){
      for(const key of ['machine_id','urgency','impact','risk'])payload[key]=Number(payload[key])
      for(const key of ['stopped_at','planned_start','planned_end','hour_meter','requested_part_id','requested_quantity'])payload[key]=payload[key]||null
      if(payload.requested_part_id)payload.requested_part_id=Number(payload.requested_part_id)
    }
    if(mode==='complete'){
      for(const key of ['stopped_at','restored_at','hour_meter'])payload[key]=payload[key]||null
      payload.waiting_parts_minutes=Number(payload.waiting_parts_minutes)
      payload.parts=payload.parts.map(p=>({...p,spare_part_id:Number(p.spare_part_id)}))
      payload.tools=payload.tools.map(t=>({...t,quantity_in:Number(t.quantity_in),quantity_out:Number(t.quantity_out)}))
    }
    mutate(mode==='new'?'':`/${selected}/${mode==='complete'?'completar':'recibir'}`,payload)
  }
  function updateLine(kind,index,key,value){setForm(f=>({...f,[kind]:f[kind].map((line,i)=>i===index?{...line,[key]:value}:line)}))}
  return <>
    <button className={`request-alert-trigger ${actionCount||error?'needs-attention':''}`} onClick={onOpen}><Bell size={18}/><span role="status">{error?'Solicitudes sin verificar':loaded?`Solicitudes por atender: ${actionCount}`:'Consultando solicitudes…'}</span></button>
    <dialog ref={dialog} className="request-workspace" aria-labelledby="requests-title" onCancel={e=>{if(busy)e.preventDefault()}} onClose={onClose}>
      <div className="modal-header"><h2 id="requests-title">Solicitudes de mantenimiento</h2><button aria-label="Cerrar solicitudes" disabled={busy} onClick={onClose}><X/></button></div>
      <p>Generar → atender por otra persona → entregar y consumir repuestos → confirmar recepción por el solicitante.</p>
      <button className="secondary-action" disabled={busy||!!form} onClick={()=>setShowPeriods(v=>!v)}>{showPeriods?'Volver a solicitudes':'Datos de operación para indicadores'}</button>
      {showPeriods ? <OperatingPeriods request={request} machines={machines} canCreate={canCreate&&catalogReady}/> : <>
      <div className="request-toolbar">{canCreate&&<button className="primary-action" disabled={busy||!catalogReady} onClick={()=>{setSelected(null);start('new')}}>Generar solicitud</button>}<button className="secondary-action" disabled={busy} onClick={()=>setVersion(v=>v+1)}>Actualizar listado</button><label>Estado <select value={filter} onChange={e=>setFilter(e.target.value)}><option value="">Todos</option>{Object.entries(states).map(([key,label])=><option key={key} value={key}>{label}</option>)}</select></label></div>
      {error&&<p role="alert">{error}</p>}{formError&&<p role="alert">{formError}</p>}
      {!loaded&&!error&&<p>Cargando solicitudes…</p>}
      {!form&&!row&&<div className="table-scroll"><table><thead><tr><th>Solicitud</th><th>Equipo / daño</th><th>Solicitante</th><th>Estado</th><th>Responsable</th><th>Acción</th></tr></thead><tbody>{rows.filter(r=>!filter||r.status===filter).map(r=><tr key={r.id}><td>#{r.id}<br/>{time(r.requested_at)}</td><td>{r.request_data.machine_code}<br/>{r.request_data.description.slice(0,80)}</td><td>{r.requester_name}</td><td>{states[r.status]}</td><td>{r.assignee_name||'Sin asignar'}</td><td><button className="secondary-action" disabled={busy} onClick={()=>{setSelected(r.id);setFormError('')}}>Ver solicitud</button></td></tr>)}</tbody></table>{loaded&&!rows.length&&<p>No hay solicitudes registradas.</p>}</div>}
      {row&&!form&&<section ref={detail} tabIndex={-1} aria-label={`Detalle de solicitud ${row.id}`} className="request-detail"><button type="button" className="secondary-action" disabled={busy} onClick={()=>{setSelected(null);setFormError('')}}>Volver al listado</button><h3>Solicitud #{row.id} · {states[row.status]}</h3><p>{row.request_data.machine_name} · {row.request_data.description}</p><p>Tipo: {row.request_data.maintenance_type}. Falla: {row.request_data.failure?'Sí':'No'}. Criticidad: {row.request_data.urgency*row.request_data.impact*row.request_data.risk}.</p><p>Planificado: {time(row.request_data.planned_start)} a {time(row.request_data.planned_end)}. Parada: {time(row.request_data.stopped_at)}.</p>
        {row.request_data.requested_part_id&&<p>Repuesto previsto: {row.request_data.requested_part_code} · {row.request_data.requested_quantity}. Stock al solicitar: {row.request_data.stock_at_request} ({row.request_data.stock_sufficient?'suficiente':'insuficiente'}).</p>}
        {row.execution_data&&<><h4>Trabajo entregado</h4><p>Realizado por: {row.executor_name || row.assignee_name}</p><p>{row.execution_data.work_done}</p><p>Causa: {row.execution_data.cause || 'No aplica'}</p><p>Recomendaciones: {row.execution_data.recommendations || 'No aplica'}</p><p>Condiciones: {row.execution_data.delivery_conditions || 'No aplica'}</p><p>Reparación: {time(row.execution_data.repair_started_at)} — {time(row.execution_data.repair_finished_at)}. Retorno: {time(row.execution_data.restored_at)}.</p><ul>{row.execution_data.parts.map(p=><li key={p.spare_part_id}>{p.internal_code} · {p.quantity} {p.unit_of_measure} consumidos</li>)}</ul></>}
        {row.received_at&&<p>Recibido por {row.receiver_name || row.requester_name}: {time(row.received_at)}. {row.receipt_notes}</p>}
        <div className="request-toolbar"><button className="secondary-action" onClick={()=>setPrintRow(row)}>Imprimir / guardar PDF MT/02-05</button>
          {currentUser.rol==='ADMIN'&&<button className="secondary-action" disabled={busy} onClick={deleteRequest}>Eliminar flujo completo</button>}
          {row.status==='PENDIENTE'&&isAdmin&&<button disabled={busy} className="primary-action" onClick={()=>mutate(`/${row.id}/atender`)}>Atender solicitud</button>}
          {row.status==='EN_PROCESO'&&isAdmin&&<button disabled={busy||!catalogReady} className="primary-action" onClick={()=>start('complete')}>Registrar trabajo y repuestos</button>}
          {row.status==='POR_RECIBIR'&&(isAdmin||row.requested_by===currentUser.id)&&<button className="primary-action" onClick={()=>start('receive')}>Confirmar recepción del cambio</button>}
        </div></section>}
      {form&&<form onSubmit={save}><h3>{mode==='new'?'Generar solicitud':mode==='complete'?'Registrar trabajo realizado':'Confirmar recepción'}</h3><p>Fechas y horas locales de Ecuador (UTC−5).</p><fieldset disabled={busy} className="request-fields"><div className="motor-form-grid">
        {mode==='new'&&<>
          <label>Máquina<select required value={form.machine_id||''} onChange={e=>change('machine_id',e.target.value)}><option value="">Selecciona</option>{machines.map(m=><option key={m.machine_id} value={m.machine_id}>{m.asset_code} · {m.name}</option>)}</select></label>
          <label>Tipo<select value={form.maintenance_type} onChange={e=>change('maintenance_type',e.target.value)}><option>CORRECTIVO</option><option>PREVENTIVO</option></select></label>
          <Text label="Descripción del daño / trabajo solicitado" name="description" form={form} change={change}/>
          <Field label="Fecha y hora de detección del daño / necesidad" type="datetime-local" name="detected_at" required value={form.detected_at} onChange={change}/>
          {[['urgency','Urgencia',['No afecta operación','Funciona con falla','Puede parar pronto','Equipo parado']],['impact','Impacto',['No afecta producción','Baja rendimiento','Para una línea','Para toda la planta']],['risk','Riesgo',['Sin riesgo','Riesgo bajo','Riesgo medio','Peligro grave / accidente']]].map(([key,label,options])=><label key={key}>{label}<select required value={form[key]} onChange={e=>change(key,e.target.value)}>{key==='urgency'&&<option value="" disabled>Selecciona la urgencia</option>}{options.map((text,i)=><option key={i} value={i+1}>{i+1} · {text}</option>)}</select></label>)}
          <label className="checkbox-field"><input type="checkbox" checked={form.failure} onChange={e=>change('failure',e.target.checked)}/> Es una falla del equipo (para MTBF)</label>
          <Field label="Inicio real de parada (obligatorio si está parado)" type="datetime-local" name="stopped_at" required={Number(form.urgency)===4} value={form.stopped_at} onChange={change}/>
          <Field label="Horómetro al solicitar (h, si existe)" type="number" min="0" step="0.01" name="hour_meter" value={form.hour_meter} onChange={change}/>
          <Field label="Inicio planificado (si aplica)" type="datetime-local" name="planned_start" value={form.planned_start} onChange={change}/>
          <Field label="Fin planificado (si aplica)" type="datetime-local" name="planned_end" value={form.planned_end} onChange={change}/>
          <label>Repuesto previsto<select value={form.requested_part_id||''} onChange={e=>change('requested_part_id',e.target.value)}><option value="">No definido</option>{parts.map(p=><option key={p.spare_part_id} value={p.spare_part_id}>{p.internal_code} · {p.description}</option>)}</select></label>
          <Field label="Cantidad prevista" type="number" min="0.01" step="0.01" name="requested_quantity" value={form.requested_quantity} onChange={change}/>
        </>}
        {mode==='complete'&&<>
          <p className="full-field">Se copiaron la descripci?n y el repuesto previsto de la solicitud. Ajusta el trabajo, los repuestos y las cantidades seg?n lo realizado; puedes quitar o a?adir repuestos antes de entregar.</p>
          {[['repair_started_at','Inicio real de reparación',true],['repair_finished_at','Fin real de reparación',true],['stopped_at','Inicio real de parada',false],['restored_at','Retorno real a servicio',false]].map(([key,label,required])=><Field key={key} label={label} name={key} type="datetime-local" required={required} value={form[key]} onChange={change}/>)}
          <Field label="Horómetro final (h)" type="number" min="0" step="0.01" name="hour_meter" value={form.hour_meter} onChange={change}/>
          <Field label="Minutos de espera por repuestos" type="number" min="0" step="1" required name="waiting_parts_minutes" value={form.waiting_parts_minutes} onChange={change}/>
          {[['work_done','Trabajo realizado',2000],['cause','Posibles causas',1000],['recommendations','Recomendaciones de operación',1000],['delivery_conditions','Condiciones de entrega',1000]].map(([name,label,max])=><Text key={name} name={name} label={label} maxLength={max} required={name === 'work_done'} form={form} change={change}/>)}
          <div className="full-field"><h4>Repuestos realmente utilizados</h4><p>Se descontarán al guardar la entrega. Si no se utilizaron repuestos, deja la lista vacía.</p>{form.parts.map((p,i)=><div className="request-line" key={i}><label>Repuesto<select required value={p.spare_part_id} onChange={e=>updateLine('parts',i,'spare_part_id',e.target.value)}><option value="">Selecciona</option>{parts.map(item=><option key={item.spare_part_id} value={item.spare_part_id}>{item.internal_code} · {item.description} ({item.unit_of_measure})</option>)}</select></label><label>Cantidad<input type="number" required min="0.01" step="0.01" value={p.quantity} onChange={e=>updateLine('parts',i,'quantity',e.target.value)}/></label><label>Repuesto anterior<input maxLength={150} value={p.removed_part} onChange={e=>updateLine('parts',i,'removed_part',e.target.value)}/></label><label>Posición<input maxLength={150} value={p.position} onChange={e=>updateLine('parts',i,'position',e.target.value)}/></label><button type="button" className="secondary-action" onClick={()=>change('parts',form.parts.filter((_,j)=>i!==j))}>Quitar</button></div>)}<button type="button" className="secondary-action" disabled={form.parts.length>=30} onClick={()=>change('parts',[...form.parts,{spare_part_id:'',quantity:'1',removed_part:'',position:''}])}>Añadir repuesto usado</button></div>
          <div className="full-field"><h4>Conciliación de piezas / herramientas</h4>{form.tools.map((t,i)=><div className="request-line" key={i}><label>Descripción<input required maxLength={100} value={t.description} onChange={e=>updateLine('tools',i,'description',e.target.value)}/></label><label>Ingreso<input required type="number" min="0" step="1" value={t.quantity_in} onChange={e=>updateLine('tools',i,'quantity_in',e.target.value)}/></label><label>Salida<input required type="number" min="0" step="1" value={t.quantity_out} onChange={e=>updateLine('tools',i,'quantity_out',e.target.value)}/></label><button type="button" className="secondary-action" onClick={()=>change('tools',form.tools.filter((_,j)=>j!==i))}>Quitar</button></div>)}<button type="button" className="secondary-action" disabled={form.tools.length>=20} onClick={()=>change('tools',[...form.tools,{description:'',quantity_in:'0',quantity_out:'0'}])}>Añadir pieza / herramienta</button></div>
        </>}
        {mode==='receive'&&<><p className="full-field">Confirma que recibiste el trabajo realizado para la solicitud #{selected}. La confirmación cerrará la solicitud.</p><Text label="Observaciones de recepción / conformidad" name="notes" form={form} change={change} required={false} placeholder="Si se deja vacío, se registrará Entrega conforme"/></>}
      </div><div className="modal-actions"><button type="button" className="secondary-action" onClick={()=>{setForm(null);setMode('');setFormError('')}}>Cancelar</button><button className="primary-action">{busy?'Guardando…':mode==='complete'?'Entregar trabajo y consumir repuestos':mode==='receive'?'Confirmar recepción':'Generar solicitud'}</button></div></fieldset></form>}
      </>}
    </dialog>
    <MaintenanceRequestPrint row={printRow}/>
  </>
}
