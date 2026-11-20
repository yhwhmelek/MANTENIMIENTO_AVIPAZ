import {useCallback,useEffect,useState} from 'react'

export default function PreventiveHourHistory({request,machines}){
  const [plans,setPlans]=useState([]),[error,setError]=useState('')
  const load=useCallback(()=>request('/preventivos/estado-horas').then(setPlans).catch(e=>setError(e.message)),[request])
  useEffect(()=>{load()},[load])
  const name=id=>{const machine=machines.find(item=>item.machine_id===id);return machine?`${machine.asset_code} · ${machine.name}`:`Máquina ${id}`}
  const rows=plans.flatMap(plan=>plan.machines.flatMap(machine=>(machine.history||[]).map((item,index)=>({...item,key:`${plan.plan_id}-${machine.machine_id}-${index}`,activity:plan.activity,machine:name(machine.machine_id),element:plan.element_id?`${plan.element_code?`${plan.element_code} · `:''}${plan.element_name}`:'Máquina completa'}))))
  return <section className="request-detail"><h3>Historial de mantenimientos por horas</h3>{error&&<p role="alert">{error}</p>}{!error&&!rows.length&&<p>No hay mantenimientos por horas registrados todavía.</p>}{rows.length>0&&<div className="table-scroll"><table><thead><tr><th>Actividad</th><th>Máquina</th><th>Elemento / alcance</th><th>Horómetro</th><th>Fecha</th><th>Origen / observación</th></tr></thead><tbody>{rows.map(item=><tr key={item.key}><td>{item.activity}</td><td>{item.machine}</td><td>{item.element}</td><td>{item.service_hours} h</td><td>{item.service_date||'—'}</td><td>{item.source}{item.notes?` · ${item.notes}`:''}</td></tr>)}</tbody></table></div>}</section>
}
