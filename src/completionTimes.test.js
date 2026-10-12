import assert from 'node:assert/strict'
import { completionTimes } from './completionTimes.js'

const now = new Date('2026-01-01T15:12:45Z')
const original = { stopped_at: '2026-01-01T08:20:35' }
const form = { stopped_at: '2026-01-01T08:20', restored_at: '2026-01-01T09:00' }
const times = completionTimes(form, original, true, now)
assert.equal(times.finish_now, true)
assert.equal(times.repair_finished_at, undefined)
assert.equal(times.restored_at, null)
assert.equal(times.stopped_at, original.stopped_at)
assert.deepEqual(completionTimes(form, {}, true, now), {
  finish_now: true, repair_finished_at: undefined, stopped_at: null, restored_at: null,
})
assert.deepEqual(completionTimes(form, original, false, now), {
  repair_finished_at: '2026-01-01T10:12', ...form,
})
assert.deepEqual(completionTimes(form, original, true, new Date('2099-01-01T00:00:00Z')), times)
assert.ok(!('repair_finished_at' in JSON.parse(JSON.stringify({...form, ...times}))))
console.log('Entrega automatica independiente del reloj del dispositivo verificada.')
