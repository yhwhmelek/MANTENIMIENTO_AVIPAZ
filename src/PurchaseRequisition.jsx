import { useEffect, useRef, useState } from 'react'

const newItem = () => ({ description:'',quantity:'1',unit:'UNIDAD',specifications:'' })
const today = () => {const d=new Date();return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`}

export default function PurchaseRequisition({ apiUrl, token, currentUser }) {
  const [form,setForm]=useState({department:'Mantenimiento',supplier:'',requested_on:today(),delivery_on:'',urgent:false,machine_codes:'',observations:'',requester:currentUser.nombre,items:[newItem()]})
  const [catalog,setCatalog]=useState({parts:[],suppliers:[],machines:[]})
  const [catalogError,setCatalogError]=useState(''),[error,setError]=useState(''),[message,setMessage]=useState(''),[busy,setBusy]=useState(false)
  const submitting=useRef(false)
  const [mailDraft,setMailDraft]=useState(null)
  const [mail,setMail]=useState({to:'',cc:'',subject:'Requisición de compra - Mantenimiento',body:'Estimados,\n\nAdjunto la requisición de compra para su revisión y gestión. Agradezco confirmar la recepción e informar la disponibilidad y el plazo estimado de entrega.\n\nSaludos cordiales,\n'+currentUser.nombre})
  async function sendMail(event){
    event.preventDefault();if(submitting.current)return
    if(!window.confirm('¿Enviar la requisición Excel a los destinatarios y copias indicados?'))return
    submitting.current=true;setBusy(true);setError('');setMessage('')
    const addresses=value=>value.split(/[,;\s]+/).map(v=>v.trim()).filter(Boolean)
    try{
      const response=await fetch(`${apiUrl}/requisiciones-compra/enviar`,{method:'POST',headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},body:JSON.stringify({requisition:mailDraft,...mail,to:addresses(mail.to),cc:addresses(mail.cc)})})
      const data=await response.json()
      if(!response.ok)throw new Error(typeof data.detail==='string'?data.detail:'Revisa los correos, el asunto y los datos de la requisición.')
      setMessage(data.message);setMailDraft(null)
    }catch(err){setError(err.message)}finally{submitting.current=false;setBusy(false)}
  }
  useEffect(()=>{
    const controller=new AbortController()
    Promise.all(['/repuestos','/proveedores','/maquinas'].map(async path=>{
      const response=await fetch(`${apiUrl}${path}`,{headers:{Authorization:`Bearer ${token}`},signal:controller.signal})
      if(!response.ok)throw new Error('No se pudieron cargar los catálogos. Puedes completar los datos manualmente.')
      return response.json()
    })).then(([parts,suppliers,machines])=>setCatalog({parts:parts.filter(p=>p.active),suppliers:suppliers.filter(p=>p.active),machines}))
      .catch(err=>{if(err.name!=='AbortError')setCatalogError(err.message)})
    return()=>controller.abort()
  },[apiUrl,token])
  function change(key,value){setForm(f=>({...f,[key]:value}))}
  function itemChange(index,key,value){setForm(f=>({...f,items:f.items.map((item,i)=>i===index?{...item,[key]:value}:item)}))}
  function usePart(index,id){
    const part=catalog.parts.find(p=>String(p.spare_part_id)===id)
    if(!part)return
    setForm(f=>({...f,items:f.items.map((item,i)=>i===index?{...item,description:part.description.slice(0,160),unit:part.unit_of_measure,specifications:[part.internal_code,part.brand,part.model,part.part_number].filter(Boolean).join(' · ').slice(0,500)}:item)}))
  }
  async function generate(event){
    event.preventDefault();if(submitting.current)return
    if(event.nativeEvent.submitter?.value==='email'){
      setMailDraft({...form,delivery_on:form.urgent?null:form.delivery_on||null});setError('');setMessage('');return
    }
    submitting.current=true;setBusy(true);setError('');setMessage('')
    try{
      const response=await fetch(`${apiUrl}/requisiciones-compra/archivo`,{method:'POST',headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},body:JSON.stringify({...form,delivery_on:form.urgent?null:form.delivery_on||null})})
      if(!response.ok){const data=await response.json().catch(()=>({}));throw new Error(typeof data.detail==='string'?data.detail:'Revisa los campos, las fechas y las cantidades ingresadas.')}
      const blob=await response.blob(),url=URL.createObjectURL(blob),a=document.createElement('a')
      a.href=url;a.download=`CO-01-01_Requisicion_${form.requested_on}.xlsx`;document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),60000)
      setMessage('Archivo Excel generado. Revísalo y adjúntalo a tu envío a Adquisiciones.')
    }catch(err){setError(err.message)}finally{submitting.current=false;setBusy(false)}
  }
  return <>
    <div className="page-heading"><div><p className="eyebrow">ADQUISICIONES</p><h1>Requisición de compra</h1><p>Completa el formato CO/01-01, versión 03, y descarga el archivo Excel para enviarlo a Adquisiciones.</p></div></div>
    <p>Generar el documento no registra una compra ni modifica el stock. Puedes incluir hasta 11 productos, bienes o servicios.</p>
    {catalogError&&<p role="status">{catalogError}</p>}
    <form onSubmit={generate}><fieldset disabled={busy} className="request-fields"><div className="motor-form-grid">
      <label>Departamento *<input required maxLength={80} value={form.department} onChange={e=>change('department',e.target.value)}/></label>
      <label>Proveedor (opcional)<input list="requisition-suppliers" maxLength={120} value={form.supplier} placeholder="Por definir" onChange={e=>change('supplier',e.target.value)}/><datalist id="requisition-suppliers">{catalog.suppliers.map(s=><option key={s.supplier_id} value={s.name}/>)}</datalist></label>
      <label>Fecha del pedido *<input required type="date" value={form.requested_on} onChange={e=>change('requested_on',e.target.value)}/></label>
      <label>Fecha de entrega {form.urgent?'(urgente)':'*'}<input type="date" required={!form.urgent} disabled={form.urgent} min={form.requested_on} value={form.delivery_on} onChange={e=>change('delivery_on',e.target.value)}/></label>
      <label className="checkbox-field"><input type="checkbox" checked={form.urgent} onChange={e=>setForm(f=>({...f,urgent:e.target.checked,delivery_on:e.target.checked?'':f.delivery_on}))}/> Entrega urgente / ASAP</label>
      <label>Código(s) de máquina (opcional)<input list="requisition-machines" maxLength={100} value={form.machine_codes} placeholder="Ej.: MOL-01 / MOL-02" onChange={e=>change('machine_codes',e.target.value)}/><datalist id="requisition-machines">{catalog.machines.map(m=><option key={m.machine_id} value={m.asset_code}>{m.name}</option>)}</datalist></label>
      <label>Nombre del solicitante *<input required maxLength={100} value={form.requester} onChange={e=>change('requester',e.target.value)}/></label>
    </div>
    <h2>Productos, bienes o servicios</h2>
    {form.items.map((item,index)=><section className="request-detail" key={index}><div className="request-toolbar"><strong>Ítem {index+1}</strong><button type="button" className="secondary-action" disabled={form.items.length===1} onClick={()=>change('items',form.items.filter((_,i)=>i!==index))}>Quitar ítem</button></div><div className="motor-form-grid">
      <label className="full-field">Completar desde Inventario (opcional)<select value="" onChange={e=>usePart(index,e.target.value)}><option value="">Selecciona un repuesto o escribe sus datos abajo</option>{catalog.parts.map(p=><option key={p.spare_part_id} value={p.spare_part_id}>{p.internal_code} · {p.description}</option>)}</select></label>
      <label>Producto / bien o servicio *<textarea rows={2} required maxLength={160} value={item.description} onChange={e=>itemChange(index,'description',e.target.value)}/></label>
      <label>Cantidad *<input required type="number" min="0.01" max="99999999.99" step="0.01" value={item.quantity} onChange={e=>itemChange(index,'quantity',e.target.value)}/></label>
      <label>Unidad *<input required maxLength={20} value={item.unit} onChange={e=>itemChange(index,'unit',e.target.value)}/></label>
      <label className="full-field">Especificaciones (opcional)<textarea rows={3} maxLength={500} value={item.specifications} onChange={e=>itemChange(index,'specifications',e.target.value)}/></label>
    </div></section>)}
    <div className="request-toolbar"><button className="secondary-action" type="button" disabled={form.items.length>=11} onClick={()=>change('items',[...form.items,newItem()])}>Añadir ítem ({form.items.length}/11)</button></div>
    <div className="motor-form-grid"><label className="full-field">Observaciones (opcional)<textarea rows={3} maxLength={1000} value={form.observations} onChange={e=>change('observations',e.target.value)}/></label></div>
    <div className="modal-actions"><button className="primary-action">{busy?'Procesando…':'Generar archivo Excel'}</button><button type="submit" value="email" className="secondary-action">Preparar envío por correo</button></div></fieldset></form>
    {mailDraft&&<section className="request-detail"><h2>Revisar correo antes de enviar</h2><p>Adjunto: CO-01-01_Requisicion_{mailDraft.requested_on}.xlsx · {mailDraft.items.length} ítems · Solicitante: {mailDraft.requester}</p><p>Se adjuntarán los datos que tenía el formulario al pulsar Preparar envío. Si modificas la requisición, pulsa ese botón nuevamente.</p><form onSubmit={sendMail}><fieldset disabled={busy} className="request-fields"><div className="motor-form-grid">
      <label>Para *<input required value={mail.to} placeholder="adquisiciones@empresa.ec" onChange={e=>setMail(m=>({...m,to:e.target.value}))}/></label>
      <label>Copia (CC)<input value={mail.cc} placeholder="correo@empresa.ec" onChange={e=>setMail(m=>({...m,cc:e.target.value}))}/></label>
      <p className="full-field">Separa varias direcciones con coma o punto y coma.</p>
      <label className="full-field">Asunto *<input required maxLength={200} value={mail.subject} onChange={e=>setMail(m=>({...m,subject:e.target.value}))}/></label>
      <label className="full-field">Descripción del correo *<textarea required rows={8} maxLength={10000} value={mail.body} onChange={e=>setMail(m=>({...m,body:e.target.value}))}/></label>
      </div><div className="modal-actions"><button type="button" className="secondary-action" onClick={()=>setMailDraft(null)}>Cancelar</button><button className="primary-action">{busy?'Enviando…':'Enviar correo con Excel'}</button></div></fieldset></form></section>}
    {error&&<p className="admin-message" role="alert">{error}</p>}{message&&<p className="admin-message" role="status">{message}</p>}
  </>
}
