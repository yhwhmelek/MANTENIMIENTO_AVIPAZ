import {useState} from 'react'

export default function PreventiveActivityTypes({types,request,onSaved}){
  const [form,setForm]=useState(null),[busy,setBusy]=useState(false),[error,setError]=useState(''),[message,setMessage]=useState('')
  function edit(type){setError('');setMessage('');setForm(type?{...type,original_code:type.code}:{code:'',name:'',requires_points:false,active:true})}
  async function save(event){
    event.preventDefault();if(busy)return
    setBusy(true);setError('');setMessage('')
    try{
      const {original_code,...payload}=form
      await request(`/preventivos/tipos-actividad${original_code?`/${encodeURIComponent(original_code)}`:''}`,{method:original_code?'PUT':'POST',body:JSON.stringify(payload)})
      setForm(null);await onSaved();setMessage('Tipo de actividad guardado.')
    }catch(e){setError(e.message)}finally{setBusy(false)}
  }
  return <section className="preventive-activity-types"><div className="page-heading"><div><h2>Tipos de actividades preventivas</h2><p>Administra las opciones que aparecen en el campo Tipo al crear una actividad.</p></div>{!form&&<button className="primary-action" onClick={()=>edit()}>Nuevo tipo</button>}</div>{error&&<p role="alert">{error}</p>}{message&&<p role="status">{message}</p>}{form?<form onSubmit={save}><fieldset disabled={busy} className="request-fields"><div className="motor-form-grid"><label>Código interno *<input required disabled={!!form.original_code} pattern="[A-Z][A-Z0-9_]{1,49}" maxLength="50" value={form.code} onChange={e=>setForm({...form,code:e.target.value.toUpperCase().replace(/[^A-Z0-9_]/g,'')})}/><span className="field-help">Solo letras mayúsculas, números y guion bajo.</span></label><label>Nombre visible *<input required maxLength="150" value={form.name} onChange={e=>setForm({...form,name:e.target.value})}/></label></div><label className="checkbox-field"><input type="checkbox" checked={!!form.requires_points} onChange={e=>setForm({...form,requires_points:e.target.checked})}/>Requiere puntos técnicos en planes específicos</label><label className="checkbox-field"><input type="checkbox" checked={!!form.active} onChange={e=>setForm({...form,active:e.target.checked})}/>Activo para nuevas actividades</label><div className="modal-actions"><button type="button" onClick={()=>setForm(null)}>Cancelar</button><button className="primary-action">{busy?'Guardando…':'Guardar tipo'}</button></div></fieldset></form>:<div className="table-scroll"><table><thead><tr><th>Código</th><th>Nombre</th><th>Puntos técnicos</th><th>Estado</th><th>Acción</th></tr></thead><tbody>{types.map(type=><tr key={type.code}><td>{type.code}</td><td>{type.name}</td><td>{type.requires_points?'Sí':'No'}</td><td>{type.active?'Activo':'Inactivo'}</td><td><button onClick={()=>edit(type)}>Editar</button></td></tr>)}</tbody></table>{!types.length&&<p className="empty-state">No hay tipos configurados. Ejecuta la migración 021.</p>}</div>}</section>
}
