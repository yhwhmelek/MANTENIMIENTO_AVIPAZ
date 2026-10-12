import assert from 'node:assert/strict'
import { completionTimes } from './completionTimes.js'
for (const technician of [true, false]) {
  const payload = JSON.parse(JSON.stringify({
    repair_started_at: '2099-01-01T09:00', repair_finished_at: '2099-01-01T10:00',
    ...completionTimes({}, {}, technician, new Date('2099-01-01')),
  }))
  assert.deepEqual(payload, {finish_now: true})
}
console.log('Las acciones no envian fechas del dispositivo, para todos los roles.')
