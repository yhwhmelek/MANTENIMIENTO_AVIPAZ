import assert from 'node:assert/strict'
import {calibrationEvent,filterEvents,monthGrid,nextPreventiveDue,projectPreventivePlans,weekEntryEvent} from './calendarEvents.js'

// Misma regla de meses que el backend: ancla de día y ajuste a meses cortos.
assert.equal(nextPreventiveDue('2026-01-31',{every:1,unit:'MESES'},31),'2026-02-28')
assert.equal(nextPreventiveDue('2026-02-28',{every:1,unit:'MESES'},31),'2026-03-31')
assert.equal(nextPreventiveDue('2026-11-15',{every:2,unit:'SEMANAS'},15),'2026-11-29')
assert.equal(nextPreventiveDue('2026-11-15',{every:500,unit:'HORAS'},15),null)

const machines=[{machine_id:1,asset_code:'MOL-01',name:'Molino 1',plant_name:'Samanga'},{machine_id:2,asset_code:'PEL-01',name:'Peletizadora',plant_name:'Santa Fe'}]
const activities=[{id:10,name:'Engrase',active:true,group:'MECANICO',start_time:'08:00',frequency:{every:1,unit:'SEMANAS'}},{id:11,name:'Cambio de aceite',active:true,group:'MECANICO',frequency:{every:500,unit:'HORAS'}},{id:12,name:'Termografía',active:true,group:'ELECTRICO',frequency:{every:1,unit:'MESES'}}]
const plans=[
  {id:1,activity_id:10,active:true,scope:'SPECIFIC',machine_id:1,next_due:'2026-11-02',first_due:'2026-10-05'},
  {id:2,activity_id:11,active:true,scope:'SPECIFIC',machine_id:1,next_due:'2026-11-02'},
  {id:3,activity_id:12,active:true,scope:'GENERAL',machine_ids:[1,2],next_due:'2026-11-20',first_due:'2026-10-20'},
  {id:4,activity_id:10,active:false,scope:'SPECIFIC',machine_id:2,next_due:'2026-11-03'},
]
const grid=monthGrid('2026-11')
const {events,hourPlans}=projectPreventivePlans({plans,activities,machines},grid.start,grid.end,'2026-11-25')
assert.equal(hourPlans,1)
const weekly=events.filter(e=>e.ref.plan_id===1)
assert.deepEqual(weekly.map(e=>e.date),['2026-11-02','2026-11-09','2026-11-16','2026-11-23','2026-11-30'])
assert.equal(weekly[0].state,'VENCIDA')
assert.equal(weekly[1].state,'PROGRAMADA')
const general=events.find(e=>e.ref.plan_id===3)
assert.deepEqual(general.plants,['Samanga','Santa Fe'])
assert.deepEqual(general.roles,['ELECTRICO'])
assert.equal(events.some(e=>e.ref.plan_id===4),false)

const published=weekEntryEvent({key:'r-5',request_id:5,preventive:true,scheduled:'2026-11-20',status:'PENDIENTE',group:'MANTENIMIENTO',machine:'Molino 1',activity:'Engrase',plant:'Samanga'},'2026-11-25')
assert.equal(published.source,'PM'); assert.equal(published.state,'VENCIDA')
assert.equal(weekEntryEvent({key:'r-6',request_id:6,preventive:false,scheduled:'2026-11-26',status:'POR_VALIDAR',group:'ELECTRICO'},'2026-11-25').state,'REALIZADA')

const cal=calibrationEvent({instrument_id:1,instrument_code:'Ext-Bal1',instrument_name:'Balanza',control_method:'VERIFICACION_INTERNA',plan_id:7,date:'2026-11-30',state:'PROYECTADA',responsible_group:'MANTENIMIENTO',plant_name:'Samanga'})
assert.equal(cal.state,'PROGRAMADA')
assert.equal(calibrationEvent({instrument_code:'Ext-Bal2',control_method:'VERIFICACION_INTERNA',record_id:3,date:'2026-11-10',state:'REALIZADA',result:'NO_CONFORME'}).state,'INCUMPLIDA')

const planned=calibrationEvent({kind:'PLANIFICADA',instrument_id:1,instrument_code:'Ext-Bal3',control_method:'VERIFICACION_INTERNA',plan_id:8,date:'2026-12-07',state:'PROYECTADA',responsible_group:'MECANICO',assignee:'Mecánico'})
assert.equal(planned.source,'CALPLAN'); assert.deepEqual(planned.ref,{tab:'schedule'})
const order=calibrationEvent({kind:'ORDEN',order_id:40,instrument_id:1,instrument_code:'Ext-Bal3',control_method:'CALIBRACION_EXTERNA',plan_id:8,date:'2026-11-20',state:'NO_CONFORME',result:'NO_CONFORME',assignee_type:'CONTRATISTA',responsible_group:'EXTERNO'})
assert.equal(order.source,'CAL'); assert.equal(order.state,'INCUMPLIDA'); assert.equal(order.ref.order_id,40); assert.equal(order.ref.done,false); assert.deepEqual(order.roles,['EXTERNO'])

const all=[...events,published,cal]
assert.equal(filterEvents(all,{visible:['CAL'],role:'',plant:''}).length,1)
assert.ok(filterEvents(all,{visible:['PLAN','PM','CAL'],role:'ELECTRICO',plant:''}).every(e=>e.roles.includes('ELECTRICO')))
assert.ok(filterEvents(all,{visible:['PLAN'],role:'',plant:'Santa Fe'}).every(e=>e.ref.plan_id===3))
console.log('Calendario estándar: proyección de preventivos, estados y filtros verificados.')
