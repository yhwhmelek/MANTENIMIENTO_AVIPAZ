import {NICFields,benefits} from './RequestPriority'
import PriorityWorkflow from './PriorityWorkflow'
import PrioritizedActivities from './PrioritizedActivities'
import PrioritizedRequestPrint from './PrioritizedRequestPrint'
import TechnicalImprovementFields, {evaluationFields} from './TechnicalImprovementFields'
import ImageAttachment from './ImageAttachment'
import santafeHaccp from './santafe-haccp-2026.json'
import { useEffect, useRef, useState } from 'react'
import { Bell, X } from 'lucide-react'
import OperatingPeriods from './OperatingPeriods'
import { requestValidationError } from './requestValidationError'

const states = { PENDIENTE:'Pendiente', EN_PROCESO:'En proceso', POR_RECIBIR:'Por recibir', CERRADA:'Cerrada' }
const time = value => value ? value.replace('T',' ').slice(0,16) : '—'
const localInput = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}T${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}` }
function Field({label,name,type='text',value,onChange,...props}) { return <label>{label}<input name={name} type={type} value={value ?? ''} onChange={e=>onChange(name,e.target.value)} {...props}/></label> }
function Text({label,name,form,change,maxLength=1000,required=true,placeholder}) { return <label className="full-field">{label}{!required && ' (opcional)'}<textarea required={required} placeholder={placeholder ?? (required ? undefined : 'No aplica si se deja vacío')} rows={3} maxLength={maxLength} value={form[name] || ''} onChange={e=>change(name,e.target.value)}/></label> }

export default function MaintenanceRequests({ apiUrl, token, currentUser, open, onOpen, onClose }) {
  const [rows,setRows] = useState([]), [machines,setMachines] = useState([]), [parts,setParts] = useState([])
  const [plants,setPlants] = useState([]), [towers,setTowers] = useState([])
  const [error,setError] = useState(''), [formError,setFormError] = useState(''), [busy,setBusy] = useState(false)
  const [loaded,setLoaded] = useState(false), [catalogReady,setCatalogReady] = useState(false)
  const [selected,setSelected] = useState(null), [form,setForm] = useState(null), [mode,setMode] = useState('')
  const [filter,setFilter] = useState(''), [plantFilter,setPlantFilter] = useState(''), [version,setVersion] = useState(0), [printRow,setPrintRow] = useState(null)
  const [showPeriods,setShowPeriods] = useState(false)
  const [photo,setPhoto] = useState(null), [imageUrls,setImageUrls] = useState([])
  const [showBacklog,setShowBacklog]=useState(true)
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
    Promise.all(['/maquinas','/repuestos','/plantas','/torres'].map(path=>request(path,{signal:controller.signal})))
      .then(([m,p,pl,t])=>{setPlants(pl);setTowers(t);setMachines(m);setParts(p.filter(x=>x.active));setCatalogReady(true)})
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
  const photoPaths=row?.request_data.image_paths?.length?row.request_data.image_paths:row?.request_data.image_path?[row.request_data.image_path]:[]
  useEffect(()=>{
    if(!open||!photoPaths.length){setImageUrls([]);return}
    const controller=new AbortController()
    let urls=[]
    Promise.all(photoPaths.map((_,index)=>fetch(`${apiUrl}/solicitudes-mantenimiento/${row.id}/imagenes/${index}`,{headers:{Authorization:`Bearer ${token}`},signal:controller.signal})
      .then(response=>{if(!response.ok)throw new Error('Foto no disponible');return response.blob()})
      .then(blob=>URL.createObjectURL(blob)).catch(()=>null)))
      .then(results=>{urls=results.filter(Boolean);if(!controller.signal.aborted)setImageUrls(urls);else urls.forEach(url=>URL.revokeObjectURL(url))})
    return()=>{controller.abort();urls.forEach(url=>URL.revokeObjectURL(url));setImageUrls([])}
  },[open,row?.id,photoPaths.join('|'),apiUrl,token])
  const favorable=row?.request_data.maintenance_type!=='MEJORA_TECNICA'||['PROCEDE','CON_MODIFICACIONES'].includes(row?.request_data.priority_validation?.technical_review?.feasibility)
  const executionBlock=!row?null:!row.priority?'Falta guardar la evaluación oficial de Mantenimiento. Abre «Validar prioridad y evaluar».':!favorable?'La mejora necesita viabilidad «Procede» o «Procede con modificaciones». Revisa la evaluación técnica.':!row.request_data.planning?'Falta guardar la programación. Abre «Programar actividad».':row.request_data.planning.condition!=='LISTA'?'La programación está en espera. Abre «Programar actividad», revisa los pendientes, selecciona «Lista para ejecutar» y guarda.':null
  const showingDetail=Boolean(row && !form && !showPeriods)
  useEffect(()=>{
    if(open && showingDetail){
      detail.current?.focus({preventScroll:true})
      if(dialog.current)dialog.current.scrollTop=0
    }
  },[open,showingDetail,row?.id])
  function change(name,value){setForm(f=>({...f,[name]:value,...(name==='plant_id'?{tower_id:'',machine_id:''}:name==='tower_id'?{machine_id:''}:{}),...(name==='maintenance_type'?{failure:false,technical_evaluation:null,improvement_proposal:'',requesting_area:'',target_area:''}:{}),...(name==='equipment_stopped'&&!value?{stopped_at:''}:{})}))}
  function start(modeName,targetRow=row){
    setMode(modeName);setFormError('');setPhoto(null)
    if(modeName==='new')setForm({maintenance_type:'CORRECTIVO',preevaluation:{},requested_parts:[],equipment_stopped:false,failure:false,description:'',detected_at:localInput()})
    if(modeName==='edit')setForm({...targetRow.request_data,technical_evaluation:targetRow.request_data.technical_evaluation||{}})
    if(modeName==='complete'){
      const original=row.request_data
      const planned=original.requested_parts?.length?original.requested_parts:original.requested_part_id?[{spare_part_id:original.requested_part_id,quantity:original.requested_quantity}]:[]
      const available=id=>parts.some(part=>String(part.spare_part_id)===String(id))
      setForm({repair_started_at:row.accepted_at.slice(0,16),repair_finished_at:localInput(),
        stopped_at:original.stopped_at?.slice(0,16)||'',restored_at:original.stopped_at?localInput():'',
        hour_meter:original.hour_meter??'',waiting_parts_minutes:'0',work_done:(original.maintenance_type==='MEJORA_TECNICA'?original.improvement_proposal:original.description)||'',
        parts:planned.map(p=>({spare_part_id:available(p.spare_part_id)?String(p.spare_part_id):'',quantity:String(p.quantity),removed_part:'',position:''})),tools:[]})
      if(planned.some(p=>!available(p.spare_part_id)))setFormError('Hay repuestos previstos que ya no están activos. Selecciona otro repuesto o quita las filas no utilizadas.')
    }
    if(modeName==='receive')setForm({notes:''})
  }
  function editRequest(id){
    const target=rows.find(item=>item.id===id)
    if(!target||target.status!=='PENDIENTE'||target.request_data.maintenance_type!=='MEJORA_TECNICA')return
    setSelected(id);start('edit',target)
  }
  async function mutate(suffix,payload){
    if(submitting.current)return
    submitting.current=true;setBusy(true);setFormError('')
    try{const result=await request(`/solicitudes-mantenimiento${suffix}`,{method:'POST',body:payload?JSON.stringify(payload):undefined});setSelected(result.id);setForm(null);setPhoto(null);setMode('');setVersion(v=>v+1);window.dispatchEvent(new Event('stock-updated'))}
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
  async function importSantafe(){
    if(submitting.current)return
    submitting.current=true;setBusy(true);setFormError('')
    try{const result=await request('/solicitudes-mantenimiento/importar-santafe-haccp',{method:'POST',body:JSON.stringify(santafeHaccp)});setVersion(v=>v+1);setShowBacklog(false);setPlantFilter(String(plants.find(p=>p.name==='Santa Fe')?.plant_id||''));setFormError(`${result.created} solicitudes de Santa Fe incorporadas; ${result.existing} ya existían.`)}
    catch(err){setFormError(err.message)}finally{submitting.current=false;setBusy(false)}
  }
  async function importSantafePhotos(){
    if(submitting.current)return
    submitting.current=true;setBusy(true);setFormError('')
    try{const result=await request('/solicitudes-mantenimiento/importar-fotos-santafe-haccp',{method:'POST'});setVersion(v=>v+1);setFormError(`${result.photos_added} fotos añadidas a ${result.requests_updated} solicitudes de Santa Fe.`)}
    catch(err){setFormError(err.message)}finally{submitting.current=false;setBusy(false)}
  }
  async function saveImprovement(payload){
    if(submitting.current)return
    submitting.current=true;setBusy(true);setFormError('')
    try{await request(`/solicitudes-mantenimiento/${selected}/mejora`,{method:'PUT',body:JSON.stringify(payload)});setForm(null);setPhoto(null);setMode('');setVersion(v=>v+1)}
    catch(err){setFormError(err.message)}finally{submitting.current=false;setBusy(false)}
  }
  async function save(event){
    event.preventDefault();const payload={...form}
    if(submitting.current)return
    if(mode==='receive' && !window.confirm('Al aceptar, confirmas que recibiste el trabajo y estás conforme con la entrega. Si no ingresaste observaciones, se registrará «Entrega conforme». ¿Deseas aceptar?'))return
    if((mode==='new'||mode==='edit')&&photo){
      if(!['image/jpeg','image/png','image/webp'].includes(photo.type)||photo.size>10*1024*1024){setFormError('La foto debe ser JPG, PNG o WEBP y no superar 10 MB');return}
      try{payload.image_data=await new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(reader.result);reader.onerror=()=>reject(new Error('No se pudo leer la foto'));reader.readAsDataURL(photo)})}
      catch(err){setFormError(err.message);return}
    }
    if(mode==='new'){
      for(const key of ['machine_id','plant_id','tower_id'])payload[key]=Number(payload[key])||null
      if(!payload.machine_id)payload.machine_id=null
      for(const key of ['stopped_at','planned_start','planned_end','hour_meter','requested_part_id','requested_quantity'])payload[key]=payload[key]||null
      if(payload.requested_part_id)payload.requested_part_id=Number(payload.requested_part_id)
      payload.requested_parts=(payload.requested_parts||[]).map(p=>({...p,spare_part_id:Number(p.spare_part_id)}))
    }
    if(mode==='edit'){
      for(const key of ['plant_id','tower_id','machine_id'])payload[key]=Number(payload[key])||null
      return saveImprovement(Object.fromEntries(['plant_id','tower_id','machine_id','detected_at','preevaluation','requesting_area','target_area','description','improvement_proposal','technical_evaluation','benefits','benefit_notes','image_data'].filter(key=>payload[key]!==undefined).map(key=>[key,payload[key]])))
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
      <p>Solicitar y preevaluar → validar prioridad → programar → ejecutar y entregar → recibir y aceptar el trabajo.</p>
      <button className="secondary-action" disabled={busy||!!form} onClick={()=>setShowPeriods(v=>!v)}>{showPeriods?'Volver a solicitudes':'Datos de operación para indicadores'}</button>
      {showPeriods ? <OperatingPeriods request={request} machines={machines} canCreate={canCreate&&catalogReady}/> : <>
      <div className="request-toolbar">{canCreate&&<button className="primary-action" disabled={busy||!catalogReady} onClick={()=>{setSelected(null);start('new')}}>Generar solicitud</button>}{isAdmin&&<button className="secondary-action" disabled={busy||!catalogReady} onClick={importSantafe}>Cargar 29 mejoras HACCP · Santa Fe</button>}{isAdmin&&<button className="secondary-action" disabled={busy} onClick={importSantafePhotos}>Añadir fotos del Excel HACCP · Santa Fe</button>}<button className="secondary-action" disabled={busy} onClick={()=>setVersion(v=>v+1)}>Actualizar listado</button><label>Estado <select value={filter} onChange={e=>setFilter(e.target.value)}><option value="">Todos</option>{Object.entries(states).map(([key,label])=><option key={key} value={key}>{label}</option>)}</select></label>{!showBacklog&&<label>Planta <select value={plantFilter} onChange={e=>setPlantFilter(e.target.value)}><option value="">Todas</option>{plants.map(p=><option key={p.plant_id} value={p.plant_id}>{p.name}</option>)}</select></label>}</div>
      {error&&<p role="alert">{error}</p>}{formError&&<p role="alert">{formError}</p>}
      {!loaded&&!error&&<p>Cargando solicitudes…</p>}
      {!form&&!row&&<button type="button" className="secondary-action" onClick={()=>setShowBacklog(v=>!v)}>{showBacklog?'Ver todas las solicitudes / cerradas':'Ver actividades priorizadas'}</button>}
      {!form&&!row&&showBacklog&&<PrioritizedActivities rows={rows.filter(r=>!filter||r.status===filter)} plants={plants} towers={towers} plantFilter={plantFilter} setPlantFilter={setPlantFilter} statusFilter={filter} apiUrl={apiUrl} token={token} busy={busy} canEdit={canCreate&&catalogReady} onOpen={id=>{setSelected(id);setFormError('')}} onEdit={editRequest}/>}
      {!form&&!row&&!showBacklog&&<div className="table-scroll"><table className="maintenance-requests-table"><thead><tr><th>Acción</th><th>Solicitud</th><th>Equipo / daño</th><th>Solicitante</th><th>Estado</th><th>Responsable</th></tr></thead><tbody>{rows.filter(r=>(!filter||r.status===filter)&&(!plantFilter||String(r.request_data.plant_id)===plantFilter)).map(r=><tr key={r.id}><td><button className="secondary-action" disabled={busy} onClick={()=>{setSelected(r.id);setFormError('')}}>Ver solicitud</button>{r.request_data.maintenance_type==='MEJORA_TECNICA'&&<button type='button' className='secondary-action' disabled={busy||!canCreate||!catalogReady||r.status!=='PENDIENTE'} title={!canCreate?'Solo operadores y administradores pueden modificar':r.status!=='PENDIENTE'?'Solo se modifican solicitudes pendientes':'Modificar solicitud'} onClick={()=>editRequest(r.id)}>Modificar</button>}</td><td>#{r.id}<br/>{time(r.requested_at)}<br/>{r.request_data.maintenance_type==='MEJORA_TECNICA'?'Mejora técnica':r.request_data.maintenance_type}</td><td>{r.request_data.machine_code}<br/>{[r.request_data.plant_name,r.request_data.tower_name].filter(Boolean).join(' / ')}<br/>{r.request_data.description.slice(0,80)}</td><td>{r.request_data.source_requester||r.requester_name}</td><td>{states[r.status]}</td><td>{r.assignee_name||'Sin asignar'}</td></tr>)}</tbody></table>{loaded&&!rows.length&&<p>No hay solicitudes registradas.</p>}</div>}
      {row&&!form&&<section ref={detail} tabIndex={-1} aria-label={`Detalle de solicitud ${row.id}`} className="request-detail"><button type="button" className="secondary-action" disabled={busy} onClick={()=>{setSelected(null);setFormError('')}}>Volver al listado</button>{row.request_data.maintenance_type==='MEJORA_TECNICA'&&<button type='button' className='primary-action' disabled={busy||!canCreate||!catalogReady||row.status!=='PENDIENTE'} title={!canCreate?'Solo operadores y administradores pueden modificar':row.status!=='PENDIENTE'?'Solo se modifican solicitudes pendientes':'Modificar solicitud'} onClick={()=>editRequest(row.id)}>Modificar solicitud</button>}<h3>Solicitud #{row.id} · {states[row.status]}</h3><p>{row.request_data.machine_name} · {row.request_data.description}</p><p>Tipo: {row.request_data.maintenance_type}. Falla: {row.request_data.failure?'Sí':'No'}.</p><p>Planificado: {time(row.request_data.planning?.starts_at)} a {time(row.request_data.planning?.ends_at)}. Parada: {time(row.request_data.stopped_at)}.</p>
        <p>Solicitante: {row.request_data.source_requester||row.requester_name} · Planta: {row.request_data.plant_name||'No registrada'} · Torre: {row.request_data.tower_name||'No registrada'}</p>
        {!!imageUrls.length&&<div className="full-field"><p>Fotos de la solicitud ({imageUrls.length})</p><div className="request-photo-gallery">{imageUrls.map((url,index)=><a key={url} href={url} target="_blank" rel="noreferrer"><img src={url} alt={`Foto ${index+1} de la solicitud ${row.id}`}/></a>)}</div></div>}
        <PriorityWorkflow key={row.id} row={row} isAdmin={isAdmin} request={request} onSaved={()=>setVersion(v=>v+1)}/>
        {row.request_data.maintenance_type==='MEJORA_TECNICA'&&<><h4>Mejora técnica MT/02-08</h4><p>Área solicitante: {row.request_data.requesting_area}. Equipo / sistema / área: {row.request_data.target_area||row.request_data.machine_name}</p><p>Propuesta: {row.request_data.improvement_proposal}</p><p>Beneficios: {(row.request_data.benefits||[]).map(b=>benefits[b]).join(', ')||'No registrados'}. {row.request_data.benefit_notes}</p>{row.execution_data&&<><p>Resultado: {row.execution_data.improvement_result}</p><p>Otros materiales: {row.execution_data.other_materials||'No aplica'}</p></>}</>}
        {!!row.request_data.requested_parts?.length&&<div><h4>Repuestos previstos</h4>{row.request_data.requested_parts.map(p=><p key={p.spare_part_id}>{p.internal_code} · {p.description}: {p.quantity} {p.unit_of_measure}. Stock al solicitar: {p.stock_at_request} ({p.stock_sufficient?'suficiente':'insuficiente'}).</p>)}</div>}
        {!row.request_data.requested_parts?.length&&row.request_data.requested_part_id&&<p>Repuesto previsto: {row.request_data.requested_part_code} · {row.request_data.requested_quantity}. Stock al solicitar: {row.request_data.stock_at_request} ({row.request_data.stock_sufficient?'suficiente':'insuficiente'}).</p>}
        {row.execution_data&&<><h4>Trabajo entregado</h4><p>Realizado por: {row.executor_name || row.assignee_name}</p><p>{row.execution_data.work_done}</p><p>Causa: {row.execution_data.cause || 'No aplica'}</p><p>Recomendaciones: {row.execution_data.recommendations || 'No aplica'}</p><p>Condiciones: {row.execution_data.delivery_conditions || 'No aplica'}</p><p>Reparación: {time(row.execution_data.repair_started_at)} — {time(row.execution_data.repair_finished_at)}. Retorno: {time(row.execution_data.restored_at)}.</p><ul>{row.execution_data.parts.map(p=><li key={p.spare_part_id}>{p.internal_code} · {p.quantity} {p.unit_of_measure} consumidos</li>)}</ul></>}
        {row.received_at&&<p>Recibido por {row.receiver_name || row.requester_name}: {time(row.received_at)}. {row.receipt_notes}</p>}
        <div className="request-toolbar"><button className="secondary-action" onClick={()=>setPrintRow(row)}>Imprimir / guardar PDF {row.request_data.maintenance_type==='MEJORA_TECNICA'?'MT/02-08':'MT/02-05'}</button>
          {currentUser.rol==='ADMIN'&&<button className="secondary-action" disabled={busy} onClick={deleteRequest}>Eliminar flujo completo</button>}
          {isAdmin&&['PENDIENTE','EN_PROCESO'].includes(row.status)&&executionBlock&&<p role="status">No se puede iniciar o entregar todavía: {executionBlock}</p>}
          {row.status==='PENDIENTE'&&isAdmin&&<button disabled={busy||Boolean(executionBlock)} title={executionBlock||'Iniciar el trabajo; puede realizarse el mismo día'} className="primary-action" onClick={()=>mutate(`/${row.id}/atender`)}>Iniciar trabajo programado</button>}
          {row.status==='EN_PROCESO'&&isAdmin&&<button disabled={busy||!catalogReady||!row.priority||!favorable||row.request_data.planning?.condition!=='LISTA'} className="primary-action" onClick={()=>start('complete')}>Registrar trabajo y repuestos</button>}
          {row.status==='POR_RECIBIR'&&(isAdmin||row.requested_by===currentUser.id)&&<button className="primary-action" onClick={()=>start('receive')}>Confirmar recepción del cambio</button>}
        </div></section>}
      {form&&<form onSubmit={save}><h3>{mode==='new'?'Generar solicitud':mode==='edit'?'Completar mejora técnica':mode==='complete'?'Registrar trabajo realizado':'Confirmar recepción'}</h3><p>Fechas y horas locales de Ecuador (UTC−5).</p><fieldset disabled={busy} className="request-fields"><div className="motor-form-grid">
        {mode==='edit'&&<><p className="full-field">Solicitud original: {form.source_requester||row.requester_name} · hoja {form.source_sheet||'sin referencia'}. Completa los datos que faltan y corrige los transcritos.{row.request_data.priority_validation&&' Si cambias la solicitud, revisa también la evaluación oficial de prioridad.'}</p>
          <label>Planta<select required value={form.plant_id||''} onChange={e=>change('plant_id',e.target.value)}><option value="">Selecciona una planta</option>{plants.map(p=><option key={p.plant_id} value={p.plant_id}>{p.name}</option>)}</select></label>
          <label>Torre (opcional)<select disabled={!form.plant_id} value={form.tower_id||''} onChange={e=>change('tower_id',e.target.value)}><option value="">Sin torre / área general</option>{towers.filter(t=>String(t.plant_id)===String(form.plant_id)).map(t=><option key={t.tower_id} value={t.tower_id}>{t.name}</option>)}</select></label>
          <label>Máquina (opcional)<select disabled={!form.tower_id} value={form.machine_id||''} onChange={e=>change('machine_id',e.target.value)}><option value="">Sin máquina</option>{machines.filter(m=>String(m.tower_id)===String(form.tower_id)).map(m=><option key={m.machine_id} value={m.machine_id}>{m.asset_code} · {m.name}</option>)}</select></label>
          <Field label="Fecha y hora de detección" type="datetime-local" name="detected_at" required value={form.detected_at?.slice(0,16)||''} onChange={change}/>
          <Text label="Situación actual / problema" name="description" form={form} change={change}/><TechnicalImprovementFields form={form} change={change}/>
          <div className="full-field"><h4>Preevaluación de prioridad</h4><NICFields required={false} value={form.preevaluation||{}} onChange={value=>change('preevaluation',value)}/></div>
          <div className="full-field"><h4>Evaluación técnica del formulario</h4>{evaluationFields.map(([key,notes,label])=><div className="request-line" key={key}><label>{label}<select required value={form.technical_evaluation?.[key]===undefined?'':String(form.technical_evaluation[key])} onChange={e=>change('technical_evaluation',{...form.technical_evaluation,[key]:e.target.value==='true'})}><option value="">Selecciona</option><option value="true">Sí</option><option value="false">No</option></select></label><label>Observaciones<input maxLength={500} value={form.technical_evaluation?.[notes]||''} onChange={e=>change('technical_evaluation',{...form.technical_evaluation,[notes]:e.target.value})}/></label></div>)}</div>
          <ImageAttachment label="Añadir foto a la solicitud" onChange={event=>setPhoto(event.target.files?.[0]||null)} help="JPG, PNG o WEBP. Máximo 10 MB. Las fotos actuales se conservan."/></>}
        {mode==='new'&&<>
          <label>Planta<select required value={form.plant_id||''} onChange={e=>change('plant_id',e.target.value)}><option value="">Selecciona una planta</option>{plants.map(p=><option key={p.plant_id} value={p.plant_id}>{p.name}</option>)}</select></label>
          <label>Torre {form.maintenance_type==='MEJORA_TECNICA'?'(opcional)':''}<select required={form.maintenance_type!=='MEJORA_TECNICA'} disabled={!form.plant_id} value={form.tower_id||''} onChange={e=>change('tower_id',e.target.value)}><option value="">Sin torre / área general</option>{towers.filter(t=>String(t.plant_id)===String(form.plant_id)).map(t=><option key={t.tower_id} value={t.tower_id}>{t.name}</option>)}</select></label>
          <label>Máquina (opcional para mejora de un área)<select disabled={!form.tower_id} required={form.maintenance_type!=='MEJORA_TECNICA'} value={form.machine_id||''} onChange={e=>change('machine_id',e.target.value)}><option value="">Selecciona</option>{machines.filter(m=>form.tower_id&&String(m.tower_id)===String(form.tower_id)).map(m=><option key={m.machine_id} value={m.machine_id}>{m.asset_code} · {m.name}</option>)}</select></label>
          {form.tower_id&&!machines.some(m=>String(m.tower_id)===String(form.tower_id))&&<p role="status">Esta torre no tiene máquinas asignadas. Puedes asignarlas desde Activos → Máquinas.</p>}
          <label>Tipo<select value={form.maintenance_type} onChange={e=>change('maintenance_type',e.target.value)}><option>CORRECTIVO</option><option>PREVENTIVO</option><option value="MEJORA_TECNICA">Mejora técnica (MT/02-08)</option></select></label>
          <Text label={form.maintenance_type==='MEJORA_TECNICA'?'Situación actual / problema identificado':'Descripción del daño / trabajo solicitado'} name="description" form={form} change={change}/>
          {form.maintenance_type==='MEJORA_TECNICA'&&<TechnicalImprovementFields form={form} change={change}/>}
          <ImageAttachment label="Foto de la solicitud" onChange={event=>setPhoto(event.target.files?.[0]||null)} help="JPG, PNG o WEBP. Máximo 10 MB."/>
          <Field label="Fecha y hora de detección del daño / necesidad" type="datetime-local" name="detected_at" required value={form.detected_at} onChange={change}/>
          <div className="full-field"><h4>Preevaluación de prioridad del solicitante</h4><p>Opcional: completa solo los factores que conozcas o deja todos sin valorar. No se requiere diagnóstico técnico. Mantenimiento definirá la prioridad oficial.</p><NICFields required={false} value={form.preevaluation} onChange={value=>change('preevaluation',value)}/></div>
          <label className="checkbox-field"><input type="checkbox" disabled={form.maintenance_type!=='CORRECTIVO'} checked={form.failure} onChange={e=>change('failure',e.target.checked)}/> Es una falla del equipo (para MTBF)</label>
          <label className="checkbox-field"><input type="checkbox" checked={form.equipment_stopped} onChange={e=>change('equipment_stopped',e.target.checked)}/> El equipo está parado actualmente</label>
          <Field label="Inicio real de parada" type="datetime-local" name="stopped_at" required={form.equipment_stopped} value={form.stopped_at} onChange={change}/>
          <Field label="Horómetro al solicitar (h, si existe)" type="number" min="0" step="0.01" name="hour_meter" value={form.hour_meter} onChange={change}/>


          <div className="full-field"><h4>Repuestos previstos (opcional)</h4><p>Puedes indicar varios. El stock se descuenta al entregar el trabajo, según lo realmente utilizado.</p>{(form.requested_parts||[]).map((p,i)=><div className="request-line" key={i}><label>Repuesto<select required value={p.spare_part_id} onChange={e=>updateLine('requested_parts',i,'spare_part_id',e.target.value)}><option value="">Selecciona</option>{parts.map(part=><option key={part.spare_part_id} value={part.spare_part_id}>{part.internal_code} · {part.description}</option>)}</select></label><label>Cantidad prevista<input required type="number" min="0.01" max="99999999.99" step="0.01" value={p.quantity} onChange={e=>updateLine('requested_parts',i,'quantity',e.target.value)}/></label><button type="button" onClick={()=>change('requested_parts',form.requested_parts.filter((_,j)=>i!==j))}>Quitar</button></div>)}<button type="button" disabled={(form.requested_parts||[]).length>=30} onClick={()=>change('requested_parts',[...(form.requested_parts||[]),{spare_part_id:'',quantity:'1'}])}>Añadir repuesto previsto</button></div>
        </>}
        {mode==='complete'&&<>
          {row.request_data.maintenance_type==='MEJORA_TECNICA'&&<><Text label="Resultado de mejora" name="improvement_result" maxLength={2000} form={form} change={change}/><Text label="Otros materiales utilizados (fuera de inventario)" name="other_materials" maxLength={2000} required={false} form={form} change={change}/></>}
          <p className="full-field">Se copiaron la descripci?n y el repuesto previsto de la solicitud. Ajusta el trabajo, los repuestos y las cantidades seg?n lo realizado; puedes quitar o a?adir repuestos antes de entregar.</p>
          {[['repair_started_at','Inicio real de reparación',true],['repair_finished_at','Fin real de reparación',true],['stopped_at','Inicio real de parada',false],['restored_at','Retorno real a servicio',false]].map(([key,label,required])=><Field key={key} label={label} name={key} type="datetime-local" required={required} value={form[key]} onChange={change}/>)}
          <Field label="Horómetro final (h)" type="number" min="0" step="0.01" name="hour_meter" value={form.hour_meter} onChange={change}/>
          <Field label="Minutos de espera por repuestos" type="number" min="0" step="1" required name="waiting_parts_minutes" value={form.waiting_parts_minutes} onChange={change}/>
          {[['work_done','Trabajo realizado',2000],['cause','Posibles causas',1000],['recommendations','Recomendaciones de operación',1000],['delivery_conditions','Condiciones de entrega',1000]].map(([name,label,max])=><Text key={name} name={name} label={label} maxLength={max} required={name === 'work_done'} form={form} change={change}/>)}
          <div className="full-field"><h4>Repuestos realmente utilizados</h4><p>Se descontarán al guardar la entrega. Si no se utilizaron repuestos, deja la lista vacía.</p>{form.parts.map((p,i)=><div className="request-line" key={i}><label>Repuesto<select required value={p.spare_part_id} onChange={e=>updateLine('parts',i,'spare_part_id',e.target.value)}><option value="">Selecciona</option>{parts.map(item=><option key={item.spare_part_id} value={item.spare_part_id}>{item.internal_code} · {item.description} ({item.unit_of_measure})</option>)}</select></label><label>Cantidad<input type="number" required min="0.01" step="0.01" value={p.quantity} onChange={e=>updateLine('parts',i,'quantity',e.target.value)}/></label><label>Repuesto anterior<input maxLength={150} value={p.removed_part} onChange={e=>updateLine('parts',i,'removed_part',e.target.value)}/></label><label>Posición<input maxLength={150} value={p.position} onChange={e=>updateLine('parts',i,'position',e.target.value)}/></label><button type="button" className="secondary-action" onClick={()=>change('parts',form.parts.filter((_,j)=>i!==j))}>Quitar</button></div>)}<button type="button" className="secondary-action" disabled={form.parts.length>=30} onClick={()=>change('parts',[...form.parts,{spare_part_id:'',quantity:'1',removed_part:'',position:''}])}>Añadir repuesto usado</button></div>
          <div className="full-field"><h4>Conciliación de piezas / herramientas</h4>{form.tools.map((t,i)=><div className="request-line" key={i}><label>Descripción<input required maxLength={100} value={t.description} onChange={e=>updateLine('tools',i,'description',e.target.value)}/></label><label>Ingreso<input required type="number" min="0" step="1" value={t.quantity_in} onChange={e=>updateLine('tools',i,'quantity_in',e.target.value)}/></label><label>Salida<input required type="number" min="0" step="1" value={t.quantity_out} onChange={e=>updateLine('tools',i,'quantity_out',e.target.value)}/></label><button type="button" className="secondary-action" onClick={()=>change('tools',form.tools.filter((_,j)=>j!==i))}>Quitar</button></div>)}<button type="button" className="secondary-action" disabled={form.tools.length>=20} onClick={()=>change('tools',[...form.tools,{description:'',quantity_in:'0',quantity_out:'0'}])}>Añadir pieza / herramienta</button></div>
        </>}
        {mode==='receive'&&<><p className="full-field">Confirma que recibiste el trabajo realizado para la solicitud #{selected}. La confirmación cerrará la solicitud.</p><Text label="Observaciones de recepción / conformidad" name="notes" form={form} change={change} required={false} placeholder="Si se deja vacío, se registrará Entrega conforme"/></>}
      </div><div className="modal-actions"><button type="button" className="secondary-action" onClick={()=>{setForm(null);setMode('');setFormError('')}}>Cancelar</button><button className="primary-action">{busy?'Guardando…':mode==='edit'?'Guardar datos de la mejora':mode==='complete'?'Entregar trabajo y consumir repuestos':mode==='receive'?'Confirmar recepción':'Generar solicitud'}</button></div></fieldset></form>}
      </>}
    </dialog>
    <PrioritizedRequestPrint row={printRow}/>
  </>
}
