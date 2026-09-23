import {useEffect,useState} from 'react'
import {X} from 'lucide-react'
import {normalizeName} from './nameSearch'

export default function SparePartPlanningPicker({request,initial=[],requestMachineId,onChange,onClose}){
  const [plants,setPlants]=useState([]),[towers,setTowers]=useState([]),[machines,setMachines]=useState([]),[elements,setElements]=useState([])
  const [plantId,setPlantId]=useState(''),[towerId,setTowerId]=useState(''),[machineId,setMachineId]=useState(requestMachineId?String(requestMachineId):''),[elementId,setElementId]=useState('')
  const [relations,setRelations]=useState([]),[selected,setSelected]=useState(initial),[search,setSearch]=useState(''),[loading,setLoading]=useState(true),[error,setError]=useState('')
  useEffect(()=>{
    const controller=new AbortController()
    Promise.all(['/plantas','/torres','/maquinas','/elementos-maquinas'].map(path=>request(path,{signal:controller.signal})))
      .then(([pl,tw,ma,el])=>{setPlants(pl);setTowers(tw);setMachines(ma);setElements(el);const machine=ma.find(item=>item.machine_id===Number(requestMachineId));if(machine){setPlantId(String(machine.plant_id||''));setTowerId(String(machine.tower_id||''))}})
      .catch(err=>{if(err.name!=='AbortError')setError(err.message)}).finally(()=>{if(!controller.signal.aborted)setLoading(false)})
    return()=>controller.abort()
  },[request,requestMachineId])
  useEffect(()=>{
    if(!machineId){setRelations([]);return}
    const controller=new AbortController();setLoading(true);setError('')
    request(`/maquinas/${machineId}/repuestos`,{signal:controller.signal}).then(setRelations).catch(err=>{if(err.name!=='AbortError')setError(err.message)}).finally(()=>{if(!controller.signal.aborted)setLoading(false)})
    return()=>controller.abort()
  },[machineId,request])
  const machineOptions=machines.filter(machine=>(!plantId||String(machine.plant_id)===plantId)&&(!towerId||String(machine.tower_id)===towerId))
  const visible=relations.filter(item=>(!elementId||String(item.element_id||'GENERAL')===elementId)&&normalizeName(`${item.internal_code} ${item.description} ${item.element_name||''}`).includes(normalizeName(search)))
  function add(item){
    if(selected.some(part=>part.spare_part_id===item.spare_part_id)){setError('Ese repuesto ya está seleccionado. Ajusta su cantidad en la lista inferior.');return}
    setError('');setSelected(parts=>[...parts,{machine_spare_part_id:item.machine_spare_part_id,spare_part_id:item.spare_part_id,quantity:String(item.quantity_required||1),internal_code:item.internal_code,description:item.description,unit_of_measure:item.unit_of_measure,machine_code:item.machine_code,element_name:item.element_name}])
  }
  return <div className="modal-backdrop"><div className="motor-modal" role="dialog" aria-modal="true" aria-labelledby="planned-parts-title">
    <div className="modal-header"><div><h2 id="planned-parts-title">Seleccionar repuestos previstos</h2><p>Busca entre los repuestos asignados a cada máquina y sus elementos.</p></div><button type="button" aria-label="Cerrar" onClick={onClose}><X/></button></div>
    <div className="motor-form-grid report-filters"><label>Planta<select value={plantId} onChange={e=>{setPlantId(e.target.value);setTowerId('');setMachineId('');setElementId('')}}><option value="">Todas</option>{plants.map(p=><option key={p.plant_id} value={p.plant_id}>{p.name}</option>)}</select></label><label>Torre<select disabled={!plantId} value={towerId} onChange={e=>{setTowerId(e.target.value);setMachineId('');setElementId('')}}><option value="">Todas</option>{towers.filter(t=>String(t.plant_id)===plantId).map(t=><option key={t.tower_id} value={t.tower_id}>{t.name}</option>)}</select></label><label>Máquina<select required value={machineId} onChange={e=>{setMachineId(e.target.value);setElementId('')}}><option value="">Selecciona</option>{machineOptions.map(m=><option key={m.machine_id} value={m.machine_id}>{m.asset_code} · {m.name}</option>)}</select></label><label>Elemento<select disabled={!machineId} value={elementId} onChange={e=>setElementId(e.target.value)}><option value="">Todos</option><option value="GENERAL">Generales de la máquina</option>{elements.filter(el=>el.machine_id===Number(machineId)).map(el=><option key={el.element_id} value={el.element_id}>{el.element_code?`${el.element_code} · `:''}{el.name}</option>)}</select></label><label className="full-field">Buscar<input type="search" value={search} onChange={e=>setSearch(e.target.value)} placeholder="Código, descripción o elemento"/></label></div>
    {error&&<p role="alert">{error}</p>}{loading&&<p role="status">Cargando repuestos…</p>}
    {!loading&&machineId&&<div className="table-scroll"><table><thead><tr><th>Repuesto</th><th>Elemento</th><th>Cantidad configurada</th><th>Acción</th></tr></thead><tbody>{visible.map(item=><tr key={item.machine_spare_part_id}><td><strong>{item.internal_code}</strong><br/>{item.description}</td><td>{item.element_name||'General de la máquina'}</td><td>{item.quantity_required} {item.unit_of_measure}</td><td><button type="button" disabled={selected.some(part=>part.spare_part_id===item.spare_part_id)} onClick={()=>add(item)}>Añadir</button></td></tr>)}</tbody></table>{!visible.length&&<p>No hay repuestos asignados con estos filtros.</p>}</div>}
    {!!selected.length&&<section><h3>Repuestos seleccionados</h3>{selected.map((part,index)=><div className="request-line" key={part.machine_spare_part_id}><span><strong>{part.internal_code}</strong> · {part.description}<br/>{part.machine_code}{part.element_name?` / ${part.element_name}`:''}</span><label>Cantidad<input type="number" min="0.01" step="0.01" value={part.quantity} onChange={e=>setSelected(items=>items.map((item,i)=>i===index?{...item,quantity:e.target.value}:item))}/></label><button type="button" className="secondary-action" onClick={()=>setSelected(items=>items.filter((_,i)=>i!==index))}>Quitar</button></div>)}</section>}
    <div className="modal-actions"><button type="button" className="secondary-action" onClick={onClose}>Cancelar</button><button type="button" className="primary-action" onClick={()=>{if(selected.some(part=>!Number(part.quantity)||Number(part.quantity)<=0)){setError('Todas las cantidades deben ser mayores que cero.');return}onChange(selected);onClose()}}>Usar {selected.length} repuesto{selected.length===1?'':'s'}</button></div>
  </div></div>
}
