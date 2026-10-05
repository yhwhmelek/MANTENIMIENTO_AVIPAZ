import assert from 'node:assert/strict'
import {plantAlertMatches, plantAlertCoverage} from './plantAlerts.js'
import {canExecuteWork} from './workAssignment.js'

const user = {id:7,rol:'MECANICO',planta_id:1}
const work = plant_id => ({status:'PENDIENTE',request_data:{plant_id,planning:{assignment_type:'MECANICO'}}})
const rows = [work(1),work(2),work(null)]
assert.equal(rows.filter(r=>canExecuteWork(r,user)&&plantAlertMatches(r,user)).length,1)
assert.equal(plantAlertMatches(rows[0],{...user,planta_id:null}),false)
assert.equal(plantAlertMatches(rows[1],{...user,rol:'ADMIN'}),true)
assert.equal(plantAlertMatches({...rows[0],alert_in_plant:false},user),false)
assert.equal(plantAlertMatches({...rows[1],alert_in_plant:true},user),true)
const general = {request_data:{preventive:{machines:[{machine_id:1,plant_id:1},{machine_id:2,plant_id:2}]}}}
assert.equal(plantAlertMatches(general,user),true)
assert.deepEqual(plantAlertCoverage(general,user),[{machine_id:1,plant_id:1}])
assert.deepEqual(plantAlertCoverage({...general,alert_plant_id:2},user),[{machine_id:2,plant_id:2}])
assert.equal(plantAlertCoverage(general,{rol:'ADMIN'}).length,2)
assert.equal(plantAlertCoverage(general,{rol:'MECANICO'}).length,0)
console.log('PLANT_ALERTS_OK: plant and specialty, missing assignment, current server routing, general coverage, administrators')
