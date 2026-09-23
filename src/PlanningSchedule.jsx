import {useEffect,useMemo,useState} from 'react'

const pad=value=>String(value).padStart(2,'0')
const dayKey=date=>`${date.getFullYear()}-${pad(date.getMonth()+1)}-${pad(date.getDate())}`
const minutes=plan=>Number(plan?.estimated_duration_days||0)*1440+Number(plan?.estimated_duration_minutes||0)
const endOf=plan=>plan?.ends_at?new Date(plan.ends_at):plan?.starts_at?new Date(new Date(plan.starts_at).getTime()+minutes(plan)*60000):null

export default function PlanningSchedule({request,row,form,onSelect}){
  const [rows,setRows]=useState([]),[weekShift,setWeekShift]=useState(0),[error,setError]=useState('')
  useEffect(()=>{let active=true;request('/solicitudes-mantenimiento').then(data=>{if(active)setRows(data)}).catch(e=>{if(active)setError(e.message)});return()=>{active=false}},[row.id])
  const selected=form.starts_at?new Date(form.starts_at):new Date()
  const monday=useMemo(()=>{const date=new Date(selected);date.setHours(0,0,0,0);date.setDate(date.getDate()-((date.getDay()+6)%7)+weekShift*7);return date},[form.starts_at,weekShift])
  const days=Array.from({length:7},(_,index)=>{const date=new Date(monday);date.setDate(date.getDate()+index);return date})
  const activities=rows.filter(item=>item.id!==row.id&&String(item.request_data.plant_id)===String(row.request_data.plant_id)&&['PENDIENTE','EN_PROCESO'].includes(item.status)&&item.request_data.planning?.starts_at)
  const selectedEnd=form.starts_at?new Date(selected.getTime()+minutes(form)*60000):null
  const sameResponsible=item=>form.assignment_type===(item.request_data.planning.assignment_type||'USER')&&(form.assignment_type==='CONTRACTOR'?String(form.contractor_id)===String(item.request_data.planning.contractor_id):String(form.assigned_user_id)===String(item.request_data.planning.assigned_user_id))
  const conflicts=activities.filter(item=>{const plan=item.request_data.planning,start=new Date(plan.starts_at),end=endOf(plan);return selectedEnd&&sameResponsible(item)&&selected<end&&selectedEnd>start})
  function choose(date){const current=form.starts_at?.slice(11,16)||'08:00';onSelect(`${dayKey(date)}T${current}`)}
  return <section className="full-field planning-schedule"><div className="request-toolbar"><h4>Cronograma de {row.request_data.plant_name||'la planta'}</h4><button type="button" onClick={()=>setWeekShift(value=>value-1)}>Semana anterior</button><button type="button" onClick={()=>setWeekShift(0)}>Semana seleccionada</button><button type="button" onClick={()=>setWeekShift(value=>value+1)}>Semana siguiente</button></div>
    <p>Selecciona un día y ajusta la hora en “Inicio programado”. Solo se muestran actividades de esta planta.</p>{error&&<p role="alert">{error}</p>}
    <div className="planning-week">{days.map(date=>{const key=dayKey(date),items=activities.filter(item=>item.request_data.planning.starts_at.slice(0,10)===key).sort((a,b)=>a.request_data.planning.starts_at.localeCompare(b.request_data.planning.starts_at));return <div className={`planning-day${form.starts_at?.slice(0,10)===key?' selected':''}`} key={key}><button type="button" className="planning-day-heading" onClick={()=>choose(date)}><strong>{date.toLocaleDateString('es-EC',{weekday:'short'})}</strong><span>{date.toLocaleDateString('es-EC',{day:'2-digit',month:'2-digit'})}</span></button>{items.map(item=>{const plan=item.request_data.planning,end=endOf(plan),conflict=conflicts.some(entry=>entry.id===item.id);return <div key={item.id} className={`planning-slot${conflict?' conflict':''}`}><strong>#{item.id} · {plan.responsible}</strong><span>{plan.starts_at.slice(11,16)}–{end?`${pad(end.getHours())}:${pad(end.getMinutes())}`:'Sin fin'}</span><small>{item.request_data.target_area||item.request_data.machine_name}</small></div>})}{!items.length&&<span className="planning-empty">Disponible</span>}</div>})}</div>
    {conflicts.length?<p role="alert">Cruce detectado: el responsable ya tiene {conflicts.map(item=>`#${item.id}`).join(', ')} en ese horario.</p>:form.starts_at&&minutes(form)>0?<p role="status">Horario disponible para el responsable seleccionado en esta planta.</p>:<p role="status">Selecciona una fecha y una duración para comprobar disponibilidad.</p>}
  </section>
}
