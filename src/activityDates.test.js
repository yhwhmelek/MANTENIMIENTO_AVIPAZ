import assert from 'node:assert/strict'
import {activityDateEntries,formatActivityDate,latestActivityDate} from './activityDates.js'

const row={requested_at:'2026-10-06T08:16',accepted_at:'2026-10-07T10:00',completed_at:'2026-10-08T15:30',received_at:'2026-10-09T09:45'}
assert.deepEqual(activityDateEntries({requested_at:row.requested_at}).map(({label})=>label),['Solicitud'])
assert.deepEqual(activityDateEntries(row).map(({label})=>label),['Solicitud','Aceptación','Finalización','Recepción'])
assert.equal(latestActivityDate(row),Date.parse(row.received_at))
assert.equal(formatActivityDate('2026-10-06T08:16'),'2026-10-06 08:16')
assert.equal(latestActivityDate({}),0)
console.log('Resumen y última fecha del flujo verificados.')
