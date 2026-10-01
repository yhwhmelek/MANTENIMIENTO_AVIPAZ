import {useEffect,useState} from 'react'

export default function PreventiveHourAlerts({apiUrl,token,section,onOpen}) {
  const [alerts,setAlerts] = useState([]), [error,setError] = useState('')
  useEffect(()=>{
    const controller=new AbortController();let busy=false
    async function refresh(){if(busy||controller.signal.aborted)return;busy=true;try{
      const r=await fetch(`${apiUrl}/preventivos/alertas-horas`,{headers:{Authorization:`Bearer ${token}`},signal:controller.signal})
      if(!r.ok)throw new Error('No se pudieron verificar los avisos por horas.');const data=await r.json();setAlerts(data);setError('')
    }catch(e){if(e.name!=='AbortError')setError(e.message)}finally{busy=false}}
    refresh();const timer=setInterval(refresh,30000);window.addEventListener('focus',refresh);window.addEventListener('preventive-hours-updated',refresh)
    return()=>{controller.abort();clearInterval(timer);window.removeEventListener('focus',refresh);window.removeEventListener('preventive-hours-updated',refresh)}
  },[apiUrl,token,section])
  return <div className="preventive-hour-alerts"><h4>Mantenimiento por horas</h4>{error&&<p role="alert">{error}</p>}
    {alerts.map(a=><div className="request-alert-work" key={a.plan_id}><div><strong>{a.activity}</strong><p>{a.machines.length} máquina(s) con mantenimiento próximo o vencido.</p><ul>{a.machines.map(m=><li key={m.machine_id}>Máquina #{m.machine_id}: {m.state==='VENCIDO'?`vencido por ${Math.abs(Number(m.remaining_hours))} h`:`faltan ${m.remaining_hours} h`}</li>)}</ul><button onClick={onOpen}>Revisar en preventivos</button></div></div>)}
    {!error&&!alerts.length&&<p>Sin avisos próximos según las lecturas registradas.</p>}
  </div>
}
