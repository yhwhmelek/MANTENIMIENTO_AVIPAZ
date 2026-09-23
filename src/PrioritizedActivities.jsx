import {useEffect,useRef,useState} from 'react'
import {PriorityBadge,levels,conditions} from './RequestPriority'
import {filterPrioritizedActivities} from './prioritizedActivityFilter'
import PrioritizedActivitiesPrint from './PrioritizedActivitiesPrint'
import PriorityWorkflow from './PriorityWorkflow'

const typeLabel={MEJORA_TECNICA:'Mejora técnica',CORRECTIVO:'Correctivo',PREVENTIVO:'Preventivo'}

export default function PrioritizedActivities({rows,plants,towers,plantFilter,setPlantFilter,statusFilter,apiUrl,token,onOpen,onEdit,canEdit,isAdmin,onSaved,busy}){
  const [level,setLevel]=useState(''),[type,setType]=useState(''),[towerId,setTowerId]=useState('')
  const [report,setReport]=useState(null),[printBusy,setPrintBusy]=useState(false),[printError,setPrintError]=useState('')
  const [planningRow,setPlanningRow]=useState(null)
  const printAbort=useRef(null)
  const scope=filterPrioritizedActivities(rows,{plantId:plantFilter,towerId})
  const sorted=filterPrioritizedActivities(rows,{level,type,plantId:plantFilter,towerId})
  const availableTowers=towers.filter(t=>!plantFilter||String(t.plant_id)===String(plantFilter))

  useEffect(()=>()=>printAbort.current?.abort(),[])

  async function request(path,options={}){
    const response=await fetch(`${apiUrl}${path}`,{...options,headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'}})
    const data=await response.json().catch(()=>({}))
    if(!response.ok)throw new Error(Array.isArray(data.detail)?'Revisa los datos ingresados.':data.detail||'No se pudo actualizar la programación.')
    return data
  }

  useEffect(()=>{
    if(!report)return
    let cancelled=false
    document.body.classList.add('priority-report-printing')
    const finish=()=>{document.body.classList.remove('priority-report-printing');setReport(null)}
    window.addEventListener('afterprint',finish)
    const images=[...document.querySelectorAll('.priority-report-print img')]
    Promise.all([document.fonts?.ready,...images.map(img=>img.decode().catch(()=>{}))])
      .then(()=>{if(!cancelled)window.print()})
    return()=>{
      cancelled=true
      window.removeEventListener('afterprint',finish)
      document.body.classList.remove('priority-report-printing')
      Object.values(report.photos).flat().filter(Boolean).forEach(url=>URL.revokeObjectURL(url))
    }
  },[report])

  async function printPdf(){
    if(!sorted.length||printBusy)return
    setPrintBusy(true);setPrintError('')
    const controller=new AbortController()
    printAbort.current=controller
    const photos={}
    const photoRows=sorted.flatMap(row=>{
      const paths=row.request_data.image_paths?.length?row.request_data.image_paths:row.request_data.image_path?[row.request_data.image_path]:[]
      photos[row.id]=Array(paths.length).fill(null)
      return paths.map((_,index)=>({row,index}))
    })
    let next=0,failed=0
    try{
      await Promise.all(Array.from({length:Math.min(4,photoRows.length)},async()=>{
        while(next<photoRows.length&&!controller.signal.aborted){
          const {row,index}=photoRows[next++]
          try{
            const response=await fetch(`${apiUrl}/solicitudes-mantenimiento/${row.id}/imagenes/${index}`,{headers:{Authorization:`Bearer ${token}`},signal:controller.signal})
            if(!response.ok)throw new Error('Foto no disponible')
            photos[row.id][index]=URL.createObjectURL(await response.blob())
          }catch{if(!controller.signal.aborted)failed++}
        }
      }))
      if(controller.signal.aborted){Object.values(photos).flat().filter(Boolean).forEach(url=>URL.revokeObjectURL(url));return}
      const plantName=plants.find(p=>String(p.plant_id)===String(plantFilter))?.name||'Todas'
      const towerName=towerId==='SIN_TORRE'?'Sin torre':towers.find(t=>String(t.tower_id)===String(towerId))?.name||'Todas'
      setReport({rows:[...sorted],photos,createdAt:new Date().toLocaleString('es-EC'),
        filters:`Planta: ${plantName} · Torre: ${towerName} · Prioridad: ${levels[level]|| (level==='SIN_VALIDAR'?'Sin validar':'Todas')} · Tipo: ${typeLabel[type]||'Todos'} · Estado: ${statusFilter?statusFilter.replaceAll('_',' '):'Todos los abiertos'}`})
      if(failed)setPrintError(`${failed} foto${failed===1?' no estuvo disponible':'s no estuvieron disponibles'} para el PDF.`)
    }catch(error){
      Object.values(photos).flat().filter(Boolean).forEach(url=>URL.revokeObjectURL(url))
      setPrintError(error.message||'No se pudo preparar el PDF')
    }finally{if(printAbort.current===controller)printAbort.current=null;setPrintBusy(false)}
  }

  return <section><h3>Lista única de actividades priorizadas</h3>
    <p>Orden: primero las solicitudes sin validar, de la más antigua a la más reciente. Después, prioridad final de mayor a menor; en cada nivel, mayor C, I y N, y luego la solicitud más antigua.</p>
    <p>Ante peligro inminente o exigencia legal, controla la condición de inmediato según los procedimientos de seguridad aplicables, sin esperar la programación.</p>
    <div className="request-toolbar">{Object.entries(levels).map(([key,label])=><span key={key} className={`priority-badge priority-${key}`}>{label}: {scope.filter(r=>r.priority?.level===key).length}</span>)}<span>Sin validar: {scope.filter(r=>!r.priority).length}</span></div>
    <div className="request-toolbar">
      <label>Planta<select value={plantFilter} onChange={e=>{setPlantFilter(e.target.value);setTowerId('')}}><option value="">Todas</option>{plants.map(p=><option key={p.plant_id} value={p.plant_id}>{p.name}</option>)}</select></label>
      <label>Torre<select value={towerId} onChange={e=>setTowerId(e.target.value)}><option value="">Todas</option><option value="SIN_TORRE">Sin torre</option>{availableTowers.map(t=><option key={t.tower_id} value={t.tower_id}>{t.name}</option>)}</select></label>
      <label>Prioridad<select value={level} onChange={e=>setLevel(e.target.value)}><option value="">Todas</option>{Object.entries(levels).map(([key,label])=><option key={key} value={key}>{label}</option>)}<option value="SIN_VALIDAR">Sin validar</option></select></label>
      <label>Tipo<select value={type} onChange={e=>setType(e.target.value)}><option value="">Todos</option>{Object.entries(typeLabel).map(([key,label])=><option key={key} value={key}>{label}</option>)}</select></label>
      <button type="button" disabled={!sorted.length||printBusy} onClick={printPdf}>{printBusy?'Preparando fotos…':'Imprimir / guardar PDF'}</button>
    </div>
    {printError&&<p role="status">{printError}</p>}
    <p role="status">{sorted.length} actividades con los filtros seleccionados.</p>
    {planningRow&&<section className="request-detail" aria-label={`Editar programación de solicitud ${planningRow.id}`}><h3>Editar programación · Solicitud #{planningRow.id}</h3><p>Cambia la fecha de inicio, el tiempo estimado y el responsable antes de iniciar el trabajo.</p><PriorityWorkflow key={planningRow.id} row={planningRow} isAdmin={isAdmin} request={request} initialMode="plan" compact onCancel={()=>setPlanningRow(null)} onSaved={()=>{setPlanningRow(null);onSaved()}}/></section>}
    <div className="table-scroll"><table className="prioritized-activities-table"><colgroup><col style={{width:'11%'}}/><col style={{width:'13%'}}/><col style={{width:'22%'}}/><col style={{width:'13%'}}/><col style={{width:'11%'}}/><col style={{width:'11%'}}/><col style={{width:'19%'}}/></colgroup><thead><tr><th>Acción</th><th>Orden / solicitud</th><th>Actividad</th><th>Prioridad oficial</th><th>N / I / C validados</th><th>Estado</th><th>Programación</th></tr></thead><tbody>{sorted.map((row,index)=>{const r=row.request_data,v=r.priority_validation?.factors,p=r.planning;return <tr key={row.id}><td><button disabled={busy} onClick={()=>onOpen(row.id)}>Ver actividad</button>{isAdmin&&<button type="button" className="secondary-action" disabled={busy||row.status!=='PENDIENTE'||!r.priority_validation} title={row.status!=='PENDIENTE'?'La programación se bloquea después de iniciar':!r.priority_validation?'Primero valida la prioridad':'Editar fecha, duración y responsable'} onClick={()=>setPlanningRow(row)}>{p?'Editar programación':'Programar'}</button>}{r.maintenance_type==='MEJORA_TECNICA'&&<button className="secondary-action" disabled={busy||!canEdit||row.status!=='PENDIENTE'} title={!canEdit?'Solo el personal de mantenimiento puede modificar':row.status!=='PENDIENTE'?'Solo se modifican solicitudes pendientes':'Modificar solicitud'} onClick={()=>onEdit(row.id)}>Modificar</button>}</td><td>{index+1}. #{row.id}<br/>{row.requested_at.replace('T',' ').slice(0,16)}</td><td>{typeLabel[r.maintenance_type]||r.maintenance_type}<br/>{r.target_area||r.machine_name}<br/>{[r.plant_name,r.tower_name].filter(Boolean).join(' / ')}<br/>{r.description}</td><td><PriorityBadge priority={row.priority}/>{row.priority?.escalated&&<p>C = 4: mínimo ALTO</p>}</td><td>{v?`${v.n} / ${v.i} / ${v.c}`:'Sin validar'}</td><td>{row.status==='POR_RECIBIR'?'Pendiente de aceptación':row.status==='EN_PROCESO'?'En proceso':'Pendiente'}</td><td>{p?<>{p.responsible}<br/>{conditions[p.condition]}<br/>{p.starts_at?.replace('T',' ')||'Sin fecha'}<br/>{p.notes}</>:'Por programar'}</td></tr>})}</tbody></table></div>
    {!sorted.length&&<p>No hay actividades con estos filtros.</p>}
    <PrioritizedActivitiesPrint report={report}/>
  </section>
}
