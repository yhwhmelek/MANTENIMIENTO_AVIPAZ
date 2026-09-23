import {compareActivities} from './priorityOrder.js'

export function comparePlanningThenPriority(a,b){
  const plannedA=Boolean(a.request_data.planning)
  const plannedB=Boolean(b.request_data.planning)
  return Number(plannedA)-Number(plannedB)||compareActivities(a,b)
}

export function filterPrioritizedActivities(rows,{level='',type='',plantId='',towerId=''}){
  return rows.filter(row=>row.status!=='CERRADA')
    .filter(row=>(!level||(row.priority?.level||'SIN_VALIDAR')===level)
      &&(!type||row.request_data.maintenance_type===type)
      &&(!plantId||String(row.request_data.plant_id)===String(plantId))
      &&(!towerId||(towerId==='SIN_TORRE' ? row.request_data.tower_id==null : String(row.request_data.tower_id)===String(towerId))))
    .sort(comparePlanningThenPriority)
}
