import {useEffect,useState} from 'react'
import {Pencil,Plus,Trash2} from 'lucide-react'

const empty={internal_code:'',name:'',unit_of_measure:'',description:'',active:true}

export default function Consumables({apiUrl,token,isAdmin}){
  const [rows,setRows]=useState([]),[form,setForm]=useState(empty),[editing,setEditing]=useState(null)
  const [busy,setBusy]=useState(false),[error,setError]=useState(''),[message,setMessage]=useState('')
  const headers={Authorization:`Bearer ${token}`,'Content-Type':'application/json'}
  async function load(){
    try{const response=await fetch(`${apiUrl}/consumibles`,{headers});const data=await response.json();if(!response.ok)throw new Error(data.detail||'No se pudieron cargar los consumibles.');setRows(data);setError('')}
    catch(e){setError(e.message)}
  }
  useEffect(()=>{load()},[apiUrl,token])
  function edit(row){setEditing(row);setForm({...row,description:row.description||''});setMessage('');setError('')}
  function reset(){setEditing(null);setForm(empty);setMessage('');setError('')}
  async function save(event){
    event.preventDefault();setBusy(true);setError('');setMessage('')
    try{const response=await fetch(`${apiUrl}/consumibles${editing?`/${editing.consumable_id}`:''}`,{method:editing?'PUT':'POST',headers,body:JSON.stringify(form)});const data=await response.json().catch(()=>({}));if(!response.ok)throw new Error(data.detail||'No se pudo guardar el consumible.');setRows(items=>editing?items.map(item=>item.consumable_id===data.consumable_id?data:item):[...items,data]);setMessage(editing?'Consumible actualizado.':'Consumible creado.');reset()}
    catch(e){setError(e.message)}finally{setBusy(false)}
  }
  async function remove(row){
    if(!window.confirm(`¿Desactivar ${row.name}?`))return
    setBusy(true);setError('')
    try{const response=await fetch(`${apiUrl}/consumibles/${row.consumable_id}`,{method:'DELETE',headers});const data=await response.json().catch(()=>({}));if(!response.ok)throw new Error(data.detail||'No se pudo desactivar el consumible.');setRows(items=>items.map(item=>item.consumable_id===row.consumable_id?{...item,active:false}:item));setMessage('Consumible desactivado.')}
    catch(e){setError(e.message)}finally{setBusy(false)}
  }
  return <section>
    <div className="page-heading"><div><p className="eyebrow">CATÁLOGO</p><h1>Energía y consumibles</h1><p>Registra los consumibles que estarán disponibles para las requisiciones de compra.</p></div>{isAdmin&&<button className="primary-action" disabled={busy} onClick={reset}><Plus size={18}/> Nuevo consumible</button>}</div>
    <p>Los consumibles seleccionados en una requisición se registran con cantidad y costo, pero no ingresan al inventario de repuestos.</p>
    {error&&<p role="alert">{error}</p>}{message&&<p role="status">{message}</p>}
    {isAdmin&&<form className="request-detail" onSubmit={save}><h2>{editing?'Editar consumible':'Nuevo consumible'}</h2><div className="motor-form-grid"><label>Código *<input required maxLength={50} value={form.internal_code} onChange={e=>setForm({...form,internal_code:e.target.value})}/></label><label>Nombre *<input required maxLength={160} placeholder="GLP, diésel, agua…" value={form.name} onChange={e=>setForm({...form,name:e.target.value})}/></label><label>Unidad de medida *<input required maxLength={20} placeholder="kg, gal, kWh, m³…" value={form.unit_of_measure} onChange={e=>setForm({...form,unit_of_measure:e.target.value})}/></label><label className="full-field">Descripción (opcional)<textarea rows={2} maxLength={500} value={form.description} onChange={e=>setForm({...form,description:e.target.value})}/></label><label className="checkbox-field"><input type="checkbox" checked={form.active} onChange={e=>setForm({...form,active:e.target.checked})}/> Activo</label></div><div className="modal-actions"><button type="button" className="secondary-action" onClick={reset}>Cancelar</button><button className="primary-action" disabled={busy}>{editing?'Guardar cambios':'Guardar consumible'}</button></div></form>}
    <div className="table-scroll"><table><thead><tr><th>Código</th><th>Consumible</th><th>Unidad</th><th>Descripción</th><th>Estado</th>{isAdmin&&<th>Acciones</th>}</tr></thead><tbody>{rows.map(row=><tr key={row.consumable_id}><td>{row.internal_code}</td><td><strong>{row.name}</strong></td><td>{row.unit_of_measure}</td><td>{row.description||'—'}</td><td>{row.active?'Activo':'Inactivo'}</td>{isAdmin&&<td className="row-actions"><button title="Editar" onClick={()=>edit(row)}><Pencil size={16}/></button>{row.active&&<button className="danger" title="Desactivar" onClick={()=>remove(row)}><Trash2 size={16}/></button>}</td>}</tr>)}</tbody></table>{!rows.length&&<p className="empty-state">No hay consumibles registrados.</p>}</div>
  </section>
}
