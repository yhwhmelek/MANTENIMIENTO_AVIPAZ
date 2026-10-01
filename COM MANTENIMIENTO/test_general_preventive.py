import json
import unittest
from io import BytesIO
from zipfile import ZipFile
from datetime import date
from unittest.mock import MagicMock
from fastapi import FastAPI, HTTPException
from pydantic import ValidationError
from preventive_maintenance import ActivityWrite, PlanWrite, PublishWrite, general_coverage, register_preventive
from preventive_export import workbook


class GeneralPreventiveTests(unittest.TestCase):
    def setUp(self):
        self.activity = ActivityWrite(name='Engrase general', procedure='Lubricar elementos móviles de las máquinas incluidas.',
            kind='ENGRASE', scope='GENERAL', start_time='09:30', frequency={'every':1,'unit':'SEMANAS'},
            group='MECANICO', duration_minutes=120, factors={'n':2,'i':2,'c':2}).model_dump(mode='json', exclude={'revision'})
        self.plan = PlanWrite(activity_id=1, scope='GENERAL', machine_ids=list(range(1,251)),
            first_due='2026-09-28', start_time='09:30').model_dump(mode='json', exclude={'revision'})
        self.next_due = date(2026,9,28)
        self.requests = []
        self.schedules = []
        self.occurrences = []
        self.conn = MagicMock()
        self.cursor = self.conn.cursor.return_value
        self.cursor.execute.side_effect = self.query
        self.app = FastAPI()
        register_preventive(self.app, lambda:self.conn, lambda:2, lambda:1)

    def endpoint(self, path, method='POST'):
        return next(r.endpoint for r in self.app.routes if r.path==path and method in r.methods)

    def query(self, sql, *args):
        result = MagicMock()
        result.fetchone.return_value = None
        result.fetchall.return_value = []
        if sql.startswith('SELECT ActivityId,Data'):
            result.fetchall.return_value = [(1,json.dumps(self.activity),1)]
        elif sql.startswith('SELECT PlanId,Data'):
            result.fetchall.return_value = [(1,json.dumps(self.plan),1,self.next_due)]
        elif sql.startswith('SELECT TOP 1 o.OccurrenceId'):
            result.fetchone.return_value = (1,) if self.requests else None
        elif sql.startswith('SELECT COALESCE'):
            result.fetchone.return_value = ('Administrador',)
        elif sql.startswith('SELECT m.MachineId'):
            result.fetchall.return_value = [(i,f'M-{i}',f'Motor {i}',1,1,'Planta','Torre','ACTIVA') for i in args]
        elif sql.startswith('SET NOCOUNT ON; INSERT INTO dbo.MaintenanceRequests'):
            self.requests.append(json.loads(args[3]))
            self.assertIsNone(args[0])
            result.fetchone.return_value = (len(self.requests),)
        elif sql.startswith('INSERT INTO dbo.PreventiveSchedule'):
            self.schedules.append(args)
        elif sql.startswith('INSERT INTO dbo.PreventiveOccurrences'):
            self.occurrences.append(args)
        elif sql.startswith('UPDATE dbo.PreventivePlans SET NextDue'):
            self.next_due = args[0]
        elif sql.startswith('SELECT Data FROM dbo.PreventiveActivities'):
            result.fetchone.return_value = (json.dumps(self.activity),)
        elif sql.startswith('SELECT Data,Revision FROM dbo.PreventivePlans'):
            result.fetchone.return_value = (json.dumps(self.plan),1)
        elif sql.startswith('UPDATE dbo.PreventivePlans SET Data='):
            self.plan = json.loads(args[0])
        elif sql.startswith('SELECT Status FROM dbo.Machines'):
            result.fetchone.return_value = ('ACTIVA',)
        elif sql.startswith('SET NOCOUNT ON; INSERT INTO dbo.PreventivePlans'):
            result.fetchone.return_value = (1,)
        elif sql.startswith('SELECT Rol'):
            result.fetchone.return_value = ('MECANICO',)
        elif sql.startswith('SELECT s.ScheduleId'):
            result.fetchall.return_value = [(1,date(2026,9,28),False,'',1,'PENDIENTE',json.dumps(self.requests[0]),None,None,None)] if self.requests else []
        return result

    def test_250_machines_publish_one_order_and_one_calendar_entry(self):
        data = PublishWrite(week='2026-09-28',plan_ids=[1,1])
        published = self.endpoint('/preventivos/publicar')(data, usuario_id=1)
        self.assertEqual(published['request_ids'], [1])
        self.assertEqual(len(self.schedules), 1)
        self.assertEqual(len(self.occurrences), 1)
        request = self.requests[0]
        self.assertEqual(request['description'], 'Engrase general')
        self.assertIsNone(request['machine_id'])
        self.assertEqual(len(request['preventive']['machines']), 250)
        self.assertEqual(len(request['preventive']['items']), 1)
        self.assertEqual(request['planning']['starts_at'], '2026-09-28T09:30:00')
        self.assertEqual(request['planning']['ends_at'], '2026-09-28T11:30:00')
        report = self.endpoint('/preventivos/semana','GET')(date(2026,9,28), usuario_id=2)
        self.assertEqual(report['summary']['programmed'], 1)
        self.assertEqual(len(report['entries']), 1)
        self.assertEqual(report['entries'][0]['start_time'], '09:30')
        self.assertEqual(len(report['entries'][0]['machines']), 250)
        with ZipFile(BytesIO(workbook(report))) as excel:
            self.assertIn('Motor 250', excel.read('xl/worksheets/sheet3.xml').decode())
            self.assertNotIn('Motor 250', excel.read('xl/worksheets/sheet1.xml').decode())
        self.assertEqual(self.endpoint('/preventivos/publicar')(data, usuario_id=1)['request_ids'], [])
        self.plan['machine_ids'] = [1]
        self.assertEqual(len(request['preventive']['machines']), 250)

    def test_general_greasing_needs_no_per_machine_points(self):
        result = self.endpoint('/preventivos/planes')(PlanWrite(**self.plan), usuario_id=1)
        self.assertEqual(result, {'id':1})
        self.conn.commit.assert_called_once()

    def test_selection_edit_keeps_published_snapshot_and_next_due(self):
        self.endpoint('/preventivos/publicar')(PublishWrite(week='2026-09-28',plan_ids=[1]),usuario_id=1)
        next_due = self.next_due
        data = PlanWrite(**(self.plan | {'machine_ids':[1,2], 'revision':1}))
        self.endpoint('/preventivos/planes/{plan_id}', 'PUT')(1,data,usuario_id=1)
        self.assertEqual(self.plan['machine_ids'],[1,2])
        self.assertEqual(len(self.requests[0]['preventive']['machines']),250)
        self.assertEqual(self.next_due,next_due)

    def test_selection_edit_rejects_stale_revision(self):
        with self.assertRaises(HTTPException) as error:
            self.endpoint('/preventivos/planes/{plan_id}', 'PUT')(1,PlanWrite(**self.plan),usuario_id=1)
        self.assertEqual(error.exception.status_code,409)

    def test_specific_greasing_still_requires_points(self):
        self.activity['scope'] = 'SPECIFIC'
        with self.assertRaises(HTTPException) as error:
            self.endpoint('/preventivos/planes')(PlanWrite(activity_id=1,machine_id=1,first_due='2026-09-28'),usuario_id=1)
        self.assertEqual(error.exception.status_code,422)

    def test_invalid_selection(self):
        for updates in ({'machine_ids':[]}, {'machine_ids':[1,1]}, {'machine_ids':[0]},
                        {'machine_id':1}, {'element_id':1}, {'points':[{'name':'DE'}]}):
            with self.subTest(updates=updates), self.assertRaises(ValidationError):
                PlanWrite(**(self.plan | updates))
        with self.assertRaises(ValidationError):
            PlanWrite(activity_id=1,first_due='2026-09-28')

    def test_scope_must_match_activity(self):
        self.activity['scope'] = 'SPECIFIC'
        with self.assertRaises(HTTPException) as error:
            self.endpoint('/preventivos/planes')(PlanWrite(**self.plan), usuario_id=1)
        self.assertEqual(error.exception.status_code,422)
        self.conn.rollback.assert_called_once()

    def test_missing_or_inactive_machine_blocks_publication(self):
        for rows in ([], [(1,'M-1','Motor',1,1,'Planta','Torre','FUERA_SERVICIO')]):
            cursor = MagicMock()
            cursor.execute.return_value.fetchall.return_value = rows
            with self.assertRaises(HTTPException):
                general_coverage(cursor, [1])

    def test_coverage_batches_beyond_sql_parameter_limit(self):
        machines = general_coverage(self.cursor, list(range(1,2501)))
        self.assertEqual(len(machines),2500)
        self.assertEqual(self.cursor.execute.call_count,5)

    def test_snapshot_keeps_multiple_plants(self):
        cursor = MagicMock()
        cursor.execute.return_value.fetchall.return_value = [(1,'A','Motor',1,10,'Uno','T1','ACTIVA'),(2,'B','Motor',2,20,'Dos','T2','ACTIVA')]
        self.assertEqual({m['plant_id'] for m in general_coverage(cursor,[1,2])}, {1,2})


if __name__ == '__main__':
    unittest.main()
