export const levels={CRITICO:'CRÍTICO',ALTO:'ALTO',MEDIO:'MEDIO',BAJO:'BAJO'}
export const benefits={SEGURIDAD:'Seguridad',PRODUCCION:'Producción / eficiencia',CALIDAD:'Calidad / inocuidad',AMBIENTE:'Ambiente',ERGONOMIA:'Ergonomía',COSTOS:'Reducción de costos',CONFIABILIDAD:'Confiabilidad',LEGAL:'Legal / normativo'}
export const checks={shutdown:'Requiere parada de producción',materials:'Requiere materiales / repuestos',modification:'Requiere modificación mecánica, eléctrica o de control',training:'Requiere capacitación o actualización documental',safety:'Requiere evaluación SST / inocuidad / ambiente'}
export const feasibility={PROCEDE:'Procede',CON_MODIFICACIONES:'Procede con modificaciones',ANALISIS_ADICIONAL:'Requiere análisis adicional',NO_PROCEDE:'No procede'}
export const conditions={LISTA:'Lista para ejecutar',ESPERA_REPUESTOS:'Espera de repuestos',ESPERA_RECURSOS:'Espera de recursos',ESPERA_VENTANA:'Espera de ventana / parada',ESPERA_PERMISOS:'Espera de permisos'}
export const criteria=[
  ['n','N · Necesidad de intervención',['Optimización o detalle menor, sin necesidad inmediata','Condición controlada o mejora necesaria; puede programarse','Problema recurrente o deterioro importante; atención en corto plazo','Requiere intervención prioritaria; no mantener sin revisión o acción']],
  ['i','I · Impacto operativo',['Sin impacto productivo relevante','Reduce eficiencia, capacidad o calidad; la operación continúa','Detiene línea/equipo crítico o reduce significativamente la capacidad','Detiene planta o proceso productivo principal']],
  ['c','C · Consecuencia',['Sin consecuencia relevante apreciable','Consecuencia menor y controlable','Consecuencia importante o riesgo moderado que requiere control','Consecuencia grave en seguridad, inocuidad, ambiente o cumplimiento legal']],
]
const planDuration=plan=>{const total=plan.estimated_duration_days!=null||plan.estimated_duration_minutes!=null?Number(plan.estimated_duration_days||0)*1440+Number(plan.estimated_duration_minutes||0):plan.starts_at&&plan.ends_at?Math.max(1,Math.round((new Date(plan.ends_at)-new Date(plan.starts_at))/60000)):0;return `${Math.floor(total/1440)} día(s) y ${total%1440} minuto(s)`}
export function NICFields({value={},onChange,required=true}){
  return <div className="motor-form-grid">{criteria.map(([key,label,options])=><label key={key}>{label} {required?'*':'(opcional)'}<select required={required} value={value[key]||''} onChange={e=>onChange({...value,[key]:e.target.value?Number(e.target.value):null})}><option value="">Sin valorar / selecciona</option>{options.map((text,i)=><option key={i} value={i+1}>{i+1} · {text}</option>)}</select></label>)}</div>
}
export function PriorityBadge({priority}){
  return <span className={`priority-badge priority-${priority?.level||'pending'}`}>{priority?`${levels[priority.level]} · PR ${priority.score}`:'Sin validar'}</span>
}
export function PrioritySummary({row}){
  const r=row.request_data,v=r.priority_validation,p=r.preevaluation,plan=r.planning
  return <section className="priority-summary"><h3>Prioridad N × I × C</h3>
    <p>Preevaluación del solicitante: {p?`N ${p.n??'Sin valorar'} · I ${p.i??'Sin valorar'} · C ${p.c??'Sin valorar'}${p.n&&p.i&&p.c?` · PR referencial ${p.n*p.i*p.c}`:' · Incompleta; Mantenimiento definirá los factores oficiales.'}`:'No registrada; Mantenimiento completará la evaluación oficial.'}</p>
    <p>Prioridad oficial: <PriorityBadge priority={row.priority}/>{row.priority?.escalated&&' · Escalada: C = 4 exige mínimo ALTO.'}</p>
    {v&&<><p>Validado por {v.name} · {v.at?.replace('T',' ')} · N {v.factors.n} · I {v.factors.i} · C {v.factors.c}</p><p>Nivel base: {levels[row.priority?.base]}. Observación técnica: {v.justification}</p>
      {v.technical_review&&<><h4>Verificación técnica de Mantenimiento</h4>{Object.entries(checks).map(([key,label])=><p key={key}>{label}: {v.technical_review[key].answer} · {v.technical_review[key].notes||'Sin observaciones'}</p>)}<p>Viabilidad: {feasibility[v.technical_review.feasibility]}</p></>}
    </>}
    <h4>Programación</h4>{plan?<><p>Responsable: {plan.responsible} · {conditions[plan.condition]}</p><p>Inicio: {plan.starts_at?.replace('T',' ')||'Por definir'} · Duración estimada: {planDuration(plan)}</p>{!!plan.requested_parts?.length&&<><p>Repuestos previstos:</p><ul>{plan.requested_parts.map(part=><li key={part.machine_spare_part_id}>{part.internal_code} · {part.description}: {part.quantity} {part.unit_of_measure} ({part.machine_code}{part.element_name?` / ${part.element_name}`:''})</li>)}</ul></>}<p>Otros recursos y personal: {plan.resources}</p><p>Permisos: {plan.permits} · Ventana / parada: {plan.window}</p><p>{plan.notes}</p></>:<p>Pendiente de programación por Mantenimiento.</p>}
  </section>
}
