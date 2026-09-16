import {benefits} from './RequestPriority'
export const evaluationFields=[
  ['affects_food_safety','food_safety_notes','Afecta inocuidad del producto'],
  ['requires_shutdown','shutdown_notes','Requiere parada de producción'],
  ['requires_training','training_notes','Requiere capacitación'],
  ['improves_safety','safety_notes','Mejora seguridad operacional'],
]

export default function TechnicalImprovementFields({form,change}){
  return <>
    <label>Área solicitante *<input required maxLength={150} value={form.requesting_area||''} onChange={e=>change('requesting_area',e.target.value)}/></label>
    <label>Equipo / sistema / área {form.machine_id?'(opcional)':'*'}<input required={!form.machine_id} maxLength={200} value={form.target_area||''} onChange={e=>change('target_area',e.target.value)}/></label>
    <label className="full-field">Propuesta de mejora *<textarea required rows={4} maxLength={2000} value={form.improvement_proposal||''} onChange={e=>change('improvement_proposal',e.target.value)}/></label>
    <div className="full-field"><h4>Beneficio / resultado esperado</h4><div className="motor-form-grid">{Object.entries(benefits).map(([key,label])=><label className="checkbox-field" key={key}><input type="checkbox" checked={(form.benefits||[]).includes(key)} onChange={e=>change('benefits',e.target.checked?[...(form.benefits||[]),key]:(form.benefits||[]).filter(v=>v!==key))}/>{label}</label>)}</div><label>Otro / justificación del beneficio<textarea required={!form.benefits?.length} maxLength={1000} value={form.benefit_notes||''} onChange={e=>change('benefit_notes',e.target.value)}/></label></div>
  </>
}
