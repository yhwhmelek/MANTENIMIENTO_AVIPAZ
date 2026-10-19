import ImageAttachment from './ImageAttachment'
import { imageToDataUrl } from './imageUpload'
import {useEffect, useRef, useState} from 'react'
import signatureImage from './firma_correo.jpg'
import { requestValidationError } from './requestValidationError'

export default function RequisitionHistory({apiUrl,token,isAdmin,catalog,revision,onEdit,editingBusy}){
  const [rows,setRows]=useState([]),[selected,setSelected]=useState(null),[receipt,setReceipt]=useState(null)
  const [error,setError]=useState(''),[busy,setBusy]=useState(false),[refresh,setRefresh]=useState(0)
  const [invoice,setInvoice]=useState(null),[pendingOnly,setPendingOnly]=useState(isAdmin)
  const [uploadStage,setUploadStage]=useState('')
  const submitting=useRef(false)
  const [showMail,setShowMail]=useState(false),[message,setMessage]=useState('')
  const [mail,setMail]=useState({to:'',cc:'',subject:'',body:''})
  const [contacts,setContacts]=useState([]),[contactsError,setContactsError]=useState('')
  useEffect(()=>{
    if(!showMail)return
    const controller=new AbortController()
    fetch(`${apiUrl}/contactos-correo`,{headers:{Authorization:`Bearer ${token}`},signal:controller.signal})
      .then(async r=>{const data=await r.json();if(!r.ok)throw new Error('No se pudieron cargar los contactos. Puedes escribir los correos.');setContacts(data);setContactsError('')})
      .catch(e=>{if(e.name!=='AbortError')setContactsError(e.message)})
    return()=>controller.abort()
  },[showMail,apiUrl,token])
  function addRecipient(field,email){
    if(!email)return
    setMail(current=>{const values=current[field].split(/[,;\s]+/).filter(Boolean);if(!values.some(v=>v.toLowerCase()===email.toLowerCase()))values.push(email);return {...current,[field]:values.join(', ')}})
  }
  const visibleRows=pendingOnly?rows.filter(row=>row.status==='PENDIENTE'):rows
  const headers={Authorization:`Bearer ${token}`,'Content-Type':'application/json'}
  useEffect(()=>{
    const controller=new AbortController()
    fetch(`${apiUrl}/requisiciones-compra`,{headers:{Authorization:`Bearer ${token}`},signal:controller.signal}).then(async r=>{
      const data=await r.json();if(!r.ok)throw new Error(data.detail||'No se pudo cargar el historial')
      setRows(data);setError('')
    }).catch(e=>{if(e.name!=='AbortError')setError(e.message)})
    return()=>controller.abort()
  },[apiUrl,token,revision,refresh])
  function open(row){
    setShowMail(false);setMessage('')
    setMail({to:'',cc:'',subject:`Confirmación de recepción · Requisición #${row.id}`,body:'Estimados,\n\nConfirmamos la recepción del material de la requisición indicada. Se incluyen los datos de la compra y la factura, si fue adjuntada.\n\nSaludos cordiales,'})
    setSelected(row);setError('');setInvoice(null)
    const d=new Date(),today=`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`
    setReceipt({supplier_id:catalog.suppliers.find(s=>s.name===row.requisition.supplier)?.supplier_id||'',purchased_on:today,document_number:'',currency:'USD',items:row.requisition.items.map(i=>({spare_part_id:i.spare_part_id||'',quantity:i.quantity,unit_cost:''}))})
  }
  async function excel(row){
    setBusy(true);setError('')
    try{
      const r=await fetch(`${apiUrl}/requisiciones-compra/${row.id}/archivo`,{headers})
      if(!r.ok)throw new Error('No se pudo generar el Excel guardado')
      const url=URL.createObjectURL(await r.blob()),a=document.createElement('a')
      a.href=url;a.download=`Requisicion_${row.id}.xlsx`;a.click();setTimeout(()=>URL.revokeObjectURL(url),60000)
    }catch(e){setError(e.message)}finally{setBusy(false)}
  }
  async function receive(e){
    e.preventDefault();if(submitting.current)return
    const sendEmail=e.nativeEvent.submitter?.value==='email'
    const addresses=value=>value.split(/[,;\s]+/).filter(Boolean)
    if(sendEmail&&(!addresses(mail.to).length||!mail.subject.trim()||!mail.body.trim())){setError('Completa el destinatario, asunto y mensaje del correo.');return}
    submitting.current=true;setMessage('')
    setBusy(true);setError('')
    try{
      let attachment=null
      if(invoice){
        if(invoice.size>10*1024*1024||!invoice.size)throw new Error('La factura debe tener contenido y pesar como máximo 10 MB.')
        setUploadStage(invoice.type==='application/pdf'?'Leyendo PDF…':'Comprimiendo foto de la factura…')
        const dataUrl=await imageToDataUrl(invoice)
        const filename=dataUrl.startsWith('data:image/webp,')||dataUrl.startsWith('data:image/webp;') ? invoice.name.replace(/\.[^.]+$/, '')+'.webp' : invoice.name
        attachment={filename,content_base64:dataUrl.split(',')[1]}
      }
      setUploadStage(sendEmail?'Guardando recepción y enviando confirmación…':'Guardando recepción…')
      const r=await fetch(`${apiUrl}/requisiciones-compra/${selected.id}/recibir`,{method:'POST',headers,body:JSON.stringify({...receipt,invoice:attachment,confirmation:sendEmail?{...mail,to:addresses(mail.to),cc:addresses(mail.cc)}:null})})
      const data=await r.json();if(!r.ok)throw new Error(requestValidationError(data))
      setSelected(null);setRefresh(v=>v+1)
      setShowMail(false)
      setMessage(`Recepción #${selected.id} guardada e inventario actualizado.${data.confirmation?.error?' El correo no pudo confirmarse: '+data.confirmation.error:data.confirmation?' '+data.confirmation.message:''}`)
      window.dispatchEvent(new Event('requisitions-updated'));window.dispatchEvent(new Event('stock-updated'))
    }catch(e){setError(e.message)}finally{submitting.current=false;setBusy(false);setUploadStage('')}
  }
  async function downloadInvoice(){
    setBusy(true);setError('');setUploadStage('Descargando factura…')
    try{
      const r=await fetch(`${apiUrl}/requisiciones-compra/${selected.id}/factura`,{headers})
      if(!r.ok)throw new Error('No se pudo descargar la factura.')
      const url=URL.createObjectURL(await r.blob()),a=document.createElement('a')
      a.href=url;a.download=selected.receipt.invoice.filename;document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),60000)
    }catch(e){setError(e.message)}finally{setBusy(false);setUploadStage('')}
  }
  function change(key,value){setReceipt(r=>({...r,[key]:value}))}
  function itemChange(index,key,value){setReceipt(r=>({...r,items:r.items.map((i,n)=>n===index?{...i,[key]:value}:i)}))}
  return <section className="request-detail"><h2>Requisiciones guardadas</h2><button type="button" disabled={busy} onClick={()=>setRefresh(v=>v+1)}>Actualizar historial</button>
    <label className="checkbox-field"><input type="checkbox" checked={pendingOnly} onChange={e=>setPendingOnly(e.target.checked)}/> Mostrar solo pendientes de llegada ({rows.filter(row=>row.status==='PENDIENTE').length})</label>
    {error&&<p role="alert">{error}</p>}{message&&<p role="status">{message}</p>}{uploadStage&&<p role="status">{uploadStage}</p>}
    <div className="table-scroll"><table><thead><tr><th>Número</th><th>Fecha</th><th>Solicitante</th><th>Proveedor</th><th>Estado</th><th>Acciones</th></tr></thead><tbody>{visibleRows.map(row=><tr key={row.id}><td>#{row.id}</td><td>{row.requisition.requested_on}</td><td>{row.requisition.requester}</td><td>{row.requisition.supplier||'Por definir'}</td><td>{row.status==='RECIBIDA'?'Recibida':'Pendiente de recepción'}</td><td>{isAdmin&&<button disabled={busy||editingBusy} onClick={()=>{setSelected(null);onEdit(row)}}>Editar</button>} <button disabled={busy} onClick={()=>open(row)}>Ver detalle</button> <button disabled={busy} onClick={()=>excel(row)}>Excel</button></td></tr>)}</tbody></table></div>
    {!visibleRows.length&&!error&&<p>{pendingOnly?'No hay requisiciones pendientes de llegada.':'No hay requisiciones guardadas.'}</p>}
    {selected&&<section className="request-detail"><h3>Requisición #{selected.id}</h3><p>{selected.requisition.department} · {selected.requisition.requester} · Entrega: {selected.requisition.urgent?'Urgente':selected.requisition.delivery_on}</p><p>Máquinas: {selected.requisition.machine_codes||'No aplica'}</p><p>{selected.requisition.observations}</p>
      {selected.requisition.items.map((item,i)=><p key={i}><strong>{i+1}. {item.description}</strong> · {item.quantity} {item.unit}<br/>{item.specifications}</p>)}
      {selected.receipt?.invoice&&<button type="button" disabled={busy} onClick={downloadInvoice}>Descargar factura: {selected.receipt.invoice.filename}</button>}
      {selected.receipt&&<><h3>Compra registrada</h3><p>Documento: {selected.receipt.document_number} · Fecha: {selected.receipt.purchased_on} · Administrador: {selected.received_by}</p>{selected.receipt.items.map((item,i)=><p key={i}>{(selected.receipt.requisition_at_receipt||selected.requisition).items[i]?.description||'Item recibido'}: {item.quantity} × {item.unit_cost} {selected.receipt.currency} · Compra #{selected.receipt.purchase_ids[i]}</p>)}</>}
      {isAdmin&&selected.status==='PENDIENTE'&&<form onSubmit={receive}><fieldset disabled={busy} className="request-fields"><h3>Confirmar llegada y registrar compra</h3><p>Indica las cantidades efectivamente recibidas y el precio unitario. Esta confirmación cierra la requisición. Para productos nuevos, crea primero el repuesto en Inventario. Los servicios no se ingresan como existencias.</p><div className="motor-form-grid">
        <label>Proveedor *<select required value={receipt.supplier_id} onChange={e=>change('supplier_id',e.target.value)}><option value="">Selecciona</option>{catalog.suppliers.map(s=><option key={s.supplier_id} value={s.supplier_id}>{s.name}</option>)}</select></label>
        <label>Fecha de recepción *<input required type="date" min={selected.requisition.requested_on} value={receipt.purchased_on} onChange={e=>change('purchased_on',e.target.value)}/></label>
        <label>Factura / documento *<input required maxLength={100} value={receipt.document_number} onChange={e=>change('document_number',e.target.value)}/></label>
        <ImageAttachment label="Adjuntar factura (opcional: PDF o foto, máximo 10 MB)" key={selected.id} accept=".pdf,.jpg,.jpeg,.png,.webp" onChange={e=>{setInvoice(e.target.files?.[0]||null);setError('')}} help="" />
        <label>Moneda *<input required pattern="[A-Z]{3}" maxLength={3} value={receipt.currency} onChange={e=>change('currency',e.target.value.toUpperCase())}/></label>
      </div>{receipt.items.map((item,i)=><div className="request-detail" key={i}><strong>{selected.requisition.items[i].description} · Unidad: {selected.requisition.items[i].unit}</strong><div className="motor-form-grid">
        <label>Repuesto de inventario *<select required value={item.spare_part_id} onChange={e=>itemChange(i,'spare_part_id',e.target.value)}><option value="">Selecciona</option>{catalog.parts.map(p=><option key={p.spare_part_id} value={p.spare_part_id}>{p.internal_code} · {p.description} ({p.unit_of_measure})</option>)}</select></label>
        <label>Cantidad recibida *<input required type="number" min="0.01" max="99999999.99" step="0.01" value={item.quantity} onChange={e=>itemChange(i,'quantity',e.target.value)}/></label>
        <label>Precio unitario *<input required type="number" min="0" step="0.0001" value={item.unit_cost} onChange={e=>itemChange(i,'unit_cost',e.target.value)}/></label>
      </div></div>)}
      {showMail&&<section className="request-detail"><h3>Correo de confirmación de llegada</h3><p>Se guardará la recepción y se enviará el Excel de la requisición, el resumen de lo recibido y la factura seleccionada{invoice?`: ${invoice.name}`:' (sin factura adjunta)'}. La factura también quedará disponible en el historial.</p>
        {contactsError&&<p role="alert">{contactsError}</p>}
        <div className="motor-form-grid">{[['to','Para *'],['cc','Copia (CC)']].map(([field,label])=><label key={field}>{label}<input value={mail[field]} placeholder="correo@empresa.ec" onChange={e=>setMail(m=>({...m,[field]:e.target.value}))}/><select aria-label={`Añadir contacto a ${label}`} value="" onChange={e=>addRecipient(field,e.target.value)}><option value="">Añadir contacto…</option>{contacts.map((contact,i)=><option key={`${contact.email}-${i}`} value={contact.email}>{contact.name} · {contact.email}</option>)}</select></label>)}
        <label className="full-field">Asunto *<input maxLength={200} value={mail.subject} onChange={e=>setMail(m=>({...m,subject:e.target.value}))}/></label>
        <label className="full-field">Mensaje *<textarea rows={6} maxLength={10000} value={mail.body} onChange={e=>setMail(m=>({...m,body:e.target.value}))}/></label></div>
        <p>Firma del correo:</p><img src={signatureImage} alt="Firma de Mantenimiento AVIPAZ" style={{width:800,maxWidth:'100%',height:'auto'}}/>
      </section>}
      <div className="modal-actions"><button className="primary-action" type="submit" value="save">{busy?'Procesando…':'Aceptar'}</button>{showMail?<><button className="primary-action" type="submit" value="email">Aceptar y enviar correo de confirmación</button><button type="button" className="secondary-action" onClick={()=>setShowMail(false)}>Ocultar correo</button></>:<button type="button" className="secondary-action" onClick={()=>setShowMail(true)}>Aceptar y enviar correo…</button>}</div>
      <p>Ambas opciones guardan la compra, la factura adjunta y actualizan el inventario.</p></fieldset></form>}
      <button type="button" disabled={busy} onClick={()=>setSelected(null)}>Cerrar detalle</button>
    </section>}
  </section>
}
