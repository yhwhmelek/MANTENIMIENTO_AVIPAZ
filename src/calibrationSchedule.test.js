import assert from 'node:assert/strict'
import {addDays,evaluatePoint,monthGrid,pointTemplate,recordResult} from './calibrationSchedule.js'

assert.deepEqual(evaluatePoint({reference_value:'40.00',measured_value:'40.00',emp:''},'0.05'),{error:0,percent:0,emp:0.05,conforms:true})
assert.equal(evaluatePoint({reference_value:'40',measured_value:'40,05',emp:''},'0.05').conforms,true)
assert.equal(evaluatePoint({reference_value:'40',measured_value:'39.94',emp:''},'0.05').conforms,false)
assert.equal(evaluatePoint({reference_value:'20',measured_value:'20.4',emp:'0.5'},'0.05').conforms,true)
assert.equal(evaluatePoint({reference_value:'',measured_value:'1',emp:''},'0.05'),null)

const balance=pointTemplate('BALANZA').map(point=>({...point,reference_value:'40',measured_value:'40'}))
assert.equal(balance.length,5)
assert.equal(recordResult(balance,'0.05'),'CONFORME')
balance[2].measured_value='40.2'
assert.equal(recordResult(balance,'0.05'),'NO_CONFORME')
assert.equal(recordResult([],'0.05'),null)

const august=monthGrid('2026-08')
assert.equal(august.start,'2026-07-27')
assert.equal(august.end,'2026-09-06')
assert.equal(august.days.length%7,0)
assert.deepEqual(august.mondays.slice(0,2),['2026-07-27','2026-08-03'])
assert.equal(addDays('2026-02-28',1),'2026-03-01')
console.log('Reglas de calibración y calendario mensual verificadas.')
