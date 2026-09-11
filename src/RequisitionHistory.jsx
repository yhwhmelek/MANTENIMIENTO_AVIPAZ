import ImageAttachment from './ImageAttachment'
import {useEffect, useState} from 'react'

export default function RequisitionHistory({apiUrl,token,isAdmin,catalog,revision}){
  const [rows,setRows]=useState([]),[selected,setSelected]=useState(null),[receipt,setReceipt]=useState(null)
  const [error,setError]=useState(''),[busy,setBusy]=useState(false),[refresh,setRefresh]=useState(0)
  const [invoice,setInvoice]=useState(null),[pendingOnly,setPendingOnly]=useState(isAdmin)
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
    e.preventDefault();if(busy)return
    setBusy(true);setError('')
    try{
      let attachment=null
      if(invoice){
        if(invoice.size>10*1024*1024||!invoice.size)throw new Error('La factura debe tener contenido y pesar como máximo 10 MB.')
        const content=await new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(reader.result.split(',')[1]);reader.onerror=()=>reject(new Error('No se pudo leer la factura.'));reader.readAsDataURL(invoice)})
        attachment={filename:invoice.name,content_base64:content}
      }
      const r=await fetch(`${apiUrl}/requisiciones-compra/${selected.id}/recibir`,{method:'POST',headers,body:JSON.stringify({...receipt,invoice:attachment})})
      const data=await r.json();if(!r.ok)throw new Error(typeof data.detail==='string'?data.detail:'Revisa cantidades, precios y datos de compra.')
      setSelected(null);setRefresh(v=>v+1)
      window.dispatchEvent(new Event('requisitions-updated'));window.dispatchEvent(new Event('stock-updated'))
    }catch(e){setError(e.message)}finally{setBusy(false)}
  }
  async function downloadInvoice(){
    setBusy(true);setError('')
    try{
      const r=await fetch(`${apiUrl}/requisiciones-compra/${selected.id}/factura`,{headers})
      if(!r.ok)throw new Error('No se pudo descargar la factura.')
      const url=URL.createObjectURL(await r.blob()),a=document.createElement('a')
      a.href=url;a.download=selected.receipt.invoice.filename;document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),60000)
    }catch(e){setError(e.message)}finally{setBusy(false)}
  }
  function change(key,value){setReceipt(r=>({...r,[key]:value}))}
  function itemChange(index,key,value){setReceipt(r=>({...r,items:r.items.map((i,n)=>n===index?{...i,[key]:value}:i)}))}
  return <section className="request-detail"><h2>Requisiciones guardadas</h2><button type="button" disabled={busy} onClick={()=>setRefresh(v=>v+1)}>Actualizar historial</button>
    <label className="checkbox-field"><input type="checkbox" checked={pendingOnly} onChange={e=>setPendingOnly(e.target.checked)}/> Mostrar solo pendientes de llegada ({rows.filter(row=>row.status==='PENDIENTE').length})</label>
    {error&&<p role="alert">{error}</p>}
    <div className="table-scroll"><table><thead><tr><th>Número</th><th>Fecha</th><th>Solicitante</th><th>Proveedor</th><th>Estado</th><th>Acciones</th></tr></thead><tbody>{visibleRows.map(row=><tr key={row.id}><td>#{row.id}</td><td>{row.requisition.requested_on}</td><td>{row.requisition.requester}</td><td>{row.requisition.supplier||'Por definir'}</td><td>{row.status==='RECIBIDA'?'Recibida':'Pendiente de recepción'}</td><td><button disabled={busy} onClick={()=>open(row)}>Ver detalle</button> <button disabled={busy} onClick={()=>excel(row)}>Excel</button></td></tr>)}</tbody></table></div>
    {!visibleRows.length&&!error&&<p>{pendingOnly?'No hay requisiciones pendientes de llegada.':'No hay requisiciones guardadas.'}</p>}
    {selected&&<section className="request-detail"><h3>Requisición #{selected.id}</h3><p>{selected.requisition.department} · {selected.requisition.requester} · Entrega: {selected.requisition.urgent?'Urgente':selected.requisition.delivery_on}</p><p>Máquinas: {selected.requisition.machine_codes||'No aplica'}</p><p>{selected.requisition.observations}</p>
      {selected.requisition.items.map((item,i)=><p key={i}><strong>{i+1}. {item.description}</strong> · {item.quantity} {item.unit}<br/>{item.specifications}</p>)}
      {selected.receipt?.invoice&&<button type="button" disabled={busy} onClick={downloadInvoice}>Descargar factura: {selected.receipt.invoice.filename}</button>}
      {selected.receipt&&<><h3>Compra registrada</h3><p>Documento: {selected.receipt.document_number} · Fecha: {selected.receipt.purchased_on} · Administrador: {selected.received_by}</p>{selected.receipt.items.map((item,i)=><p key={i}>{selected.requisition.items[i].description}: {item.quantity} × {item.unit_cost} {selected.receipt.currency} · Compra #{selected.receipt.purchase_ids[i]}</p>)}</>}
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
      </div></div>)}<button className="primary-action">{busy?'Registrando…':'Confirmar recepción e ingresar al inventario'}</button></fieldset></form>}
      <button type="button" disabled={busy} onClick={()=>setSelected(null)}>Cerrar detalle</button>
    </section>}
  </section>
}
