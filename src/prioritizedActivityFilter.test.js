import assert from 'node:assert/strict'
import {filterPrioritizedActivities} from './prioritizedActivityFilter.js'

const row=(id,plant,tower,level,status='PENDIENTE')=>({
  id,status,requested_at:`2026-09-${String(id).padStart(2,'0')}T08:00`,
  priority:level?{level}:null,
  request_data:{plant_id:plant,tower_id:tower,maintenance_type:'MEJORA_TECNICA',
    priority_validation:level?{factors:{n:2,i:2,c:2}}:null},
})
const rows=[row(1,1,10,'MEDIO'),row(2,1,10,'CRITICO'),row(3,1,11,'ALTO'),
  row(4,2,20,'CRITICO'),row(5,1,10,null),row(6,1,10,'ALTO','CERRADA')]

assert.deepEqual(filterPrioritizedActivities(rows,{plantId:1,towerId:10}).map(r=>r.id),[2,1,5])
assert.deepEqual(filterPrioritizedActivities(rows,{plantId:1,towerId:10,level:'SIN_VALIDAR'}).map(r=>r.id),[5])
assert.deepEqual(filterPrioritizedActivities(rows,{plantId:2}).map(r=>r.id),[4])
assert.deepEqual(filterPrioritizedActivities([row(7,1,null,'ALTO')],{plantId:1,towerId:'SIN_TORRE'}).map(r=>r.id),[7])
console.log('Filtros de planta y torre y orden de prioridad verificados.')
