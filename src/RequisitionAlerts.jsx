import {useEffect, useState} from 'react'
import {Bell} from 'lucide-react'

export default function RequisitionAlerts({apiUrl,token,section,onOpen}){
  const [count,setCount]=useState(null),[error,setError]=useState(false)
  useEffect(()=>{
    const controller=new AbortController()
    let busy=false
    async function refresh(){
      if(busy||controller.signal.aborted)return
      busy=true
      try{
        const r=await fetch(`${apiUrl}/requisiciones-compra/pendientes`,{headers:{Authorization:`Bearer ${token}`},signal:controller.signal})
        if(!r.ok)throw new Error()
        const data=await r.json();setCount(data.count);setError(false)
      }catch(e){if(e.name!=='AbortError')setError(true)}finally{busy=false}
    }
    refresh()
    const timer=setInterval(refresh,30000)
    window.addEventListener('focus',refresh)
    window.addEventListener('requisitions-updated',refresh)
    return()=>{controller.abort();clearInterval(timer);window.removeEventListener('focus',refresh);window.removeEventListener('requisitions-updated',refresh)}
  },[apiUrl,token,section])
  return <button className={`stock-alert-trigger ${error||count>0?'needs-attention':''}`} onClick={onOpen} title="Revisar requisiciones y confirmar la llegada para registrar compras e inventario">
    <Bell size={20}/><span role="status">{error?'Requisiciones sin verificar':count===null?'Consultando requisiciones…':`Requisiciones pendientes de llegada: ${count}`}</span>
  </button>
}
