import assert from 'node:assert/strict'
import {compareActivities} from './priorityOrder.js'

{
  const row=(id,n,i,c,level='ALTO',date='2026-01-01T08:00:00')=>({id,requested_at:date,priority:{level},request_data:{priority_validation:{factors:{n,i,c}}}})
  const rows=[row(1,4,3,2),row(2,1,1,4),row(3,4,4,4,'CRITICO'),row(4,1,2,4),row(5,2,2,4),row(6,2,2,4,'ALTO','2025-01-01T08:00:00'),{id:7,requested_at:'2024-01-01',request_data:{preevaluation:{n:4,i:4,c:4}}}]
  assert.deepEqual(rows.sort(compareActivities).map(r=>r.id),[3,6,5,4,2,1,7])
}
console.log('Orden NIC verificado: nivel, C, I, N, fecha y sin validar.')
