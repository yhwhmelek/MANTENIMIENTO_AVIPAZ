import { useEffect, useRef, useState } from 'react'
import RequisitionHistory from './RequisitionHistory'
import SparePartCombobox from './SparePartCombobox'
import signatureImage from './firma_correo.jpg'

const newItem = () => ({ item_type:'MATERIAL',description:'',quantity:'1',unit:'UNIDAD',specifications:'' })
const consumableOptions = ['GLP','Diésel','Gasolina','Energía eléctrica','Agua','Otro consumible']
const DEFAULT_MAIL_TO = 'adquisiciones@avipaz.ec'
const DEFAULT_MAIL_CC = 'compras@avipaz.ec, mantenimientosamanga@avipaz.ec'
const fileBase64 = file => new Promise((resolve,reject)=>{
  const reader=new FileReader()
  reader.onload=()=>resolve({filename:file.name,content_base64:reader.result.split(',')[1]})
  reader.onerror=()=>reject(new Error(`No se pudo leer ${file.name}. Selecciona el archivo nuevamente.`))
  reader.onabort=()=>reject(new Error('Se cancelo la lectura del archivo.'))
  reader.readAsDataURL(file)
})
const today = () => {const d=new Date();return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`}

export default function PurchaseRequisition({ apiUrl, token, currentUser, initialRequestType='MATERIAL' }) {
  const [form,setForm]=useState({department:'Mantenimiento',supplier:'',requested_on:today(),delivery_on:'',urgent:false,machine_codes:'',observations:'',requester:currentUser.nombre_completo || currentUser.nombre,items:[{...newItem(),item_type:initialRequestType}]})
  const [catalog,setCatalog]=useState({parts:[],suppliers:[],machines:[],towers:[]})
  const [machineParts,setMachineParts]=useState({})
  const [partSuppliers,setPartSuppliers]=useState({})
  const [requestType,setRequestType]=useState(initialRequestType)
  const [selectedTower,setSelectedTower]=useState('')
  const [selectedMachine,setSelectedMachine]=useState('')
  const [machineSearch,setMachineSearch]=useState('')
  const [catalogError,setCatalogError]=useState(''),[error,setError]=useState(''),[message,setMessage]=useState(''),[busy,setBusy]=useState(false)
  const [revision,setRevision]=useState(0)
  const [editing,setEditing]=useState(null)
  const editor=useRef(null)
  const saved=useRef(null)
  const submitting=useRef(false)
  const [mailDraft,setMailDraft]=useState(null)
  const [attachments,setAttachments]=useState([])
  useEffect(()=>{if(!mailDraft)setAttachments([])},[mailDraft])
  useEffect(()=>{if(mailDraft)setMail(current=>({...current,to:current.to||DEFAULT_MAIL_TO,cc:current.cc||DEFAULT_MAIL_CC}))},[mailDraft])
  function addAttachments(event){
    const files=[...attachments,...Array.from(event.target.files||[])]
    event.target.value=''
    if(files.length>10){setError('Puedes adjuntar hasta 10 archivos.');return}
    if(files.some(file=>!file.size||file.size>5*1024*1024)){setError('Cada archivo debe contener datos y pesar como maximo 5 MB.');return}
    if(files.reduce((total,file)=>total+file.size,0)>15*1024*1024){setError('Los adjuntos no pueden superar 15 MB en total.');return}
    setAttachments(files);setError('')
  }
  const [mail,setMail]=useState({to:'',cc:'',subject:'Requisición de compra - Mantenimiento',body:'Estimados,\n\nAdjunto la requisición de compra para su revisión y gestión. Agradezco confirmar la recepción e informar la disponibilidad y el plazo estimado de entrega.\n\nSaludos cordiales,'})
  const [recipients,setRecipients]=useState([]),[recipientsError,setRecipientsError]=useState('')
  useEffect(()=>{
    if(!mailDraft)return
    const controller=new AbortController()
    fetch(`${apiUrl}/contactos-correo`,{headers:{Authorization:`Bearer ${token}`},signal:controller.signal})
      .then(async response=>{const data=await response.json();if(!response.ok)throw new Error(data.detail||'No se pudieron cargar los contactos.');setRecipients(data);setRecipientsError('')})
      .catch(err=>{if(err.name!=='AbortError')setRecipientsError(err.message)})
    return()=>controller.abort()
  },[apiUrl,token,mailDraft])
  function addRecipient(field,email){
    if(!email)return
    setMail(current=>{
      const addresses=current[field].split(/[,;\s]+/).map(value=>value.trim()).filter(Boolean)
      if(!addresses.some(value=>value.toLowerCase()===email.toLowerCase()))addresses.push(email)
      return {...current,[field]:addresses.join(', ')}
    })
  }
  async function sendMail(event){
    event.preventDefault();if(submitting.current)return
    if(!window.confirm(`¿Enviar la requisición Excel${attachments.length?` y ${attachments.length} archivo(s) adjunto(s)`:''} a los destinatarios y copias indicados?`))return
    submitting.current=true;setBusy(true);setError('');setMessage('')
    const addresses=value=>value.split(/[,;\s]+/).map(v=>v.trim()).filter(Boolean)
    try{
      const files=await Promise.all(attachments.map(fileBase64))
      const response=await fetch(`${apiUrl}/requisiciones-compra/enviar`,{method:'POST',headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},body:JSON.stringify({requisition:mailDraft,...mail,to:addresses(mail.to),cc:addresses(mail.cc),attachments:files})})
      const data=await response.json()
      if(!response.ok)throw new Error(typeof data.detail==='string'?data.detail:'Revisa los correos, el asunto y los datos de la requisición.')
      setMessage(data.message);setMailDraft(null)
    }catch(err){setError(err.message)}finally{submitting.current=false;setBusy(false)}
  }
  useEffect(()=>{
    const controller=new AbortController()
    Promise.all(['/repuestos','/proveedores','/maquinas','/torres'].map(async path=>{
      const response=await fetch(`${apiUrl}${path}`,{headers:{Authorization:`Bearer ${token}`},signal:controller.signal})
      if(!response.ok)throw new Error('No se pudieron cargar los catálogos. Puedes completar los datos manualmente.')
      return response.json()
    })).then(([parts,suppliers,machines,towers])=>setCatalog({parts:parts.filter(p=>p.active),suppliers:suppliers.filter(p=>p.active),machines,towers}))
      .catch(err=>{if(err.name!=='AbortError')setCatalogError(err.message)})
    return()=>controller.abort()
  },[apiUrl,token])
  function editRequisition(row){
    if(submitting.current)return
    setEditing(row);setForm({...row.requisition,delivery_on:row.requisition.delivery_on||'',items:row.requisition.items.map(i=>({...i}))})
    const first=row.requisition.items[0]||{}
    setRequestType(first.item_type||'MATERIAL');setSelectedTower(first.tower_id?String(first.tower_id):'');setSelectedMachine(first.machine_id?String(first.machine_id):'')
    const machine=catalog.machines.find(item=>String(item.machine_id)===String(first.machine_id));setMachineSearch(machine?`${machine.asset_code} · ${machine.name}`:'')
    if(first.machine_id)loadMachineParts(String(first.machine_id))
    saved.current=null;setMailDraft(null);setError('');setMessage('')
    editor.current?.scrollIntoView({behavior:'smooth',block:'start'})
  }
  function newRequisition(){
    setEditing(null);saved.current=null;setMailDraft(null);setError('');setMessage('')
    setForm({department:'Mantenimiento',supplier:'',requested_on:today(),delivery_on:'',urgent:false,machine_codes:'',observations:'',requester:currentUser.nombre_completo || currentUser.nombre,items:[{...newItem(),item_type:initialRequestType}]})
    setRequestType(initialRequestType);setSelectedTower('');setSelectedMachine('');setMachineSearch('')
  }
  function change(key,value){setForm(f=>({...f,[key]:value}))}
  function itemChange(index,key,value){setForm(f=>({...f,items:f.items.map((item,i)=>i===index?{...item,[key]:value}:item)}))}
  function usePart(index,id){
    const part=catalog.parts.find(p=>String(p.spare_part_id)===id)
    if(!part)return
    loadPartSuppliers(part.spare_part_id)
    setForm(f=>({...f,items:f.items.map((item,i)=>i===index?{...item,spare_part_id:part.spare_part_id,description:part.description.slice(0,160),unit:part.unit_of_measure,specifications:[part.internal_code,part.brand,part.model,part.part_number].filter(Boolean).join(' · ').slice(0,500)}:item)}))
  }
  async function loadMachineParts(machineId){
    if(!machineId||machineParts[machineId])return
    try{const response=await fetch(`${apiUrl}/maquinas/${machineId}/repuestos`,{headers:{Authorization:`Bearer ${token}`}});const data=await response.json();if(!response.ok)throw new Error(data.detail||'No se pudieron cargar los repuestos de la máquina.');setMachineParts(current=>({...current,[machineId]:data}))}catch(err){setError(err.message)}
  }
  async function loadPartSuppliers(partId){
    if(!partId||partSuppliers[partId])return
    try{const response=await fetch(`${apiUrl}/repuestos/${partId}/proveedores`,{headers:{Authorization:`Bearer ${token}`}});const data=await response.json();if(!response.ok)throw new Error(data.detail||'No se pudieron cargar los proveedores del repuesto.');setPartSuppliers(current=>({...current,[partId]:data}))}catch(err){setError(err.message)}
  }
  function selectContextMachine(machineId){
    const machine=catalog.machines.find(item=>String(item.machine_id)===String(machineId))
    setSelectedMachine(String(machineId));setMachineSearch(machine?`${machine.asset_code} · ${machine.name}`:'');loadMachineParts(machineId)
    setForm(current=>({...current,items:current.items.map(item=>({...item,tower_id:machine?.tower_id||null,machine_id:Number(machineId)||null,spare_part_id:null,supplier_id:null}))}))
  }
  function searchContextMachine(value){
    setMachineSearch(value)
    const machine=catalog.machines.find(item=>String(item.tower_id)===String(selectedTower)&&(`${item.asset_code} · ${item.name}`.toLowerCase()===value.trim().toLowerCase()||item.asset_code?.toLowerCase()===value.trim().toLowerCase()||item.name?.toLowerCase()===value.trim().toLowerCase()))
    if(machine)selectContextMachine(String(machine.machine_id))
    else {setSelectedMachine('');setForm(current=>({...current,items:current.items.map(item=>({...item,machine_id:null,spare_part_id:null,supplier_id:null}))}))}
  }
  function selectRequestType(type){
    setRequestType(type);setSelectedTower('');setSelectedMachine('');setMachineSearch('')
    setForm(current=>({...current,items:current.items.map(item=>({...item,item_type:type,tower_id:null,machine_id:null,spare_part_id:null,supplier_id:null,unit:type==='SERVICIO'?'SERVICIO':'UNIDAD'}))}))
  }
  async function generate(event){
    event.preventDefault();if(submitting.current)return
    const action=event.nativeEvent.submitter?.value
    submitting.current=true;setBusy(true);setError('');setMessage('')
    try{
      const contextMachine=catalog.machines.find(machine=>String(machine.machine_id)===String(selectedMachine))
      const supplierNames=[...new Set(form.items.map(item=>(partSuppliers[item.spare_part_id]||[]).find(s=>String(s.supplier_id)===String(item.supplier_id))?.supplier_name).filter(Boolean))]
      const payload={...form,supplier:requestType==='MATERIAL'?(supplierNames.length===1?supplierNames[0]:supplierNames.length>1?'Varios proveedores':''):form.supplier,machine_codes:contextMachine?.asset_code||'',delivery_on:form.urgent?null:form.delivery_on||null,items:form.items.map(item=>({...item,item_type:requestType,tower_id:requestType==='MATERIAL'&&selectedTower?Number(selectedTower):null,machine_id:requestType==='MATERIAL'&&selectedMachine?Number(selectedMachine):null,spare_part_id:requestType==='MATERIAL'?item.spare_part_id:null,supplier_id:requestType==='MATERIAL'?item.supplier_id:null,unit:requestType==='SERVICIO'?item.unit||'SERVICIO':item.unit}))}
      const fingerprint=JSON.stringify(payload)
      let id=saved.current?.fingerprint===fingerprint?saved.current.id:null
      if(!id){
        const result=await fetch(`${apiUrl}/requisiciones-compra${editing?`/${editing.id}`:''}`,{method:editing?'PUT':'POST',headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},body:editing?JSON.stringify({original:editing.requisition,requisition:payload}):fingerprint})
        const data=await result.json()
        if(!result.ok)throw new Error(typeof data.detail==='string'?data.detail:'Revisa los datos de la requisición.')
        if(editing)setEditing(row=>({...row,requisition:payload,status:data.status}))
        id=data.id;saved.current={id,fingerprint};setRevision(v=>v+1);window.dispatchEvent(new Event('requisitions-updated'))
      }
      setMessage(`Requisición #${id} guardada. ${editing?.status==='RECIBIDA'?'Los datos de compra e inventario se conservan.':'Pendiente de recepción por un administrador.'}`)
      if(action==='email'){setMail(current=>({...current,to:DEFAULT_MAIL_TO,cc:DEFAULT_MAIL_CC}));setMailDraft(payload);return}
      if(action!=='excel')return
      const response=await fetch(`${apiUrl}/requisiciones-compra/${id}/archivo`,{headers:{Authorization:`Bearer ${token}`}})
      if(!response.ok){const data=await response.json().catch(()=>({}));throw new Error(typeof data.detail==='string'?data.detail:'Revisa los campos, las fechas y las cantidades ingresadas.')}
      const blob=await response.blob(),url=URL.createObjectURL(blob),a=document.createElement('a')
      a.href=url;a.download=`CO-01-01_Requisicion_${form.requested_on}.xlsx`;document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),60000)
      setMessage(`Requisición #${id} guardada y Excel generado.`)
    }catch(err){setError(err.message)}finally{submitting.current=false;setBusy(false)}
  }
  return <>
    <div className="page-heading"><div><p className="eyebrow">{initialRequestType==='CONSUMIBLE'?'ENERGÍA / CONSUMIBLES':'ADQUISICIONES'}</p><h1>{initialRequestType==='CONSUMIBLE'?'Energía y consumibles':'Requisición de compra'}</h1><p>{initialRequestType==='CONSUMIBLE'?'Registra GLP, diésel, gasolina, energía eléctrica, agua y otros consumibles.':'Guarda el pedido, consulta su historial y confirma la llegada para ingresar la compra al inventario.'}</p></div></div>
    <p>La requisición queda pendiente hasta que un administrador confirme la recepción con las cantidades y precios reales. Puedes incluir hasta 11 ítems.</p>
    {catalogError&&<p role="status">{catalogError}</p>}
    <div ref={editor}/>
    {editing&&<p role="status">Editando requisición #{editing.id}. {editing.status==='RECIBIDA'?'Ya fue recibida: estos cambios modifican el documento; las compras, la factura y el inventario conservan los datos de la recepción original.':'Los cambios se guardan en la misma requisición pendiente.'}</p>}
    {editing&&<button type="button" disabled={busy} onClick={newRequisition}>Salir de edición / Nueva requisición</button>}
    <form onSubmit={generate}><fieldset disabled={busy} className="request-fields"><div className="motor-form-grid">
      <label>Departamento *<input required maxLength={80} value={form.department} onChange={e=>change('department',e.target.value)}/></label>
      <label>Fecha del pedido *<input required type="date" value={form.requested_on} onChange={e=>change('requested_on',e.target.value)}/></label>
      <label>Fecha de entrega {form.urgent?'(urgente)':'*'}<input type="date" required={!form.urgent} disabled={form.urgent} min={form.requested_on} value={form.delivery_on} onChange={e=>change('delivery_on',e.target.value)}/></label>
      <label className="checkbox-field"><input type="checkbox" checked={form.urgent} onChange={e=>setForm(f=>({...f,urgent:e.target.checked,delivery_on:e.target.checked?'':f.delivery_on}))}/> Entrega urgente / ASAP</label>
      <label>Tipo de requisición *<select value={requestType} onChange={e=>selectRequestType(e.target.value)}><option value="MATERIAL">Repuestos</option><option value="SERVICIO">Servicios</option><option value="CONSUMIBLE">Energía / consumibles</option></select></label>
      {requestType==='MATERIAL'&&<><label>Torre<select value={selectedTower} onChange={e=>{setSelectedTower(e.target.value);setSelectedMachine('');setMachineSearch('');setForm(current=>({...current,items:current.items.map(item=>({...item,tower_id:e.target.value?Number(e.target.value):null,machine_id:null,spare_part_id:null,supplier_id:null}))}))}}><option value="">Selecciona una torre</option>{catalog.towers.map(t=><option key={t.tower_id} value={t.tower_id}>{t.plant_name} · {t.name}</option>)}</select></label><label>Máquina<input list="requisition-context-machine" disabled={!selectedTower} value={machineSearch} placeholder={selectedTower?'Escribe código o nombre de máquina':'Selecciona primero una torre'} onChange={e=>searchContextMachine(e.target.value)}/><datalist id="requisition-context-machine">{catalog.machines.filter(m=>String(m.tower_id)===String(selectedTower)).map(m=><option key={m.machine_id} value={`${m.asset_code} · ${m.name}`} />)}</datalist></label></>}
      <label>Nombre del solicitante *<input required maxLength={201} value={form.requester} onChange={e=>change('requester',e.target.value)}/></label>
    </div>
    <h2>Productos, bienes o servicios</h2>
    {form.items.map((item,index)=><section className="request-detail" key={index}><div className="request-toolbar"><strong>Ítem {index+1}</strong><button type="button" className="secondary-action" disabled={form.items.length===1} onClick={()=>change('items',form.items.filter((_,i)=>i!==index))}>Quitar ítem</button></div><div className="motor-form-grid">
      {requestType==='MATERIAL'&&<>
        {selectedMachine?<SparePartCombobox parts={(machineParts[selectedMachine]||[]).map(p=>({...p,active:true}))} value={item.spare_part_id||''} onChange={id=>id?usePart(index,id):(itemChange(index,'spare_part_id',null),itemChange(index,'supplier_id',null))} />:<p className="full-field field-help">Selecciona una máquina al inicio para buscar sus repuestos específicos.</p>}
        <label className="full-field">Otros repuestos del inventario<select value="" onChange={e=>usePart(index,e.target.value)}><option value="">Selecciona un repuesto general</option>{catalog.parts.filter(p=>!(machineParts[selectedMachine]||[]).some(mp=>mp.spare_part_id===p.spare_part_id)).map(p=><option key={p.spare_part_id} value={p.spare_part_id}>{p.internal_code} · {p.description}</option>)}</select></label>
        {item.spare_part_id&&<label>Proveedor del repuesto<select value={item.supplier_id||''} onChange={e=>itemChange(index,'supplier_id',e.target.value)}><option value="">Selecciona un proveedor</option>{(partSuppliers[item.spare_part_id]||[]).map(s=><option key={s.supplier_id} value={s.supplier_id}>{s.supplier_name}{s.preferred_supplier?' · Preferido':''}</option>)}</select><span className="field-help">Solo se muestran proveedores asociados a este repuesto.</span></label>}
      </>}
      {requestType==='SERVICIO'?<label className="full-field">Descripción del servicio *<textarea rows={2} required maxLength={160} value={item.description} onChange={e=>itemChange(index,'description',e.target.value)}/></label>:requestType==='CONSUMIBLE'?<label className="full-field">Consumible / descripción *<input list={`consumable-options-${index}`} required maxLength={160} value={item.description} onChange={e=>itemChange(index,'description',e.target.value)}/><datalist id={`consumable-options-${index}`}>{consumableOptions.map(option=><option key={option} value={option}/>)}</datalist><span className="field-help">Ejemplos: GLP, diésel, gasolina, energía eléctrica o agua.</span></label>:<p className="full-field field-help"><strong>Repuesto seleccionado:</strong> {item.description||'Selecciona un repuesto propio de la máquina o del inventario.'}</p>}
      <label>Cantidad *<input required type="number" min="0.01" max="99999999.99" step="0.01" value={item.quantity} onChange={e=>itemChange(index,'quantity',e.target.value)}/></label>
      {(requestType==='SERVICIO'||requestType==='CONSUMIBLE')&&<><label>Unidad *<input required maxLength={20} placeholder={requestType==='CONSUMIBLE'?'kg, gal, kWh, m³…':'SERVICIO'} value={item.unit} onChange={e=>itemChange(index,'unit',e.target.value)}/></label><label className="full-field">Especificaciones (opcional)<textarea rows={3} maxLength={500} value={item.specifications} onChange={e=>itemChange(index,'specifications',e.target.value)}/></label></>}
    </div></section>)}
    <div className="request-toolbar"><button className="secondary-action" type="button" disabled={form.items.length>=11} onClick={()=>change('items',[...form.items,{...newItem(),item_type:requestType,unit:requestType==='SERVICIO'?'SERVICIO':'UNIDAD'}])}>Añadir ítem ({form.items.length}/11)</button></div>
    <div className="motor-form-grid"><label className="full-field">Observaciones (opcional)<textarea rows={3} maxLength={1000} value={form.observations} onChange={e=>change('observations',e.target.value)}/></label></div>
    <div className="modal-actions"><button className="primary-action">{busy?'Procesando…':editing?'Guardar cambios':'Guardar requisición'}</button><button type="submit" value="excel" className="secondary-action">Guardar y generar Excel</button><button type="submit" value="email" className="secondary-action">Preparar envío por correo</button></div></fieldset></form>
    <RequisitionHistory apiUrl={apiUrl} token={token} isAdmin={currentUser.rol==='ADMIN'} catalog={catalog} revision={revision} onEdit={editRequisition} editingBusy={busy}/>
    {mailDraft&&<section className="request-detail"><h2>Revisar correo antes de enviar</h2><p>Adjunto: CO-01-01_Requisicion_{mailDraft.requested_on}.xlsx · {mailDraft.items.length} ítems · Solicitante: {mailDraft.requester}</p><p>Se adjuntarán los datos que tenía el formulario al pulsar Preparar envío. Si modificas la requisición, pulsa ese botón nuevamente.</p><form onSubmit={sendMail}><fieldset disabled={busy} className="request-fields"><div className="motor-form-grid">
      <label>Para *<input required value={mail.to} placeholder="adquisiciones@empresa.ec" onChange={e=>setMail(m=>({...m,to:e.target.value}))}/><select aria-label="Añadir contacto a Para" value="" onChange={e=>addRecipient('to',e.target.value)}><option value="">Añadir contacto a Para…</option>{['Contacto empresarial','Proveedor','Usuario'].map(source=><optgroup key={source} label={source}>{recipients.filter(contact=>contact.source===source).map(contact=><option key={`${source}-${contact.email}`} value={contact.email}>{contact.name} · {contact.email}</option>)}</optgroup>)}</select></label>
      <label>Copia (CC)<input value={mail.cc} placeholder="correo@empresa.ec" onChange={e=>setMail(m=>({...m,cc:e.target.value}))}/><select aria-label="Añadir contacto a Copia" value="" onChange={e=>addRecipient('cc',e.target.value)}><option value="">Añadir contacto a Copia…</option>{['Contacto empresarial','Proveedor','Usuario'].map(source=><optgroup key={source} label={source}>{recipients.filter(contact=>contact.source===source).map(contact=><option key={`${source}-${contact.email}`} value={contact.email}>{contact.name} · {contact.email}</option>)}</optgroup>)}</select></label>
      {recipientsError&&<p className="full-field" role="status">{recipientsError} Puedes escribir las direcciones manualmente.</p>}
      <p className="full-field">Separa varias direcciones con coma o punto y coma.</p>
      <div className="full-field">
        <label>Adjuntar archivos o fotos (opcional)<input type="file" multiple onChange={addAttachments}/></label>
        <p>Hasta 10 archivos, 5 MB por archivo y 15 MB en total. El Excel de la requisición se incluye automáticamente.</p>
        {!!attachments.length&&<ul>{attachments.map((file,index)=><li key={`${file.name}-${index}`}>{file.name} · {(file.size/1024/1024).toFixed(2)} MB <button type="button" className="secondary-action" aria-label={`Quitar ${file.name}`} onClick={()=>setAttachments(files=>files.filter((_,i)=>i!==index))}>Quitar</button></li>)}</ul>}
      </div>
      <label className="full-field">Asunto *<input required maxLength={200} value={mail.subject} onChange={e=>setMail(m=>({...m,subject:e.target.value}))}/></label>
      <label className="full-field">Descripción del correo *<textarea required rows={8} maxLength={10000} value={mail.body} onChange={e=>setMail(m=>({...m,body:e.target.value}))}/></label>
      <div className="full-field"><p>Firma que se incluirá al final del correo:</p><img src={signatureImage} alt="Firma de Cristian Changoluisa, Jefe de Mantenimiento de AVIPAZ" style={{width:800,maxWidth:'100%',height:'auto'}} /></div>
      </div><div className="modal-actions"><button type="button" className="secondary-action" onClick={()=>setMailDraft(null)}>Cancelar</button><button className="primary-action">{busy?'Enviando…':'Enviar correo con Excel'}</button></div></fieldset></form></section>}
    {error&&<p className="admin-message" role="alert">{error}</p>}{message&&<p className="admin-message" role="status">{message}</p>}
  </>
}
