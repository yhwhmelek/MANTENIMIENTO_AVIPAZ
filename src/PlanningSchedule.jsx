import {useEffect,useMemo,useState} from 'react'

const pad=value=>String(value).padStart(2,'0')
const dayKey=date=>`${date.getFullYear()}-${pad(date.getMonth()+1)}-${pad(date.getDate())}`
const durationMinutes=plan=>Number(plan?.estimated_duration_days||0)*1440+Number(plan?.estimated_duration_minutes||0)
const endOf=plan=>plan?.ends_at?new Date(plan.ends_at):plan?.starts_at?new Date(new Date(plan.starts_at).getTime()+durationMinutes(plan)*60000):null
const START_MINUTES=7*60+30,END_MINUTES=18*60,SLOT_MINUTES=30
const slots=Array.from({length:(END_MINUTES-START_MINUTES)/SLOT_MINUTES},(_,index)=>START_MINUTES+index*SLOT_MINUTES)
const clock=value=>`${pad(Math.floor(value/60))}:${pad(value%60)}`
const gridStyle={display:'grid',gridTemplateColumns:'76px repeat(5, minmax(170px, 1fr))',gridTemplateRows:'64px repeat(21, 42px)',minWidth:'980px',position:'relative',background:'#fff'}
const headerStyle={position:'sticky',top:0,zIndex:4,background:'#c6ded6',borderRight:'1px solid #fff',borderBottom:'2px solid #94a3b8',display:'flex',flexDirection:'column',alignItems:'center',justifyContent:'center',gap:'2px',textTransform:'capitalize'}
const timeStyle={position:'sticky',left:0,zIndex:3,gridColumn:1,background:'#f1f5f9',borderRight:'2px solid #94a3b8',borderBottom:'1px solid #d8dee8',padding:'10px 8px',textAlign:'right',fontSize:'13px',fontVariantNumeric:'tabular-nums'}
const cellStyle={zIndex:1,width:'100%',height:'100%',minHeight:0,border:0,borderRight:'1px solid #d8dee8',borderBottom:'1px solid #d8dee8',borderRadius:0,background:'#fff',padding:0}
const palette=[
  {background:'#dbeafe',border:'#2563eb',text:'#1e3a8a'},
  {background:'#fef3c7',border:'#d97706',text:'#78350f'},
  {background:'#ede9fe',border:'#7c3aed',text:'#4c1d95'},
  {background:'#ccfbf1',border:'#0f766e',text:'#134e4a'},
  {background:'#fce7f3',border:'#db2777',text:'#831843'},
  {background:'#e0e7ff',border:'#4f46e5',text:'#312e81'},
  {background:'#dcfce7',border:'#16a34a',text:'#14532d'},
  {background:'#ffedd5',border:'#ea580c',text:'#7c2d12'},
]
const COLOR_STORAGE_KEY='maintenance-schedule-responsible-colors'
const identity=plan=>`${plan?.assignment_type||'USER'}:${plan?.assignment_type==='CONTRACTOR'?plan?.contractor_id:plan?.assigned_user_id}:${plan?.responsible||''}`
const contrastText=hex=>{const value=hex.replace('#',''),r=parseInt(value.slice(0,2),16),g=parseInt(value.slice(2,4),16),b=parseInt(value.slice(4,6),16);return (r*299+g*587+b*114)/1000>150?'#172033':'#ffffff'}
const darken=hex=>`#${hex.replace('#','').match(/.{2}/g).map(value=>Math.round(parseInt(value,16)*.65).toString(16).padStart(2,'0')).join('')}`
const colorFor=(plan,customColors={})=>{const key=identity(plan),custom=customColors[key];if(custom)return{background:custom,border:darken(custom),text:contrastText(custom)};let hash=0;for(const char of key)hash=(hash*31+char.charCodeAt(0))>>>0;return palette[hash%palette.length]}
const loadColors=()=>{try{return JSON.parse(localStorage.getItem(COLOR_STORAGE_KEY)||'{}')}catch{return{}}}
const roleName=plan=>plan?.responsible_role==='CONTRATISTA'?'Contratista':plan?.responsible_role==='MECANICO'?'Mecánico':plan?.responsible_role==='ELECTRICO'?'Eléctrico':plan?.responsible_role||'Responsable'

export default function PlanningSchedule({request,row,form,onSelect}){
  const [rows,setRows]=useState([]),[weekShift,setWeekShift]=useState(0),[error,setError]=useState('')
  const [responsibleColors,setResponsibleColors]=useState(loadColors)
  useEffect(()=>{let active=true;request('/solicitudes-mantenimiento').then(data=>{if(active)setRows(data)}).catch(e=>{if(active)setError(e.message)});return()=>{active=false}},[row.id])
  const selected=form.starts_at?new Date(form.starts_at):new Date()
  const monday=useMemo(()=>{const date=new Date(selected);date.setHours(0,0,0,0);date.setDate(date.getDate()-((date.getDay()+6)%7)+weekShift*7);return date},[form.starts_at,weekShift])
  const days=Array.from({length:5},(_,index)=>{const date=new Date(monday);date.setDate(date.getDate()+index);return date})
  const activities=rows.filter(item=>item.id!==row.id&&String(item.request_data.plant_id)===String(row.request_data.plant_id)&&['PENDIENTE','EN_PROCESO'].includes(item.status)&&item.request_data.planning?.starts_at)
  const selectedEnd=form.starts_at?new Date(selected.getTime()+durationMinutes(form)*60000):null
  const sameResponsible=item=>form.assignment_type===(item.request_data.planning.assignment_type||'USER')&&(form.assignment_type==='CONTRACTOR'?String(form.contractor_id)===String(item.request_data.planning.contractor_id):String(form.assigned_user_id)===String(item.request_data.planning.assigned_user_id))
  const conflicts=activities.filter(item=>{const plan=item.request_data.planning,start=new Date(plan.starts_at),end=endOf(plan);return selectedEnd&&sameResponsible(item)&&selected<end&&selectedEnd>start})
  const entries=[...activities.map(item=>({item,start:new Date(item.request_data.planning.starts_at),end:endOf(item.request_data.planning),selected:false,conflict:conflicts.some(entry=>entry.id===item.id)})),...(form.starts_at&&selectedEnd?[{item:{id:row.id,request_data:{...row.request_data,planning:{...form,responsible:form.responsible||'Selecciona responsable'}}},start:selected,end:selectedEnd,selected:true,conflict:conflicts.length>0}]:[])]
  const segments=entries.flatMap(entry=>days.flatMap((day,dayIndex)=>{const workStart=new Date(day);workStart.setHours(7,30,0,0);const workEnd=new Date(day);workEnd.setHours(18,0,0,0);const start=new Date(Math.max(entry.start,workStart)),end=new Date(Math.min(entry.end,workEnd));if(start>=end)return[];const startMinute=start.getHours()*60+start.getMinutes(),endMinute=end.getHours()*60+end.getMinutes();return[{...entry,dayIndex,startMinute,endMinute}]}))
  const legend=[...new Map(entries.map(entry=>{const plan=entry.item.request_data.planning;return[identity(plan),plan]})).values()].filter(plan=>plan.responsible&&plan.responsible!=='Selecciona responsable')
  function choose(day,minute){
    // La fecha elegida pasa a ser la referencia; evita volver a aplicar el
    // desplazamiento usado para navegar hasta esta semana.
    setWeekShift(0)
    onSelect(`${dayKey(day)}T${clock(minute)}`)
  }
  function saveColor(plan,color){
    setResponsibleColors(current=>{
      const updated={...current,[identity(plan)]:color}
      try{localStorage.setItem(COLOR_STORAGE_KEY,JSON.stringify(updated))}catch{}
      return updated
    })
  }
  return <section className="full-field planning-schedule"><div className="request-toolbar"><h4>Cronograma de {row.request_data.plant_name||'la planta'}</h4><button type="button" onClick={()=>setWeekShift(value=>value-1)}>← Semana anterior</button><button type="button" onClick={()=>setWeekShift(0)}>Semana seleccionada</button><button type="button" onClick={()=>setWeekShift(value=>value+1)}>Semana siguiente →</button></div>
    <p>Horario disponible: lunes a viernes, de 07:30 a 18:00. Pulsa una celda para seleccionar directamente el día y la hora.</p>{error&&<p role="alert">{error}</p>}
    {!!legend.length&&<><p className="schedule-color-help">Elige el color de cada responsable; se guarda automáticamente en este navegador.</p><div className="schedule-legend" aria-label="Leyenda de responsables">{legend.map(plan=>{const color=colorFor(plan,responsibleColors);return <span className="schedule-legend-item editable" key={identity(plan)}><i style={{background:color.background,borderColor:color.border}}/><strong>{plan.responsible}</strong><small>{roleName(plan)}</small><input type="color" value={responsibleColors[identity(plan)]||color.background} aria-label={`Color de ${plan.responsible}`} title={`Cambiar color de ${plan.responsible}`} onChange={event=>saveColor(plan,event.target.value)}/></span>})}<span className="schedule-legend-item"><i className="conflict-key"/><strong>Cruce</strong><small>Mismo responsable</small></span></div></>}
    <div className="schedule-scroll" style={{maxHeight:'62vh',overflow:'auto',border:'1px solid #cbd5e1',borderRadius:'10px',background:'#fff'}}><div className="schedule-grid" style={gridStyle}>
      <div className="schedule-corner" style={{...headerStyle,left:0,zIndex:5,gridColumn:1,gridRow:1,fontWeight:700}}>Hora</div>{days.map((day,index)=>{const active=dayKey(day)===form.starts_at?.slice(0,10);return <div className={`schedule-header${active?' selected':''}`} style={{...headerStyle,gridColumn:index+2,gridRow:1,background:active?'#a7d8cf':'#c6ded6'}} key={dayKey(day)}><strong>{day.toLocaleDateString('es-EC',{weekday:'long'})}</strong><span>{day.toLocaleDateString('es-EC',{day:'2-digit',month:'2-digit'})}</span></div>})}
      {slots.map((minute,rowIndex)=><div className="schedule-time" style={{...timeStyle,gridRow:rowIndex+2}} key={minute}>{clock(minute)}</div>)}
      {days.flatMap((day,dayIndex)=>slots.map((minute,rowIndex)=>{const active=dayKey(day)===form.starts_at?.slice(0,10)&&form.starts_at?.slice(11,16)===clock(minute);return <button type="button" aria-label={`${dayKey(day)} ${clock(minute)}`} title="Seleccionar este horario" className={`schedule-cell${active?' selected':''}`} style={{...cellStyle,gridColumn:dayIndex+2,gridRow:rowIndex+2,background:active?'#bfdbfe':'#fff',boxShadow:active?'inset 0 0 0 2px #2563eb':'none'}} onClick={()=>choose(day,minute)} key={`${dayKey(day)}-${minute}`}/>}))}
      {segments.map(segment=>{const startRow=Math.floor((segment.startMinute-START_MINUTES)/SLOT_MINUTES)+2,span=Math.max(1,Math.ceil((segment.endMinute-segment.startMinute)/SLOT_MINUTES)),plan=segment.item.request_data.planning,color=colorFor(plan,responsibleColors),peers=segments.filter(other=>other.dayIndex===segment.dayIndex&&other.startMinute<segment.endMinute&&other.endMinute>segment.startMinute),lane=peers.indexOf(segment),laneWidth=100/peers.length;return <div className={`schedule-event${segment.selected?' proposed':''}${segment.conflict?' conflict':''}`} style={{gridColumn:segment.dayIndex+2,gridRow:`${startRow} / span ${span}`,width:`calc(${laneWidth}% - 6px)`,marginLeft:`calc(${lane*laneWidth}% + 3px)`,zIndex:segment.selected?3:2,pointerEvents:'none',marginTop:'2px',marginBottom:'2px',padding:'6px',overflow:'hidden',borderLeft:`5px solid ${color.border}`,outline:segment.conflict?'3px solid #dc2626':segment.selected?'2px dashed #15803d':'none',borderRadius:'5px',background:color.background,color:color.text,display:'flex',flexDirection:'column',fontSize:'12px',boxShadow:'0 1px 3px #64748b55'}} key={`${segment.item.id}-${segment.dayIndex}`}><strong>{segment.selected?'Selección':`#${segment.item.id}`} · {plan.responsible}</strong><span>{clock(segment.startMinute)}–{clock(segment.endMinute)}</span><small>{roleName(plan)} · {segment.item.request_data.target_area||segment.item.request_data.machine_name}</small></div>})}
    </div></div>
    {conflicts.length?<p role="alert">Cruce detectado: el responsable ya tiene {conflicts.map(item=>`#${item.id}`).join(', ')} en ese horario.</p>:form.starts_at&&durationMinutes(form)>0?<p role="status">Horario disponible para el responsable seleccionado en esta planta.</p>:<p role="status">Selecciona fecha, duración y responsable para comprobar disponibilidad.</p>}
  </section>
}
