import {compareActivities} from './priorityOrder.js'

export function filterPrioritizedActivities(rows,{level='',type='',plantId='',towerId=''}){
  return rows.filter(row=>row.status!=='CERRADA')
    .filter(row=>(!level||(row.priority?.level||'SIN_VALIDAR')===level)
      &&(!type||row.request_data.maintenance_type===type)
      &&(!plantId||String(row.request_data.plant_id)===String(plantId))
      &&(!towerId||(towerId==='SIN_TORRE' ? row.request_data.tower_id==null : String(row.request_data.tower_id)===String(towerId))))
    .sort(compareActivities)
}
