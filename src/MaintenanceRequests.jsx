import {NICFields,benefits,PriorityBadge} from './RequestPriority'
import PriorityWorkflow from './PriorityWorkflow'
import PrioritizedActivities from './PrioritizedActivities'
import PrioritizedRequestPrint from './PrioritizedRequestPrint'
import TechnicalImprovementFields, {evaluationFields} from './TechnicalImprovementFields'
import ImageAttachment from './ImageAttachment'
import { imageToDataUrl } from './imageUpload'
import { useEffect, useRef, useState } from 'react'
import { Bell, X } from 'lucide-react'
import OperatingPeriods from './OperatingPeriods'
import MaintenanceScheduleReport from './MaintenanceScheduleReport'
import { requestValidationError } from './requestValidationError'
import { compareActivities } from './priorityOrder'

const states = { PENDIENTE:'Pendiente', EN_PROCESO:'En proceso', POR_RECIBIR:'Por recibir', CERRADA:'Cerrada' }
const stateText = row => row.status==='POR_RECIBIR' ? (row.request_data.admin_review?'Pendiente de conformidad':'Pendiente de revisión administrativa') : states[row.status]
const time = value => value ? value.replace('T',' ').slice(0,16) : '—'
const duration = minutes => {
  if (minutes == null) return 'Sin registro'
  const total = Math.round(Number(minutes))
  return `${Math.floor(total/60)} h ${total%60} min`
}
const planDuration = plan => { const total=plan?.estimated_duration_days!=null||plan?.estimated_duration_minutes!=null?Number(plan.estimated_duration_days||0)*1440+Number(plan.estimated_duration_minutes||0):plan?.starts_at&&plan?.ends_at?Math.max(1,Math.round((new Date(plan.ends_at)-new Date(plan.starts_at))/60000)):0; return `${Math.floor(total/1440)} día(s) y ${total%1440} minuto(s)` }
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
  const [workspace,setWorkspace] = useState('activities')
  const [photo,setPhoto] = useState(null), [imageUrls,setImageUrls] = useState([])
  const [removedPhotoPaths,setRemovedPhotoPaths] = useState([])
  const [uploadStage,setUploadStage] = useState('')
  const [photosLoaded,setPhotosLoaded] = useState(0)
  const dialog=useRef(null), submitting=useRef(false)
  const detail=useRef(null)
  const isAdmin=currentUser.rol==='ADMIN'
  const canCreate=['ADMIN','USUARIO','OPERADOR'].includes(currentUser.rol)
  const isContractor=row=>row?.request_data.planning?.assignment_type==='CONTRACTOR'
  const canExecute=row=>(isContractor(row)&&isAdmin)||Number(row?.request_data.planning?.assigned_user_id)===currentUser.id||row?.assigned_to===currentUser.id
  const assignedWorkCount=rows.filter(r=>canExecute(r)&&['PENDIENTE','EN_PROCESO'].includes(r.status)).length
  const assignedWork=rows.filter(r=>canExecute(r)&&['PENDIENTE','EN_PROCESO'].includes(r.status))
  const pendingReceipts=rows.filter(r=>r.status==='POR_RECIBIR'&&r.request_data.admin_review&&r.requested_by===currentUser.id)
  const managementCount=isAdmin?rows.filter(r=>(r.status==='PENDIENTE'&&!r.request_data.planning)||(r.status==='POR_RECIBIR'&&!r.request_data.admin_review)).length:0
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
    if(!open||!photoPaths.length){setImageUrls([]);setPhotosLoaded(0);return}
    const controller=new AbortController()
    const urls=Array(photoPaths.length).fill(null)
    let next=0, completed=0
    setImageUrls([...urls]);setPhotosLoaded(0)
    async function worker(){
      while(next<urls.length&&!controller.signal.aborted){
        const index=next++
        try{
          const response=await fetch(`${apiUrl}/solicitudes-mantenimiento/${row.id}/imagenes/${index}`,{headers:{Authorization:`Bearer ${token}`},signal:controller.signal})
          if(!response.ok)throw new Error('Foto no disponible')
          const blob=await response.blob()
          if(controller.signal.aborted)break
          urls[index]=URL.createObjectURL(blob)
          setImageUrls([...urls])
        }catch(error){if(error.name==='AbortError')break}
        completed++
        setPhotosLoaded(completed)
      }
    }
    Array.from({length:Math.min(4,urls.length)},()=>worker())
    return()=>{controller.abort();urls.filter(Boolean).forEach(url=>URL.revokeObjectURL(url))}
  },[open,row?.id,photoPaths.join('|'),apiUrl,token])
  const favorable=row?.request_data.maintenance_type!=='MEJORA_TECNICA'||['PROCEDE','CON_MODIFICACIONES'].includes(row?.request_data.priority_validation?.technical_review?.feasibility)
  const executionBlock=!row?null:!row.priority?'Falta guardar la evaluación oficial de Mantenimiento. Abre «Validar prioridad y evaluar».':!favorable?'La mejora necesita viabilidad «Procede» o «Procede con modificaciones». Revisa la evaluación técnica.':!row.request_data.planning?'Falta guardar la programación. Abre «Programar actividad».':row.request_data.planning.condition!=='LISTA'?'La programación está en espera. Abre «Programar actividad», revisa los pendientes, selecciona «Lista para ejecutar» y guarda.':null
  const showingDetail=Boolean(row && !form)
  useEffect(()=>{
    if(open && showingDetail){
      detail.current?.focus({preventScroll:true})
      if(dialog.current)dialog.current.scrollTop=0
    }
  },[open,showingDetail,row?.id])
  function change(name,value){setForm(f=>({...f,[name]:value,...(name==='plant_id'?{tower_id:'',machine_id:''}:name==='tower_id'?{machine_id:''}:{}),...(name==='maintenance_type'?{failure:false,technical_evaluation:null,improvement_proposal:'',requesting_area:'',target_area:'',detected_at:value==='CORRECTIVO'?'':(f.detected_at||localInput())}:{}),...(name==='equipment_stopped'&&!value?{stopped_at:''}:{})}))}
  function start(modeName,targetRow=row){
    setMode(modeName);setFormError('');setPhoto(null);setRemovedPhotoPaths([])
    if(modeName==='new'){
      const now=localInput()
      setForm({maintenance_type:'CORRECTIVO',preevaluation:{},requested_parts:[],equipment_stopped:false,failure:false,description:'',requested_at:now,detected_at:''})
    }
    if(modeName==='edit')setForm({...targetRow.request_data,technical_evaluation:targetRow.request_data.technical_evaluation||{}})
    if(modeName==='complete'){
      const original=row.request_data
      const planned=original.planning?.requested_parts?.length?original.planning.requested_parts:original.requested_parts?.length?original.requested_parts:original.requested_part_id?[{spare_part_id:original.requested_part_id,quantity:original.requested_quantity}]:[]
      const available=id=>parts.some(part=>String(part.spare_part_id)===String(id))
      setForm({repair_started_at:row.accepted_at.slice(0,16),repair_finished_at:localInput(),
        stopped_at:original.stopped_at?.slice(0,16)||'',restored_at:original.stopped_at?localInput():'',
        hour_meter:original.hour_meter??'',waiting_parts_minutes:'0',work_done:(original.maintenance_type==='MEJORA_TECNICA'?original.improvement_proposal:original.description)||'',
        parts:planned.map(p=>({spare_part_id:available(p.spare_part_id)?String(p.spare_part_id):'',quantity:String(p.quantity),removed_part:'',position:''})),tools:[]})
      if(planned.some(p=>!available(p.spare_part_id)))setFormError('Hay repuestos previstos que ya no están activos. Selecciona otro repuesto o quita las filas no utilizadas.')
    }
    if(modeName==='receive')setForm({notes:'',received_at:localInput()})
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
  async function saveImprovement(payload){
    if(submitting.current)return
    submitting.current=true;setBusy(true);setFormError('')
    try{const result=await request(`/solicitudes-mantenimiento/${selected}/mejora`,{method:'PUT',body:JSON.stringify(payload)});setForm(null);setPhoto(null);setRemovedPhotoPaths([]);setMode('');setVersion(v=>v+1);if(result.files_not_deleted)setFormError(`La solicitud se actualizó, pero ${result.files_not_deleted} archivo(s) no se pudieron borrar del servidor.`)}
    catch(err){setFormError(err.message)}finally{submitting.current=false;setBusy(false)}
  }
  async function save(event){
    event.preventDefault();const payload={...form}
    if(submitting.current)return
    if(mode==='receive' && !window.confirm('Al aceptar, confirmas que recibiste el trabajo y estás conforme con la entrega. Si no ingresaste observaciones, se registrará «Entrega conforme». ¿Deseas aceptar?'))return
    if((mode==='new'||mode==='edit')&&photo){
      if(!['image/jpeg','image/png','image/webp'].includes(photo.type)||photo.size>10*1024*1024){setFormError('La foto debe ser JPG, PNG o WEBP y no superar 10 MB');return}
      try{setBusy(true);setUploadStage('Comprimiendo foto…');payload.image_data=await imageToDataUrl(photo)}
      catch(err){setFormError(err.message);return}
      finally{setBusy(false);setUploadStage('')}
    }
    if(mode==='new'){
      for(const key of ['machine_id','plant_id','tower_id'])payload[key]=Number(payload[key])||null
      if(!payload.machine_id)payload.machine_id=null
      for(const key of ['stopped_at','planned_start','planned_end','hour_meter','requested_part_id','requested_quantity'])payload[key]=payload[key]||null
      if(payload.requested_part_id)payload.requested_part_id=Number(payload.requested_part_id)
      payload.requested_parts=(payload.requested_parts||[]).map(p=>({...p,spare_part_id:Number(p.spare_part_id)}))
      if(payload.maintenance_type==='CORRECTIVO')delete payload.detected_at
    }
    if(mode==='edit'){
      for(const key of ['plant_id','tower_id','machine_id'])payload[key]=Number(payload[key])||null
      if(isAdmin)payload.remove_image_paths=removedPhotoPaths
      return saveImprovement(Object.fromEntries(['plant_id','tower_id','machine_id','detected_at','preevaluation','requesting_area','target_area','description','improvement_proposal','technical_evaluation','benefits','benefit_notes','image_data','remove_image_paths'].filter(key=>payload[key]!==undefined).map(key=>[key,payload[key]])))
    }
    if(mode==='complete'){
      payload.repair_finished_at=localInput()
      for(const key of ['stopped_at','restored_at','hour_meter'])payload[key]=payload[key]||null
      payload.waiting_parts_minutes=Number(payload.waiting_parts_minutes)
      payload.parts=payload.parts.map(p=>({...p,spare_part_id:Number(p.spare_part_id)}))
      payload.tools=payload.tools.map(t=>({...t,quantity_in:Number(t.quantity_in),quantity_out:Number(t.quantity_out)}))
    }
    mutate(mode==='new'?'':`/${selected}/${mode==='complete'?'completar':'recibir'}`,payload)
  }
  function updateLine(kind,index,key,value){setForm(f=>({...f,[kind]:f[kind].map((line,i)=>i===index?{...line,[key]:value}:line)}))}
  return <>
    <button className={`request-alert-trigger ${assignedWorkCount||managementCount||pendingReceipts.length||error?'needs-attention':''}`} onClick={onOpen}><Bell size={18}/><span role="status">{error?'Solicitudes sin verificar':loaded?`Trabajos asignados: ${assignedWorkCount} · Por recibir: ${pendingReceipts.length}${isAdmin?` · Gestión administrativa: ${managementCount}`:''}`:'Consultando solicitudes…'}</span></button>
    <dialog ref={dialog} className="request-workspace" aria-labelledby="requests-title" onCancel={e=>{if(e.target!==e.currentTarget||busy)e.preventDefault()}} onClose={e=>{if(e.target===e.currentTarget)onClose()}}>
      <div className="modal-header"><h2 id="requests-title">Solicitudes de mantenimiento</h2><button aria-label="Cerrar solicitudes" disabled={busy} onClick={onClose}><X/></button></div>
      <p>Solicitar y preevaluar → validar prioridad → programar → ejecutar y entregar → recibir y aceptar el trabajo.</p>
      {!form&&!row&&<nav className="spare-parts-nav requests-nav" aria-label="Secciones de solicitudes"><button type="button" aria-current={workspace==='pending'?'page':undefined} onClick={()=>setWorkspace('pending')}>Pendientes y solicitudes</button><button type="button" aria-current={workspace==='activities'?'page':undefined} onClick={()=>setWorkspace('activities')}>Lista de actividades</button><button type="button" aria-current={workspace==='schedule'?'page':undefined} onClick={()=>setWorkspace('schedule')}>Cronograma PDF</button><button type="button" aria-current={workspace==='periods'?'page':undefined} onClick={()=>setWorkspace('periods')}>Horas de máquinas</button></nav>}
      {!form&&!row&&workspace==='periods'?<OperatingPeriods request={request} machines={machines} canCreate={canCreate&&catalogReady}/>:<>
      {!form&&!row&&workspace!=='schedule'&&<div className="request-toolbar">{canCreate&&<button className="primary-action" disabled={busy||!catalogReady} onClick={()=>{setSelected(null);start('new')}}>Generar solicitud</button>}<button className="secondary-action" disabled={busy} onClick={()=>setVersion(v=>v+1)}>Actualizar listado</button>{['pending','activities'].includes(workspace)&&<label>Estado <select value={filter} onChange={e=>setFilter(e.target.value)}><option value="">Todos</option>{Object.entries(states).map(([key,label])=><option key={key} value={key}>{label}</option>)}</select></label>}{workspace==='pending'&&<label>Planta <select value={plantFilter} onChange={e=>setPlantFilter(e.target.value)}><option value="">Todas</option>{plants.map(p=><option key={p.plant_id} value={p.plant_id}>{p.name}</option>)}</select></label>}</div>}
      {error&&<p role="alert">{error}</p>}{formError&&<p role="alert">{formError}</p>}{uploadStage&&<p role="status">{uploadStage}</p>}
      {!form&&!row&&workspace==='pending'&&!!assignedWork.length&&<section className="request-detail"><h3>Mis trabajos pendientes ({assignedWork.length})</h3>{assignedWork.map(work=><div className="request-line" key={work.id}><span><strong>Solicitud #{work.id}</strong> · {work.request_data.target_area||work.request_data.machine_name}<br/>{work.status==='PENDIENTE'?'Programada por iniciar':'En proceso'} · {work.request_data.description}</span><button type="button" className="primary-action" onClick={()=>{setSelected(work.id);setFormError('')}}>Abrir trabajo</button></div>)}</section>}
      {!form&&!row&&workspace==='pending'&&!!pendingReceipts.length&&<section className="request-detail"><h3>Trabajos pendientes de mi conformidad ({pendingReceipts.length})</h3>{pendingReceipts.map(work=><div className="request-line" key={work.id}><span><strong>Solicitud #{work.id}</strong> · {work.request_data.description}</span><button type="button" className="primary-action" onClick={()=>{setSelected(work.id);setFormError('')}}>Revisar entrega</button></div>)}</section>}
      {!loaded&&!error&&<p>Cargando solicitudes…</p>}
      {!form&&!row&&workspace==='activities'&&<PrioritizedActivities rows={rows.filter(r=>!filter||r.status===filter)} plants={plants} towers={towers} plantFilter={plantFilter} setPlantFilter={setPlantFilter} statusFilter={filter} apiUrl={apiUrl} token={token} busy={busy} canEdit={canCreate&&catalogReady} isAdmin={isAdmin} onSaved={()=>setVersion(v=>v+1)} onOpen={id=>{setSelected(id);setFormError('')}} onEdit={editRequest}/>}
      {!form&&!row&&workspace==='schedule'&&<MaintenanceScheduleReport rows={rows} plants={plants}/>}
      {!form&&!row&&workspace==='pending'&&<div className="table-scroll"><table className="maintenance-requests-table"><thead><tr><th>Acción</th><th>Solicitud</th><th>Equipo / daño</th><th>Prioridad oficial</th><th>Solicitante</th><th>Estado</th><th>Responsable</th></tr></thead><tbody>{rows.filter(r=>(!filter||r.status===filter)&&(!plantFilter||String(r.request_data.plant_id)===plantFilter)).sort(compareActivities).map(r=><tr key={r.id}><td><button className="secondary-action" disabled={busy} onClick={()=>{setSelected(r.id);setFormError('')}}>Ver solicitud</button>{r.request_data.maintenance_type==='MEJORA_TECNICA'&&<button type='button' className='secondary-action' disabled={busy||!canCreate||!catalogReady||r.status!=='PENDIENTE'} title={!canCreate?'Solo el personal de mantenimiento puede modificar':r.status!=='PENDIENTE'?'Solo se modifican solicitudes pendientes':'Modificar solicitud'} onClick={()=>editRequest(r.id)}>Modificar</button>}</td><td>#{r.id}<br/>{time(r.requested_at)}<br/>{r.request_data.maintenance_type==='MEJORA_TECNICA'?'Mejora técnica':r.request_data.maintenance_type}</td><td>{r.request_data.machine_code}<br/>{[r.request_data.plant_name,r.request_data.tower_name].filter(Boolean).join(' / ')}<br/>{r.request_data.description.slice(0,80)}</td><td><PriorityBadge priority={r.priority}/></td><td>{r.request_data.source_requester||r.requester_name}</td><td>{stateText(r)}</td><td>{r.assignee_name||r.request_data.planning?.responsible||'Sin asignar'}</td></tr>)}</tbody></table>{loaded&&!rows.length&&<p>No hay solicitudes registradas.</p>}</div>}
      {row&&!form&&<section ref={detail} tabIndex={-1} aria-label={`Detalle de solicitud ${row.id}`} className="request-detail"><button type="button" className="secondary-action" disabled={busy} onClick={()=>{setSelected(null);setFormError('')}}>Volver al listado</button>{row.request_data.maintenance_type==='MEJORA_TECNICA'&&<button type='button' className='primary-action' disabled={busy||!canCreate||!catalogReady||row.status!=='PENDIENTE'} title={!canCreate?'Solo el personal de mantenimiento puede modificar':row.status!=='PENDIENTE'?'Solo se modifican solicitudes pendientes':'Modificar solicitud'} onClick={()=>editRequest(row.id)}>Modificar solicitud</button>}<h3>Solicitud #{row.id} · {stateText(row)}</h3><p>{row.request_data.machine_name} · {row.request_data.description}</p><p>Tipo: {row.request_data.maintenance_type}. Falla: {row.request_data.failure?'Sí':'No'}.</p><p>Inicio programado: {time(row.request_data.planning?.starts_at)}. Duración estimada: {row.request_data.planning?planDuration(row.request_data.planning):'Sin programar'}. Parada: {time(row.request_data.stopped_at)}.</p>
        <p>Solicitante: {row.request_data.source_requester||row.requester_name} · Planta: {row.request_data.plant_name||'No registrada'} · Torre: {row.request_data.tower_name||'No registrada'}</p>
        {row.accepted_at&&<p>Inicio registrado del trabajo: {time(row.accepted_at)} · Tiempo estimado: {duration(row.request_data.estimated_repair_minutes)}.</p>}
        {row.execution_data&&<p>Fin real: {time(row.execution_data.repair_finished_at)} · Tiempo real de trabajo: {duration(row.execution_data.repair_duration_minutes)} · Tiempo de respuesta: {duration(row.execution_data.response_time_minutes)}.</p>}
        {!!photoPaths.length&&<div className="full-field"><p>Fotos de la solicitud ({photoPaths.length})</p>{photosLoaded<photoPaths.length&&<p role="status">Cargando fotos… {photosLoaded} de {photoPaths.length}</p>}<div className="request-photo-gallery">{imageUrls.map((url,index)=>url?<a key={index} href={url} target="_blank" rel="noreferrer"><img loading="lazy" src={url} alt={`Foto ${index+1} de la solicitud ${row.id}`}/></a>:null)}</div>{photosLoaded===photoPaths.length&&!imageUrls.some(Boolean)&&<p>Fotos no disponibles.</p>}</div>}
        <PriorityWorkflow key={row.id} row={row} isAdmin={isAdmin} request={request} onSaved={()=>setVersion(v=>v+1)}/>
        {row.request_data.maintenance_type==='MEJORA_TECNICA'&&<><h4>Mejora técnica MT/02-08</h4><p>Área solicitante: {row.request_data.requesting_area}. Equipo / sistema / área: {row.request_data.target_area||row.request_data.machine_name}</p><p>Propuesta: {row.request_data.improvement_proposal}</p><p>Beneficios: {(row.request_data.benefits||[]).map(b=>benefits[b]).join(', ')||'No registrados'}. {row.request_data.benefit_notes}</p>{row.execution_data&&<><p>Resultado: {row.execution_data.improvement_result}</p><p>Otros materiales: {row.execution_data.other_materials||'No aplica'}</p></>}</>}
        {!!row.request_data.requested_parts?.length&&<div><h4>Repuestos previstos</h4>{row.request_data.requested_parts.map(p=><p key={p.spare_part_id}>{p.internal_code} · {p.description}: {p.quantity} {p.unit_of_measure}. Stock al solicitar: {p.stock_at_request} ({p.stock_sufficient?'suficiente':'insuficiente'}).</p>)}</div>}
        {!row.request_data.requested_parts?.length&&row.request_data.requested_part_id&&<p>Repuesto previsto: {row.request_data.requested_part_code} · {row.request_data.requested_quantity}. Stock al solicitar: {row.request_data.stock_at_request} ({row.request_data.stock_sufficient?'suficiente':'insuficiente'}).</p>}
        {row.execution_data&&<><h4>Trabajo entregado</h4><p>Realizado por: {row.executor_name || row.assignee_name}</p><p>{row.execution_data.work_done}</p><p>Causa: {row.execution_data.cause || 'No aplica'}</p><p>Recomendaciones: {row.execution_data.recommendations || 'No aplica'}</p><p>Condiciones: {row.execution_data.delivery_conditions || 'No aplica'}</p><p>Reparación: {time(row.execution_data.repair_started_at)} — {time(row.execution_data.repair_finished_at)}. Retorno: {time(row.execution_data.restored_at)}.</p><ul>{row.execution_data.parts.map(p=><li key={p.spare_part_id}>{p.internal_code} · {p.quantity} {p.unit_of_measure} consumidos</li>)}</ul></>}
        {row.received_at&&<p>Recibido por {row.receiver_name || row.requester_name}: {time(row.received_at)}. {row.receipt_notes}</p>}
        <div className="request-toolbar"><button className="secondary-action" onClick={()=>setPrintRow(row)}>Imprimir / guardar PDF {row.request_data.maintenance_type==='MEJORA_TECNICA'?'MT/02-08':'MT/02-05'}</button>
          {currentUser.rol==='ADMIN'&&<button className="secondary-action" disabled={busy} onClick={deleteRequest}>Eliminar flujo completo</button>}
          {canExecute(row)&&['PENDIENTE','EN_PROCESO'].includes(row.status)&&executionBlock&&<p role="status">No se puede iniciar o terminar todavía: {executionBlock}</p>}
          {row.status==='PENDIENTE'&&canExecute(row)&&<button type="button" onClick={startWork} disabled={busy||Boolean(executionBlock)} title={executionBlock||'Registrar inicio real'} className="primary-action">Iniciar trabajo</button>}
          {row.status==='EN_PROCESO'&&canExecute(row)&&<button disabled={busy||!catalogReady||!row.priority||!favorable||row.request_data.planning?.condition!=='LISTA'} className="primary-action" onClick={()=>start('complete')}>Terminar trabajo</button>}
          {row.status==='POR_RECIBIR'&&isAdmin&&!row.request_data.admin_review&&<button type="button" className="primary-action" onClick={()=>mutate(`/${row.id}/revisar`,{notes:'Trabajo revisado y aprobado'})}>Revisar y aprobar trabajo</button>}
          {row.status==='POR_RECIBIR'&&row.request_data.admin_review&&row.requested_by===currentUser.id&&<button className="primary-action" onClick={()=>start('receive')}>Recibir trabajo conforme</button>}
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
          {isAdmin&&!!photoPaths.length&&<div className="full-field"><h4>Fotos actuales ({photoPaths.length})</h4><p>Marca las fotos que deseas quitar. Se eliminarán al guardar la solicitud.</p>{photosLoaded<photoPaths.length&&<p role="status">Cargando fotos… {photosLoaded} de {photoPaths.length}</p>}<div className="request-photo-gallery">{photoPaths.map((path,index)=>{const removed=removedPhotoPaths.includes(path);return <div className={`request-photo-edit${removed?' marked-for-removal':''}`} key={path}>{imageUrls[index]?<img src={imageUrls[index]} alt={`Foto ${index+1} de la solicitud ${row.id}`}/>:<span role="status">{photosLoaded<photoPaths.length?'Cargando foto…':'Foto no disponible'}</span>}<button type="button" className="secondary-action" aria-pressed={removed} onClick={()=>setRemovedPhotoPaths(items=>removed?items.filter(item=>item!==path):[...items,path])}>{removed?'Conservar foto':'Quitar foto'}</button>{removed&&<span role="status">Se quitará al guardar</span>}</div>})}</div></div>}
          <ImageAttachment label="Añadir foto a la solicitud" onChange={event=>setPhoto(event.target.files?.[0]||null)} help="JPG, PNG o WEBP. Máximo 10 MB. Las fotos no marcadas se conservan."/></>}
        {mode==='new'&&<>
          <label>Planta<select required value={form.plant_id||''} onChange={e=>change('plant_id',e.target.value)}><option value="">Selecciona una planta</option>{plants.map(p=><option key={p.plant_id} value={p.plant_id}>{p.name}</option>)}</select></label>
          <label>Torre {form.maintenance_type==='MEJORA_TECNICA'?'(opcional)':''}<select required={form.maintenance_type!=='MEJORA_TECNICA'} disabled={!form.plant_id} value={form.tower_id||''} onChange={e=>change('tower_id',e.target.value)}><option value="">Sin torre / área general</option>{towers.filter(t=>String(t.plant_id)===String(form.plant_id)).map(t=><option key={t.tower_id} value={t.tower_id}>{t.name}</option>)}</select></label>
          <label>Máquina (opcional para mejora de un área)<select disabled={!form.tower_id} required={form.maintenance_type!=='MEJORA_TECNICA'} value={form.machine_id||''} onChange={e=>change('machine_id',e.target.value)}><option value="">Selecciona</option>{machines.filter(m=>form.tower_id&&String(m.tower_id)===String(form.tower_id)).map(m=><option key={m.machine_id} value={m.machine_id}>{m.asset_code} · {m.name}</option>)}</select></label>
          {form.tower_id&&!machines.some(m=>String(m.tower_id)===String(form.tower_id))&&<p role="status">Esta torre no tiene máquinas asignadas. Puedes asignarlas desde Activos → Máquinas.</p>}
          <label>Tipo<select value={form.maintenance_type} onChange={e=>change('maintenance_type',e.target.value)}><option>CORRECTIVO</option><option>PREVENTIVO</option><option value="MEJORA_TECNICA">Mejora técnica (MT/02-08)</option></select></label>
          <Text label={form.maintenance_type==='MEJORA_TECNICA'?'Situación actual / problema identificado':'Descripción del daño / trabajo solicitado'} name="description" form={form} change={change}/>
          {form.maintenance_type==='MEJORA_TECNICA'&&<TechnicalImprovementFields form={form} change={change}/>}
          <ImageAttachment label="Foto de la solicitud" onChange={event=>setPhoto(event.target.files?.[0]||null)} help="JPG, PNG o WEBP. Máximo 10 MB."/>
          <Field label="Fecha y hora de solicitud" type="datetime-local" name="requested_at" required value={form.requested_at} onChange={change}/>
          {form.maintenance_type!=='CORRECTIVO'&&<Field label="Fecha y hora de detección del daño / necesidad" type="datetime-local" name="detected_at" required value={form.detected_at} onChange={change}/>}
          <div className="full-field"><h4>Preevaluación de prioridad del solicitante</h4><p>Opcional: completa solo los factores que conozcas o deja todos sin valorar. No se requiere diagnóstico técnico. Mantenimiento definirá la prioridad oficial.</p><NICFields required={false} value={form.preevaluation} onChange={value=>change('preevaluation',value)}/></div>
          <label className="checkbox-field"><input type="checkbox" disabled={form.maintenance_type!=='CORRECTIVO'} checked={form.failure} onChange={e=>change('failure',e.target.checked)}/> Es una falla del equipo (para MTBF)</label>
          <label className="checkbox-field"><input type="checkbox" checked={form.equipment_stopped} onChange={e=>change('equipment_stopped',e.target.checked)}/> El equipo está parado actualmente</label>
          <Field label="Inicio real de parada" type="datetime-local" name="stopped_at" required={form.equipment_stopped} value={form.stopped_at} onChange={change}/>
          <Field label="Horómetro al solicitar (h, si existe)" type="number" min="0" step="0.01" name="hour_meter" value={form.hour_meter} onChange={change}/>


          <div className="full-field"><h4>Repuestos previstos (opcional)</h4><p>La solicitud puede guardarse sin repuestos cuando el trabajo sea un ajuste. Si hacen falta, puedes indicar varios; el stock se descuenta al entregar según lo realmente utilizado.</p>{(form.requested_parts||[]).map((p,i)=><div className="request-line" key={i}><label>Repuesto<select required value={p.spare_part_id} onChange={e=>updateLine('requested_parts',i,'spare_part_id',e.target.value)}><option value="">Selecciona</option>{parts.map(part=><option key={part.spare_part_id} value={part.spare_part_id}>{part.internal_code} · {part.description}</option>)}</select></label><label>Cantidad prevista<input required type="number" min="0.01" max="99999999.99" step="0.01" value={p.quantity} onChange={e=>updateLine('requested_parts',i,'quantity',e.target.value)}/></label><button type="button" onClick={()=>change('requested_parts',form.requested_parts.filter((_,j)=>i!==j))}>Quitar</button></div>)}<button type="button" disabled={(form.requested_parts||[]).length>=30} onClick={()=>change('requested_parts',[...(form.requested_parts||[]),{spare_part_id:'',quantity:'1'}])}>Añadir repuesto previsto</button></div>
        </>}
        {mode==='complete'&&<>
          {row.request_data.maintenance_type==='MEJORA_TECNICA'&&<><Text label="Resultado de mejora" name="improvement_result" maxLength={2000} form={form} change={change}/><Text label="Otros materiales utilizados (fuera de inventario)" name="other_materials" maxLength={2000} required={false} form={form} change={change}/></>}
          <p className="full-field">Se copiaron la descripci?n y el repuesto previsto de la solicitud. Ajusta el trabajo, los repuestos y las cantidades seg?n lo realizado; puedes quitar o a?adir repuestos antes de entregar.</p>
          <p className="full-field">Inicio real: {time(form.repair_started_at)}. Al guardar se registrará el momento de finalización.</p>
          {[['stopped_at','Inicio real de parada'],['restored_at','Retorno real a servicio']].map(([key,label])=><Field key={key} label={label} name={key} type="datetime-local" value={form[key]} onChange={change}/>)}
          <Field label="Horómetro final (h)" type="number" min="0" step="0.01" name="hour_meter" value={form.hour_meter} onChange={change}/>
          <Field label="Minutos de espera por repuestos" type="number" min="0" step="1" required name="waiting_parts_minutes" value={form.waiting_parts_minutes} onChange={change}/>
          {[['work_done','Trabajo realizado',2000],['cause','Posibles causas',1000],['recommendations','Recomendaciones de operación',1000],['delivery_conditions','Condiciones de entrega',1000]].map(([name,label,max])=><Text key={name} name={name} label={label} maxLength={max} required={name==='work_done'||(name==='cause'&&row.request_data.maintenance_type==='CORRECTIVO')} form={form} change={change}/>)}
          <div className="full-field"><h4>Repuestos realmente utilizados</h4><p>Se descontarán al guardar la entrega. Si no se utilizaron repuestos, deja la lista vacía.</p>{form.parts.map((p,i)=><div className="request-line" key={i}><label>Repuesto<select required value={p.spare_part_id} onChange={e=>updateLine('parts',i,'spare_part_id',e.target.value)}><option value="">Selecciona</option>{parts.map(item=><option key={item.spare_part_id} value={item.spare_part_id}>{item.internal_code} · {item.description} ({item.unit_of_measure})</option>)}</select></label><label>Cantidad<input type="number" required min="0.01" step="0.01" value={p.quantity} onChange={e=>updateLine('parts',i,'quantity',e.target.value)}/></label><label>Repuesto anterior<input maxLength={150} value={p.removed_part} onChange={e=>updateLine('parts',i,'removed_part',e.target.value)}/></label><label>Posición<input maxLength={150} value={p.position} onChange={e=>updateLine('parts',i,'position',e.target.value)}/></label><button type="button" className="secondary-action" onClick={()=>change('parts',form.parts.filter((_,j)=>i!==j))}>Quitar</button></div>)}<button type="button" className="secondary-action" disabled={form.parts.length>=30} onClick={()=>change('parts',[...form.parts,{spare_part_id:'',quantity:'1',removed_part:'',position:''}])}>Añadir repuesto usado</button></div>
          <div className="full-field"><h4>Conciliación de piezas / herramientas</h4>{form.tools.map((t,i)=><div className="request-line" key={i}><label>Descripción<input required maxLength={100} value={t.description} onChange={e=>updateLine('tools',i,'description',e.target.value)}/></label><label>Ingreso<input required type="number" min="0" step="1" value={t.quantity_in} onChange={e=>updateLine('tools',i,'quantity_in',e.target.value)}/></label><label>Salida<input required type="number" min="0" step="1" value={t.quantity_out} onChange={e=>updateLine('tools',i,'quantity_out',e.target.value)}/></label><button type="button" className="secondary-action" onClick={()=>change('tools',form.tools.filter((_,j)=>j!==i))}>Quitar</button></div>)}<button type="button" className="secondary-action" disabled={form.tools.length>=20} onClick={()=>change('tools',[...form.tools,{description:'',quantity_in:'0',quantity_out:'0'}])}>Añadir pieza / herramienta</button></div>
        </>}
        {mode==='receive'&&<><Field label="Fecha y hora de recepcion" name="received_at" type="datetime-local" required value={form.received_at} onChange={change}/><p className="full-field">Confirma que recibiste el trabajo realizado para la solicitud #{selected}. La confirmación cerrará la solicitud.</p><Text label="Observaciones de recepción / conformidad" name="notes" form={form} change={change} required={false} placeholder="Si se deja vacío, se registrará Entrega conforme"/></>}
      </div><div className="modal-actions"><button type="button" className="secondary-action" onClick={()=>{setForm(null);setMode('');setFormError('')}}>Cancelar</button><button className="primary-action">{busy?'Guardando…':mode==='edit'?'Guardar datos de la mejora':mode==='complete'?'Entregar trabajo y consumir repuestos':mode==='receive'?'Confirmar recepción':'Generar solicitud'}</button></div></fieldset></form>}
      </>}
    </dialog>
    <PrioritizedRequestPrint row={printRow}/>
  </>
}
