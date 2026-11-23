import {compareActivities} from './priorityOrder.js'

export function comparePlanningThenPriority(a,b){
  const statusRank={POR_RECIBIR:0,EN_PROCESO:1,PENDIENTE:2}
  return (statusRank[a.status]??3)-(statusRank[b.status]??3)||compareActivities(a,b)
}

export function filterPrioritizedActivities(rows,{level='',type='',plantId='',towerId='',status}={}){
  return rows.filter(row=>status ? row.status===status : row.status!=='CERRADA')
    .filter(row=>(!level||(row.priority?.level||'SIN_VALIDAR')===level)
      &&(!type||row.request_data.maintenance_type===type)
      &&(row.request_data.preventive?.machines?.length ? row.request_data.preventive.machines : [row.request_data]).some(location =>
        (!plantId||String(location.plant_id)===String(plantId))
        &&(!towerId||(towerId==='SIN_TORRE' ? location.tower_id==null : String(location.tower_id)===String(towerId)))))
    .sort(comparePlanningThenPriority)
}
