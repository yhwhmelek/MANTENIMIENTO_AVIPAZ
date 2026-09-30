import assert from 'node:assert/strict'
import {assignmentGroups, canExecuteWork} from './workAssignment.js'

function test(name, run) { run(); console.log(`OK: ${name}`) }

test('pending group alerts reach only matching roles; acceptance removes other users', () => {
  for (const [assignment_type,group] of Object.entries(assignmentGroups)) {
    const row={status:'PENDIENTE',assigned_to:null,request_data:{planning:{assignment_type}}}
    for (const rol of ['MECANICO','ELECTRICO','ADMIN','USUARIO','OPERADOR']) {
      assert.equal(canExecuteWork(row,{id:2,rol}),group.roles.includes(rol))
    }
    row.status='EN_PROCESO'
    row.assigned_to=2
    row.request_data.planning.assigned_user_id=2
    assert.equal(canExecuteWork(row,{id:2,rol:group.roles[0]}),true)
    for (const rol of group.roles) assert.equal(canExecuteWork(row,{id:3,rol}),false)
  }
})

test('legacy individual assignments and contractor administration remain available', () => {
  const row={status:'PENDIENTE',request_data:{planning:{assigned_user_id:2}}}
  assert.equal(canExecuteWork(row,{id:2,rol:'MECANICO'}),true)
  assert.equal(canExecuteWork(row,{id:3,rol:'MECANICO'}),false)
  row.request_data.planning={assignment_type:'CONTRACTOR',contractor_id:1}
  assert.equal(canExecuteWork(row,{id:3,rol:'MECANICO'}),false)
  assert.equal(canExecuteWork(row,{id:3,rol:'ADMIN'}),true)
})
