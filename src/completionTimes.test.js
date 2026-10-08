import assert from 'node:assert/strict'
import { completionTimes } from './completionTimes.js'

const now = new Date('2026-01-01T15:12:45Z')
const original = { stopped_at: '2026-01-01T08:20:35' }
const form = { stopped_at: '2026-01-01T08:20', restored_at: '2026-01-01T09:00' }
const times = completionTimes(form, original, true, now)
assert.equal(times.repair_finished_at, '2026-01-01T10:12:45')
assert.equal(times.restored_at, times.repair_finished_at)
assert.equal(times.stopped_at, original.stopped_at)
assert.deepEqual(completionTimes(form, {}, true, now), {
  repair_finished_at: '2026-01-01T10:12:45', stopped_at: null, restored_at: null,
})
assert.deepEqual(completionTimes(form, original, false, now), {
  repair_finished_at: '2026-01-01T10:12', ...form,
})
assert.equal(completionTimes({}, {}, true, new Date('2026-01-02T02:00:15Z')).repair_finished_at, '2026-01-01T21:00:15')
console.log('Entrega: retorno actualizado, parada original conservada y fechas en Ecuador verificadas.')
