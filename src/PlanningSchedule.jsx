import {useEffect,useMemo,useState} from 'react'

const pad=value=>String(value).padStart(2,'0')
const dayKey=date=>`${date.getFullYear()}-${pad(date.getMonth()+1)}-${pad(date.getDate())}`
const durationMinutes=plan=>Number(plan?.estimated_duration_days||0)*1440+Number(plan?.estimated_duration_minutes||0)
const endOf=plan=>plan?.ends_at?new Date(plan.ends_at):plan?.starts_at?new Date(new Date(plan.starts_at).getTime()+durationMinutes(plan)*60000):null
const START_MINUTES=7*60+30,END_MINUTES=18*60,SLOT_MINUTES=30
const slots=Array.from({length:(END_MINUTES-START_MINUTES)/SLOT_MINUTES},(_,index)=>START_MINUTES+index*SLOT_MINUTES)
const clock=value=>`${pad(Math.floor(value/60))}:${pad(value%60)}`

export default function PlanningSchedule({request,row,form,onSelect}){
  const [rows,setRows]=useState([]),[weekShift,setWeekShift]=useState(0),[error,setError]=useState('')
  useEffect(()=>{let active=true;request('/solicitudes-mantenimiento').then(data=>{if(active)setRows(data)}).catch(e=>{if(active)setError(e.message)});return()=>{active=false}},[row.id])
  const selected=form.starts_at?new Date(form.starts_at):new Date()
  const monday=useMemo(()=>{const date=new Date(selected);date.setHours(0,0,0,0);date.setDate(date.getDate()-((date.getDay()+6)%7)+weekShift*7);return date},[form.starts_at,weekShift])
  const days=Array.from({length:5},(_,index)=>{const date=new Date(monday);date.setDate(date.getDate()+index);return date})
  const activities=rows.filter(item=>item.id!==row.id&&String(item.request_data.plant_id)===String(row.request_data.plant_id)&&['PENDIENTE','EN_PROCESO'].includes(item.status)&&item.request_data.planning?.starts_at)
  const selectedEnd=form.starts_at?new Date(selected.getTime()+durationMinutes(form)*60000):null
  const sameResponsible=item=>form.assignment_type===(item.request_data.planning.assignment_type||'USER')&&(form.assignment_type==='CONTRACTOR'?String(form.contractor_id)===String(item.request_data.planning.contractor_id):String(form.assigned_user_id)===String(item.request_data.planning.assigned_user_id))
  const conflicts=activities.filter(item=>{const plan=item.request_data.planning,start=new Date(plan.starts_at),end=endOf(plan);return selectedEnd&&sameResponsible(item)&&selected<end&&selectedEnd>start})
  const entries=[...activities.map(item=>({item,start:new Date(item.request_data.planning.starts_at),end:endOf(item.request_data.planning),selected:false,conflict:conflicts.some(entry=>entry.id===item.id)})),...(form.starts_at&&selectedEnd?[{item:{id:row.id,request_data:{...row.request_data,planning:{...form,responsible:'Nueva programación'}}},start:selected,end:selectedEnd,selected:true,conflict:conflicts.length>0}]:[])]
  const segments=entries.flatMap(entry=>days.flatMap((day,dayIndex)=>{const workStart=new Date(day);workStart.setHours(7,30,0,0);const workEnd=new Date(day);workEnd.setHours(18,0,0,0);const start=new Date(Math.max(entry.start,workStart)),end=new Date(Math.min(entry.end,workEnd));if(start>=end)return[];const startMinute=start.getHours()*60+start.getMinutes(),endMinute=end.getHours()*60+end.getMinutes();return[{...entry,dayIndex,startMinute,endMinute}]}))
  function choose(day,minute){onSelect(`${dayKey(day)}T${clock(minute)}`)}
  return <section className="full-field planning-schedule"><div className="request-toolbar"><h4>Cronograma de {row.request_data.plant_name||'la planta'}</h4><button type="button" onClick={()=>setWeekShift(value=>value-1)}>← Semana anterior</button><button type="button" onClick={()=>setWeekShift(0)}>Semana seleccionada</button><button type="button" onClick={()=>setWeekShift(value=>value+1)}>Semana siguiente →</button></div>
    <p>Horario disponible: lunes a viernes, de 07:30 a 18:00. Pulsa una celda para seleccionar directamente el día y la hora.</p>{error&&<p role="alert">{error}</p>}
    <div className="schedule-scroll"><div className="schedule-grid">
      <div className="schedule-corner">Hora</div>{days.map((day,index)=><div className={`schedule-header${dayKey(day)===form.starts_at?.slice(0,10)?' selected':''}`} style={{gridColumn:index+2}} key={dayKey(day)}><strong>{day.toLocaleDateString('es-EC',{weekday:'long'})}</strong><span>{day.toLocaleDateString('es-EC',{day:'2-digit',month:'2-digit'})}</span></div>)}
      {slots.map((minute,rowIndex)=><div className="schedule-time" style={{gridRow:rowIndex+2}} key={minute}>{clock(minute)}</div>)}
      {days.flatMap((day,dayIndex)=>slots.map((minute,rowIndex)=><button type="button" aria-label={`${dayKey(day)} ${clock(minute)}`} title="Seleccionar este horario" className={`schedule-cell${dayKey(day)===form.starts_at?.slice(0,10)&&form.starts_at?.slice(11,16)===clock(minute)?' selected':''}`} style={{gridColumn:dayIndex+2,gridRow:rowIndex+2}} onClick={()=>choose(day,minute)} key={`${dayKey(day)}-${minute}`}/>))}
      {segments.map(segment=>{const startRow=Math.floor((segment.startMinute-START_MINUTES)/SLOT_MINUTES)+2,span=Math.max(1,Math.ceil((segment.endMinute-segment.startMinute)/SLOT_MINUTES)),plan=segment.item.request_data.planning,peers=segments.filter(other=>other.dayIndex===segment.dayIndex&&other.startMinute<segment.endMinute&&other.endMinute>segment.startMinute),lane=peers.indexOf(segment),laneWidth=100/peers.length;return <div className={`schedule-event${segment.selected?' proposed':''}${segment.conflict?' conflict':''}`} style={{gridColumn:segment.dayIndex+2,gridRow:`${startRow} / span ${span}`,width:`calc(${laneWidth}% - 6px)`,marginLeft:`calc(${lane*laneWidth}% + 3px)`}} key={`${segment.item.id}-${segment.dayIndex}`}><strong>{segment.selected?'Selección':`#${segment.item.id}`} · {plan.responsible}</strong><span>{clock(segment.startMinute)}–{clock(segment.endMinute)}</span><small>{segment.item.request_data.target_area||segment.item.request_data.machine_name}</small></div>})}
    </div></div>
    {conflicts.length?<p role="alert">Cruce detectado: el responsable ya tiene {conflicts.map(item=>`#${item.id}`).join(', ')} en ese horario.</p>:form.starts_at&&durationMinutes(form)>0?<p role="status">Horario disponible para el responsable seleccionado en esta planta.</p>:<p role="status">Selecciona fecha, duración y responsable para comprobar disponibilidad.</p>}
  </section>
}
