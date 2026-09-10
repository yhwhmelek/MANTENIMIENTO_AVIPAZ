import json
import unittest
from datetime import datetime, timedelta
from decimal import Decimal
from unittest.mock import MagicMock, patch

import pyodbc
from fastapi import FastAPI, HTTPException
from pydantic import ValidationError
import maintenance_requests as mod


class RequestTests(unittest.TestCase):
    def setUp(self):
        self.connection = MagicMock()
        self.cursor = self.connection.cursor.return_value
        self.app = FastAPI()
        self.active = lambda: 1
        self.admin = lambda: 9
        mod.register_maintenance_requests(self.app, lambda: self.connection, self.active, self.admin)
        self.original = {'machine_id': 3, 'maintenance_type': 'CORRECTIVO', 'hour_meter': '100'}

    def endpoint(self, suffix, method='POST'):
        return next(r.endpoint for r in self.app.routes if r.path == '/solicitudes-mantenimiento'+suffix and method in r.methods)

    def completion(self, **changes):
        return mod.CompleteWrite(**(dict(repair_started_at='2026-01-01T09:00', repair_finished_at='2026-01-01T10:00',
            work_done='Cambio de malla', cause='Desgaste', recommendations='Verificar fijaciones',
            delivery_conditions='Molino operativo', hour_meter='101', parts=[{'spare_part_id': 8, 'quantity': '1'}]) | changes))

    def locked(self, status='EN_PROCESO', requested_by=1, assigned_to=2):
        return (requested_by, assigned_to, status, json.dumps(self.original), datetime(2026,1,1,8))

    def test_all_endpoints_require_authentication(self):
        for route in self.app.routes:
            if hasattr(route,'dependant'):
                self.assertIn(self.admin if 'DELETE' in route.methods or route.path.endswith(('/atender','/completar')) else self.active,[d.call for d in route.dependant.dependencies])

    def test_delete_request_removes_only_its_flow_in_order(self):
        self.cursor.execute.return_value.fetchone.side_effect=[(33,), (33,)]
        self.endpoint('/{request_id}', 'DELETE')(5, usuario_id=9)
        deletes=[call.args for call in self.cursor.execute.call_args_list if call.args[0].startswith('DELETE')]
        self.assertEqual(deletes, [
            ('DELETE FROM dbo.MaintenanceRequests WHERE RequestId=?', 5),
            ('DELETE FROM dbo.MaintenancePartsUsed WHERE MaintenanceEventId=?', 33),
            ('DELETE FROM dbo.MaintenanceEvents WHERE MaintenanceEventId=?', 33)])
        self.connection.commit.assert_called_once()

    def test_delete_pending_request_has_no_event_or_stock_changes(self):
        self.cursor.execute.return_value.fetchone.return_value=(None,)
        self.endpoint('/{request_id}', 'DELETE')(5, usuario_id=9)
        deletes=[call.args[0] for call in self.cursor.execute.call_args_list if call.args[0].startswith('DELETE')]
        self.assertEqual(deletes,['DELETE FROM dbo.MaintenanceRequests WHERE RequestId=?'])

    def test_delete_standalone_intervention(self):
        self.cursor.execute.return_value.fetchone.side_effect=[None, (33,)]
        endpoint=next(r.endpoint for r in self.app.routes if r.path=='/intervenciones/{event_id}')
        endpoint(33, usuario_id=9)
        deletes=[call.args[0] for call in self.cursor.execute.call_args_list if call.args[0].startswith('DELETE')]
        self.assertEqual(len(deletes),2)
        self.assertFalse(any('MaintenanceRequests' in sql for sql in deletes))

    def test_delete_failure_rolls_back_entire_flow(self):
        def execute(sql,*args):
            if sql.startswith('DELETE FROM dbo.MaintenanceEvents'):
                raise pyodbc.Error('foreign key')
            result=MagicMock();result.fetchone.return_value=(33,);return result
        self.cursor.execute.side_effect=execute
        with self.assertRaises(HTTPException):
            self.endpoint('/{request_id}','DELETE')(5,usuario_id=9)
        self.connection.rollback.assert_called_once()
        self.connection.commit.assert_not_called()

    def test_delete_missing_request_returns_404(self):
        self.cursor.execute.return_value.fetchone.return_value=None
        with self.assertRaises(HTTPException) as error:
            self.endpoint('/{request_id}','DELETE')(5,usuario_id=9)
        self.assertEqual(error.exception.status_code,404)
        self.connection.commit.assert_not_called()

    def test_operator_creates_and_user_cannot(self):
        data = mod.RequestWrite(machine_id=3,description='Cambiar malla',maintenance_type='CORRECTIVO',urgency=3,impact=3,risk=2)
        self.cursor.execute.return_value.fetchone.side_effect = [('USUARIO',)]
        with self.assertRaises(HTTPException) as error:
            self.endpoint('')(data,usuario_id=1)
        self.assertEqual(error.exception.status_code,403)
        self.connection.rollback.assert_called_once()
        self.cursor.execute.return_value.fetchone.side_effect = [('OPERADOR',),('MOL-1','Molino','Produccion'),(12,)]
        self.assertEqual(self.endpoint('')(data,usuario_id=1),{'id':12})
        self.connection.commit.assert_called_once()

    def test_self_accept_and_already_taken_rejected(self):
        for row, user, code in [(self.locked(),3,409)]:
            self.cursor.execute.return_value.fetchone.return_value = row
            with self.assertRaises(HTTPException) as error:
                self.endpoint('/{request_id}/atender')(5,usuario_id=user)
            self.assertEqual(error.exception.status_code,code)
        self.connection.commit.assert_not_called()

    def test_accept_assigns_current_user_under_lock(self):
        self.cursor.execute.return_value.fetchone.return_value = self.locked('PENDIENTE',assigned_to=None)
        self.endpoint('/{request_id}/atender')(5,usuario_id=2)
        self.assertIn('UPDLOCK, HOLDLOCK',self.cursor.execute.call_args_list[0].args[0])
        self.assertEqual(self.cursor.execute.call_args.args[1],2)
        self.connection.commit.assert_called_once()

    def test_admin_can_accept_own_request(self):
        self.cursor.execute.return_value.fetchone.return_value=self.locked('PENDIENTE',requested_by=9,assigned_to=None)
        self.endpoint('/{request_id}/atender')(5,usuario_id=9)
        self.assertEqual(self.cursor.execute.call_args.args[1],9)
        self.connection.commit.assert_called_once()

    def test_admin_can_complete_another_assignees_request(self):
        self.cursor.execute.return_value.fetchone.side_effect=[self.locked(),(33,)]
        self.endpoint('/{request_id}/completar')(5,self.completion(parts=[]),usuario_id=9)
        event=next(c.args for c in self.cursor.execute.call_args_list if 'INSERT INTO dbo.MaintenanceEvents' in c.args[0])
        self.assertEqual(event[-1],9)
        self.connection.commit.assert_called_once()

    def test_admin_receipt_records_actual_receiver(self):
        self.cursor.execute.return_value.fetchone.side_effect=[self.locked('POR_RECIBIR'),('ADMIN',)]
        self.endpoint('/{request_id}/recibir')(5,mod.ReceiptWrite(),usuario_id=9)
        self.assertIn('ReceivedBy=?',self.cursor.execute.call_args.args[0])
        self.assertEqual(self.cursor.execute.call_args.args[-2:],(9,5))
        self.connection.commit.assert_called_once()

    def test_completion_creates_event_and_consumption_once(self):
        self.cursor.execute.return_value.fetchone.side_effect = [self.locked(),(33,)]
        with patch.object(mod,'part_stock',return_value=(('MALLA','Malla molino','u'),Decimal(2),None)):
            result=self.endpoint('/{request_id}/completar')(5,self.completion(),usuario_id=2)
        self.assertEqual(result['maintenance_event_id'],33)
        consumption=next(c.args for c in self.cursor.execute.call_args_list if 'INSERT INTO dbo.MaintenancePartsUsed' in c.args[0])
        self.assertEqual(consumption[1:5],(33,8,Decimal(1),'u'))
        self.connection.commit.assert_called_once()
        self.cursor.execute.return_value.fetchone.side_effect = [self.locked('POR_RECIBIR')]
        with self.assertRaises(HTTPException) as error:
            self.endpoint('/{request_id}/completar')(5,self.completion(),usuario_id=2)
        self.assertEqual(error.exception.status_code,409)
        self.assertEqual(sum('INSERT INTO dbo.MaintenancePartsUsed' in c.args[0] for c in self.cursor.execute.call_args_list),1)

    def test_insufficient_stock_and_cutoff_roll_back(self):
        for stock,cutoff,code in [(Decimal(0),None,409),(Decimal(3),datetime(2026,1,1).date(),422)]:
            self.cursor.execute.return_value.fetchone.return_value = self.locked()
            with patch.object(mod,'part_stock',return_value=(('MALLA','Malla','u'),stock,cutoff)), self.assertRaises(HTTPException) as error:
                self.endpoint('/{request_id}/completar')(5,self.completion(),usuario_id=2)
            self.assertEqual(error.exception.status_code,code)
        self.connection.commit.assert_not_called()
        self.assertEqual(self.connection.rollback.call_count,2)

    def test_failure_after_consumption_rolls_back_everything(self):
        def execute(sql,*args):
            if 'UPDATE dbo.MaintenanceRequests' in sql:
                raise pyodbc.Error('connection lost')
            result=MagicMock()
            result.fetchone.return_value = self.locked() if sql.startswith('SELECT RequestedBy') else (33,)
            return result
        self.cursor.execute.side_effect=execute
        with patch.object(mod,'part_stock',return_value=(('MALLA','Malla','u'),Decimal(2),None)), self.assertRaises(HTTPException) as error:
            self.endpoint('/{request_id}/completar')(5,self.completion(),usuario_id=2)
        self.assertEqual(error.exception.status_code,503)
        self.connection.rollback.assert_called_once()
        self.connection.commit.assert_not_called()

    def test_operator_cannot_receive_for_another_requester(self):
        self.cursor.execute.return_value.fetchone.return_value=self.locked('POR_RECIBIR')
        with self.assertRaises(HTTPException) as error:
            self.endpoint('/{request_id}/recibir')(5,mod.ReceiptWrite(notes='Recibido'),usuario_id=2)
        self.assertEqual(error.exception.status_code,403)
        self.endpoint('/{request_id}/recibir')(5,mod.ReceiptWrite(notes='Cambio recibido'),usuario_id=1)
        self.connection.commit.assert_called_once()
        self.assertFalse(any('INSERT' in c.args[0] for c in self.cursor.execute.call_args_list))

    def test_times_quantities_and_blank_text(self):
        for changes in [dict(work_done=' '),dict(repair_finished_at='2026-01-01T08:00'),
                        dict(restored_at='2026-01-01T10:00'),dict(stopped_at='2026-01-01T09:30',restored_at='2026-01-01T10:00'),
                        dict(parts=[{'spare_part_id':8,'quantity':0}]),dict(waiting_parts_minutes=61),
                        dict(parts=[{'spare_part_id':8,'quantity':1},{'spare_part_id':8,'quantity':1}]),
                        dict(repair_finished_at=(mod.local_now()+timedelta(days=1)).isoformat())]:
            with self.subTest(changes=changes),self.assertRaises(ValidationError):self.completion(**changes)

    def test_receipt_defaults_and_persists_conformity(self):
        for payload in [{}, {'notes': None}, {'notes': ''}, {'notes': '   '}]:
            with self.subTest(payload=payload):
                self.assertEqual(mod.ReceiptWrite(**payload).notes, 'Entrega conforme')
        self.assertEqual(mod.ReceiptWrite(notes='  Recibido sin novedades  ').notes, 'Recibido sin novedades')
        with self.assertRaises(ValidationError):
            mod.ReceiptWrite(notes='x' * 1001)
        self.cursor.execute.return_value.fetchone.return_value=self.locked('POR_RECIBIR')
        self.endpoint('/{request_id}/recibir')(5, mod.ReceiptWrite(notes=' '), usuario_id=1)
        self.assertEqual(self.cursor.execute.call_args.args[2], 'Entrega conforme')
        self.connection.commit.assert_called_once()

    def test_optional_delivery_fields_accept_omitted_null_and_blank(self):
        fields = ('cause', 'recommendations', 'delivery_conditions')
        payload = self.completion().model_dump()
        for field in fields:
            del payload[field]
        for extra in [{}, dict.fromkeys(fields, None), dict.fromkeys(fields, ''), dict.fromkeys(fields, '   ')]:
            with self.subTest(extra=extra):
                data = mod.CompleteWrite(**(payload | extra))
                self.assertTrue(all(getattr(data, field) is None for field in fields))
        data = self.completion(cause='  Desgaste  ')
        self.assertEqual(data.cause, 'Desgaste')
        with self.assertRaises(ValidationError):
            self.completion(recommendations='x' * 1001)

    def test_completion_without_optional_fields_still_consumes_parts(self):
        self.cursor.execute.return_value.fetchone.side_effect = [self.locked(), (33,)]
        with patch.object(mod, 'part_stock', return_value=(('MALLA','Malla','u'), Decimal(2), None)):
            self.endpoint('/{request_id}/completar')(5, self.completion(cause=None, recommendations='', delivery_conditions=None), usuario_id=2)
        update = self.cursor.execute.call_args.args
        execution = json.loads(update[2])
        self.assertIsNone(execution['cause'])
        self.assertIsNone(execution['recommendations'])
        self.assertIsNone(execution['delivery_conditions'])
        self.assertEqual(len(execution['parts']), 1)
        self.connection.commit.assert_called_once()

    def test_period_overlap_and_capacity(self):
        with self.assertRaises(ValidationError):
            mod.OperatingPeriodWrite(machine_id=3,starts_at='2026-01-01T08:00',ends_at='2026-01-01T16:00',scheduled_hours=9,operating_hours=8,notes='Turno')
        data=mod.OperatingPeriodWrite(machine_id=3,starts_at='2026-01-01T08:00',ends_at='2026-01-01T16:00',scheduled_hours=8,operating_hours=7,notes='Turno')
        endpoint=next(r.endpoint for r in self.app.routes if r.path=='/periodos-operacion' and 'POST' in r.methods)
        self.cursor.execute.return_value.fetchone.side_effect=[('OPERADOR',),(3,),(1,)]
        with self.assertRaises(HTTPException) as error:endpoint(data,usuario_id=1)
        self.assertEqual(error.exception.status_code,409)
        self.connection.commit.assert_not_called()

    def test_stock_uses_opening_balance_and_nonvoid_movements(self):
        cutoff=datetime(2026,1,1).date()
        self.cursor.execute.return_value.fetchone.side_effect=[('MALLA','Malla','u'),(cutoff,Decimal(5)),(Decimal(4),),(Decimal(2),)]
        _,stock,actual_cutoff=mod.part_stock(self.cursor,8)
        self.assertEqual(stock,Decimal(7))
        self.assertEqual(actual_cutoff,cutoff)
        sql=[call.args[0] for call in self.cursor.execute.call_args_list]
        self.assertIn('PurchasedOn>?',sql[2])
        self.assertIn('e.PerformedOn>?',sql[3])
        self.assertIn('VoidedAt IS NULL',sql[2])
        self.assertIn('VoidedAt IS NULL',sql[3])

    def test_stopped_machine_requires_time_and_preserves_reported_stop(self):
        for urgency in (1, 2, 3):
            for maintenance_type in ('CORRECTIVO', 'PREVENTIVO'):
                with self.subTest(urgency=urgency, maintenance_type=maintenance_type):
                    data = mod.RequestWrite(machine_id=3, description='Trabajo sin parada',
                        maintenance_type=maintenance_type, urgency=urgency, impact=1, risk=1)
                    self.assertIsNone(data.stopped_at)
        with self.assertRaises(ValidationError):
            mod.RequestWrite(machine_id=3,description='Cambio',maintenance_type='CORRECTIVO',urgency=4,impact=3,risk=2)
        self.original['stopped_at']='2026-01-01T08:00:00'
        self.cursor.execute.return_value.fetchone.return_value=self.locked()
        with self.assertRaises(HTTPException) as error:
            self.endpoint('/{request_id}/completar')(5,self.completion(),usuario_id=2)
        self.assertEqual(error.exception.status_code,422)
        self.connection.commit.assert_not_called()


if __name__=='__main__':
    unittest.main()
