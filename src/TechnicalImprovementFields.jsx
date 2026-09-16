export const evaluationFields=[
  ['affects_food_safety','food_safety_notes','Afecta inocuidad del producto'],
  ['requires_shutdown','shutdown_notes','Requiere parada de producción'],
  ['requires_training','training_notes','Requiere capacitación'],
  ['improves_safety','safety_notes','Mejora seguridad operacional'],
]

export default function TechnicalImprovementFields({form,change}){
  const evaluation=form.technical_evaluation||{}
  const update=(key,value)=>change('technical_evaluation',{...evaluation,[key]:value})
  return <>
    <label>Área solicitante *<input required maxLength={150} value={form.requesting_area||''} onChange={e=>change('requesting_area',e.target.value)}/></label>
    <label>Equipo / sistema / área {form.machine_id?'(opcional)':'*'}<input required={!form.machine_id} maxLength={200} value={form.target_area||''} onChange={e=>change('target_area',e.target.value)}/></label>
    <label className="full-field">Propuesta de mejora *<textarea required rows={4} maxLength={2000} value={form.improvement_proposal||''} onChange={e=>change('improvement_proposal',e.target.value)}/></label>
    <div className="full-field"><h4>Evaluación técnica</h4>{evaluationFields.map(([key,notes,label])=><div className="motor-form-grid" key={key}>
      <label>{label} *<select required value={evaluation[key]===undefined?'':String(evaluation[key])} onChange={e=>update(key,e.target.value==='true')}><option value="">Selecciona</option><option value="true">Sí</option><option value="false">No</option></select></label>
      <label>Observaciones<input maxLength={500} value={evaluation[notes]||''} onChange={e=>update(notes,e.target.value)}/></label>
    </div>)}</div>
  </>
}
