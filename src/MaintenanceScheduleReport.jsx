import {useEffect,useMemo,useState} from 'react'
import {createPortal} from 'react-dom'

const pad=value=>String(value).padStart(2,'0')
const key=date=>`${date.getFullYear()}-${pad(date.getMonth()+1)}-${pad(date.getDate())}`
const parse=value=>{const [year,month,day]=value.split('-').map(Number);return new Date(year,month-1,day)}
const mondayOf=value=>{const date=new Date(value);date.setHours(0,0,0,0);date.setDate(date.getDate()-((date.getDay()+6)%7));return date}
const addDays=(date,days)=>{const copy=new Date(date);copy.setDate(copy.getDate()+days);return copy}
const formatDate=date=>date.toLocaleDateString('es-EC',{day:'2-digit',month:'2-digit',year:'numeric'})
const formatTime=date=>date.toLocaleTimeString('es-EC',{hour:'2-digit',minute:'2-digit',hour12:false})
const durationMinutes=plan=>Number(plan?.estimated_duration_days||0)*1440+Number(plan?.estimated_duration_minutes||0)
const endOf=plan=>plan?.ends_at?new Date(plan.ends_at):new Date(new Date(plan.starts_at).getTime()+durationMinutes(plan)*60000)

export default function MaintenanceScheduleReport({rows,plants}){
  const today=new Date(),initialMonday=mondayOf(today)
  const [from,setFrom]=useState(key(initialMonday)),[to,setTo]=useState(key(addDays(initialMonday,4))),[plantId,setPlantId]=useState(''),[printing,setPrinting]=useState(false)
  const valid=Boolean(from&&to&&from<=to)
  const activities=useMemo(()=>rows.filter(row=>{
    const plan=row.request_data.planning
    if(!plan?.starts_at||!valid)return false
    if(plantId&&String(row.request_data.plant_id)!==String(plantId))return false
    const start=new Date(plan.starts_at),end=endOf(plan),rangeStart=parse(from),rangeEnd=addDays(parse(to),1)
    return start<rangeEnd&&end>rangeStart
  }).sort((a,b)=>a.request_data.planning.starts_at.localeCompare(b.request_data.planning.starts_at)),[rows,plantId,from,to,valid])
  const weeks=useMemo(()=>{
    if(!valid)return[]
    const result=[],first=mondayOf(parse(from)),last=parse(to)
    for(let monday=first;monday<=last;monday=addDays(monday,7))result.push(Array.from({length:5},(_,index)=>addDays(monday,index)))
    return result
  },[from,to,valid])
  const plantName=plants.find(plant=>String(plant.plant_id)===String(plantId))?.name||'Todas las plantas'
  useEffect(()=>{
    if(!printing)return
    document.body.classList.add('schedule-report-printing')
    const finish=()=>{document.body.classList.remove('schedule-report-printing');setPrinting(false)}
    window.addEventListener('afterprint',finish)
    const timer=setTimeout(()=>window.print(),100)
    return()=>{clearTimeout(timer);window.removeEventListener('afterprint',finish);document.body.classList.remove('schedule-report-printing')}
  },[printing])
  const content=<article className="schedule-report-document">
    {weeks.map((days,weekIndex)=><section className="schedule-report-week" key={key(days[0])}>
      <header><div><h1>Cronograma semanal de mantenimiento</h1><p>{plantName} · {formatDate(days[0])} al {formatDate(days[4])}</p></div><strong>{activities.filter(row=>{const start=new Date(row.request_data.planning.starts_at),end=endOf(row.request_data.planning);return start<addDays(days[4],1)&&end>days[0]}).length} actividades</strong></header>
      <div className="schedule-report-days">{days.map(day=>{const dayStart=new Date(day),dayEnd=addDays(day,1),inRange=key(day)>=from&&key(day)<=to,items=inRange?activities.filter(row=>{const plan=row.request_data.planning;return new Date(plan.starts_at)<dayEnd&&endOf(plan)>dayStart}):[];return <section className={`schedule-report-day${inRange?'':' outside-range'}`} key={key(day)}><h2>{day.toLocaleDateString('es-EC',{weekday:'long',day:'2-digit',month:'2-digit'})}</h2>{items.map(row=>{const plan=row.request_data.planning,start=new Date(plan.starts_at),end=endOf(plan);return <div className="schedule-report-task" key={row.id}><strong>#{row.id} · {plan.responsible}</strong><span>{formatTime(start)}–{formatTime(end)}</span><span>{row.request_data.target_area||row.request_data.machine_name}</span><small>{row.request_data.description}</small></div>})}{!items.length&&<p>{inRange?'Sin actividades':'Fuera del período'}</p>}</section>})}</div>
      <footer>Semana {weekIndex+1} de {weeks.length} · Generado {new Date().toLocaleString('es-EC')}</footer>
    </section>)}
  </article>
  return <section className="schedule-report-screen"><div className="page-heading"><div><p className="eyebrow">PLANIFICACIÓN</p><h3>Cronograma semanal en PDF</h3><p>Selecciona el período y la planta. Cada semana se imprime horizontalmente en una página.</p></div></div>
    <div className="request-toolbar"><label>Desde<input type="date" value={from} onChange={event=>setFrom(event.target.value)}/></label><label>Hasta<input type="date" value={to} min={from} onChange={event=>setTo(event.target.value)}/></label><label>Planta<select value={plantId} onChange={event=>setPlantId(event.target.value)}><option value="">Todas</option>{plants.map(plant=><option value={plant.plant_id} key={plant.plant_id}>{plant.name}</option>)}</select></label><button type="button" className="primary-action" disabled={!valid||!activities.length||printing} onClick={()=>setPrinting(true)}>{printing?'Preparando PDF…':'Imprimir / guardar PDF'}</button></div>
    {!valid&&<p role="alert">La fecha final debe ser igual o posterior a la fecha inicial.</p>}
    {valid&&<p role="status">{activities.length} actividades programadas · {weeks.length} semana(s).</p>}
    {valid&&content}
    {printing&&createPortal(content,document.body)}
  </section>
}
