import { useEffect, useRef, useState } from 'react'

export default function PlantStructure({apiUrl,token,isAdmin}) {
  const [plants,setPlants]=useState([]),[towers,setTowers]=useState([]),[plantId,setPlantId]=useState('')
  const [plantForm,setPlantForm]=useState(null),[towerForm,setTowerForm]=useState(null)
  const [error,setError]=useState(''),[busy,setBusy]=useState(false),[loading,setLoading]=useState(true),[version,setVersion]=useState(0)
  const submitting=useRef(false)
  async function request(path,options={}){
    const response=await fetch(`${apiUrl}${path}`,{...options,headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'}})
    const data=await response.json().catch(()=>({}))
    if(!response.ok)throw new Error(typeof data.detail==='string'?data.detail:'Revisa el nombre y la planta seleccionada.')
    return data
  }
  useEffect(()=>{
    const controller=new AbortController();setLoading(true)
    Promise.all(['/plantas','/torres'].map(p=>request(p,{signal:controller.signal}))).then(([p,t])=>{setPlants(p);setTowers(t)})
      .catch(e=>{if(e.name!=='AbortError')setError(e.message)}).finally(()=>{if(!controller.signal.aborted)setLoading(false)})
    return()=>controller.abort()
  },[apiUrl,token,version])
  async function save(event,kind){
    event.preventDefault();if(submitting.current||!isAdmin)return
    submitting.current=true;setBusy(true);setError('')
    const form=kind==='plantas'?plantForm:towerForm
    const data={name:form.name,...(kind==='torres'?{plant_id:Number(form.plant_id)}:{})}
    try{await request(`/${kind}${form.id?`/${form.id}`:''}`,{method:form.id?'PUT':'POST',body:JSON.stringify(data)});setPlantForm(null);setTowerForm(null);setVersion(v=>v+1)}
    catch(e){setError(e.message)}finally{submitting.current=false;setBusy(false)}
  }
  async function remove(kind,item){
    if(submitting.current||!isAdmin||!window.confirm(`¿Eliminar ${item.name}? Solo se permite si no tiene ${kind==='plantas'?'torres':'máquinas'} asociadas.`))return
    submitting.current=true;setBusy(true);setError('')
    try{await request(`/${kind}/${kind==='plantas'?item.plant_id:item.tower_id}`,{method:'DELETE'});setVersion(v=>v+1);if(kind==='plantas'&&String(item.plant_id)===plantId)setPlantId('')}
    catch(e){setError(e.message)}finally{submitting.current=false;setBusy(false)}
  }
  return <>
    <div className="page-heading"><div><p className="eyebrow">ACTIVOS</p><h1>Plantas y torres</h1><p>Cada planta contiene torres y cada torre agrupa sus máquinas.</p></div></div>
    <p>Asigna las máquinas existentes desde <strong>Activos → Máquinas → Editar</strong>, seleccionando planta y torre.</p>
    {error&&<p role="alert">{error}</p>}{loading&&<p role="status">Cargando estructura…</p>}
    <div className="request-toolbar"><h2>Plantas</h2>{isAdmin&&<button disabled={busy} className="primary-action" onClick={()=>setPlantForm({name:''})}>Nueva planta</button>}</div>
    {plantForm&&<form onSubmit={e=>save(e,'plantas')}><div className="motor-form-grid"><label>Nombre de planta<input required maxLength={100} value={plantForm.name} disabled={busy} onChange={e=>setPlantForm(f=>({...f,name:e.target.value}))}/></label></div><div className="modal-actions"><button type="button" className="secondary-action" disabled={busy} onClick={()=>setPlantForm(null)}>Cancelar</button><button className="primary-action" disabled={busy}>Guardar planta</button></div></form>}
    <div className="table-scroll users-card"><table><thead><tr><th>Planta</th><th>Torres</th><th>Acciones</th></tr></thead><tbody>{plants.map(p=><tr key={p.plant_id}><td>{p.name}</td><td>{p.tower_count}</td><td><div className="request-toolbar"><button className="secondary-action" onClick={()=>setPlantId(String(p.plant_id))}>Ver torres</button>{isAdmin&&<><button disabled={busy} className="secondary-action" onClick={()=>setPlantForm({id:p.plant_id,name:p.name})}>Editar</button><button disabled={busy} className="secondary-action" onClick={()=>remove('plantas',p)}>Eliminar</button></>}</div></td></tr>)}</tbody></table></div>
    <div className="request-toolbar"><h2>Torres</h2><label>Planta <select value={plantId} onChange={e=>setPlantId(e.target.value)}><option value="">Todas</option>{plants.map(p=><option key={p.plant_id} value={p.plant_id}>{p.name}</option>)}</select></label>{isAdmin&&<button className="primary-action" disabled={busy||!plants.length} onClick={()=>setTowerForm({name:'',plant_id:plantId})}>Nueva torre</button>}</div>
    {towerForm&&<form onSubmit={e=>save(e,'torres')}><div className="motor-form-grid"><label>Planta<select required disabled={busy||!!towerForm.id} value={towerForm.plant_id} onChange={e=>setTowerForm(f=>({...f,plant_id:e.target.value}))}><option value="">Selecciona</option>{plants.map(p=><option key={p.plant_id} value={p.plant_id}>{p.name}</option>)}</select></label><label>Nombre de torre<input required maxLength={100} disabled={busy} value={towerForm.name} onChange={e=>setTowerForm(f=>({...f,name:e.target.value}))}/></label></div><div className="modal-actions"><button type="button" className="secondary-action" disabled={busy} onClick={()=>setTowerForm(null)}>Cancelar</button><button className="primary-action" disabled={busy}>Guardar torre</button></div></form>}
    <div className="table-scroll users-card"><table><thead><tr><th>Planta</th><th>Torre</th><th>Máquinas</th>{isAdmin&&<th>Acciones</th>}</tr></thead><tbody>{towers.filter(t=>!plantId||String(t.plant_id)===plantId).map(t=><tr key={t.tower_id}><td>{t.plant_name}</td><td>{t.name}</td><td>{t.machine_count}</td>{isAdmin&&<td><div className="request-toolbar"><button disabled={busy} className="secondary-action" onClick={()=>setTowerForm({id:t.tower_id,name:t.name,plant_id:String(t.plant_id)})}>Editar</button><button disabled={busy} className="secondary-action" onClick={()=>remove('torres',t)}>Eliminar</button></div></td>}</tr>)}</tbody></table></div>
  </>
}
