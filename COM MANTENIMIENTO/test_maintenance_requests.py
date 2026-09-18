import json
import base64
import tempfile
import unittest
from pathlib import Path
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
        self.original = {'machine_id': 3, 'maintenance_type': 'CORRECTIVO', 'hour_meter': '100', 'priority_validation':{'factors':{'n':2,'i':2,'c':2}}, 'planning':{'condition':'LISTA'}}

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
                self.assertIn(self.admin if 'DELETE' in route.methods or route.path.endswith(('/atender','/completar','/evaluar','/programar','/importar-santafe-haccp','/importar-fotos-santafe-haccp')) else self.active,[d.call for d in route.dependant.dependencies])

    def test_haccp_photos_keep_manual_photo_and_do_not_duplicate(self):
        existing=[(number,json.dumps({'source_key':f'SANTAFE-HACCP-2026-{number:02d}',
                                      'image_path':'manual.jpg' if number==1 else None}))
                  for number in range(1,30)]
        self.cursor.execute.return_value.fetchall.return_value=existing
        with patch.object(mod,'save_request_image',side_effect=lambda _:f'new-{mod.uuid4().hex}.jpg') as save:
            result=self.endpoint('/importar-fotos-santafe-haccp')(usuario_id=9)
            self.assertEqual(result,{'photos_added':37,'requests_updated':29})
            updates=[call for call in self.cursor.execute.call_args_list if call.args[0].startswith('UPDATE dbo.MaintenanceRequests')]
            self.assertEqual(len(updates),29)
            first=json.loads(updates[0].args[1])
            self.assertEqual(first['image_path'],'manual.jpg')
            self.assertEqual(len(first['image_paths']),2)
            self.assertEqual(len(first['source_photo_keys']),1)
            self.cursor.execute.return_value.fetchall.return_value=[(call.args[2],call.args[1]) for call in updates]
            self.cursor.execute.reset_mock()
            again=self.endpoint('/importar-fotos-santafe-haccp')(usuario_id=9)
            self.assertEqual(again,{'photos_added':0,'requests_updated':0})
            self.assertEqual(save.call_count,37)

    def test_improvement_can_target_plant_without_tower(self):
        data = mod.RequestWrite(plant_id=1, maintenance_type='MEJORA_TECNICA', description='Adecuar área',
                                requesting_area='Calidad', target_area='Bodega', improvement_proposal='Pintar',
                                benefits=['CALIDAD'])
        self.cursor.execute.return_value.fetchone.side_effect = [('OPERADOR',), ('Santa Fe', None), (12,)]
        self.endpoint('')(data, usuario_id=1)
        saved = json.loads(self.cursor.execute.call_args.args[4])
        self.assertEqual(saved['plant_name'], 'Santa Fe')
        self.assertIsNone(saved['tower_id'])

    def test_pending_imported_improvement_can_be_completed(self):
        original = {'maintenance_type':'MEJORA_TECNICA','source_key':'SANTAFE-HACCP-2026-01',
                    'source_requester':'Equipo HACCP','image_path':'old.jpg'}
        self.cursor.execute.return_value.fetchone.side_effect = [
            ('OPERADOR',), (1,None,'PENDIENTE',json.dumps(original),None), ('Santa Fe',)]
        data = mod.ImprovementUpdate(plant_id=1, detected_at='2026-09-15T08:41',
            requesting_area='Calidad', target_area='Bodega', description='Pared deteriorada',
            improvement_proposal='Pintar pared',
            technical_evaluation=dict(affects_food_safety=True,requires_shutdown=False,
                                      requires_training=False,improves_safety=True), benefits=['CALIDAD'])
        self.endpoint('/{request_id}/mejora', 'PUT')(1, data, usuario_id=9)
        saved = json.loads(self.cursor.execute.call_args.args[2])
        self.assertEqual(saved['source_key'], original['source_key'])
        self.assertEqual(saved['plant_name'], 'Santa Fe')
        self.assertEqual(saved['description'], 'Pared deteriorada')
        self.assertEqual(saved['image_path'], 'old.jpg')

    def test_user_cannot_modify_improvement(self):
        self.cursor.execute.return_value.fetchone.return_value = ('USUARIO',)
        data = mod.ImprovementUpdate(plant_id=1, detected_at='2026-09-15T08:41',
            requesting_area='Calidad', target_area='Bodega', description='Pared deteriorada',
            improvement_proposal='Pintar pared',
            technical_evaluation=dict(affects_food_safety=True,requires_shutdown=False,
                                      requires_training=False,improves_safety=True))
        with self.assertRaises(HTTPException) as error:
            self.endpoint('/{request_id}/mejora', 'PUT')(1, data, usuario_id=1)
        self.assertEqual(error.exception.status_code, 403)

    def test_request_photo_is_stored_in_configured_folder(self):
        png = b'\x89PNG\r\n\x1a\n' + b'photo'
        with tempfile.TemporaryDirectory() as folder, patch.object(mod,'request_image_directory',return_value=Path(folder)):
            path = Path(mod.save_request_image('data:image/png;base64,'+base64.b64encode(png).decode()))
            self.assertEqual(path.parent, Path(folder))
            self.assertEqual(path.read_bytes(), png)
            with self.assertRaises(HTTPException):
                mod.save_request_image('data:image/png;base64,'+base64.b64encode(b'not a png').decode())

    def test_request_location_snapshot(self):
        data = mod.RequestWrite(machine_id=3, plant_id=1, tower_id=2, maintenance_type='CORRECTIVO', description='Revisar')
        self.cursor.execute.return_value.fetchone.side_effect = [('OPERADOR',), ('M1', 'Molino', 'Proceso'), ('Planta uno', 'Torre dos'), (3,), (12,)]
        self.endpoint('')(data, usuario_id=1)
        saved = json.loads(self.cursor.execute.call_args.args[4])
        self.assertEqual((saved['plant_id'], saved['tower_id'], saved['plant_name'], saved['tower_name']), (1, 2, 'Planta uno', 'Torre dos'))

    def test_request_rejects_wrong_location(self):
        data = mod.RequestWrite(machine_id=3, plant_id=1, tower_id=2, maintenance_type='CORRECTIVO', description='Revisar')
        for location_results in [[None], [('Planta', 'Torre'), None]]:
            with self.subTest(location=location_results):
                self.cursor.execute.reset_mock()
                self.cursor.execute.return_value.fetchone.side_effect = [('OPERADOR',), ('M1', 'Molino', 'Proceso')] + location_results
                with self.assertRaises(HTTPException) as error:
                    self.endpoint('')(data, usuario_id=1)
                self.assertEqual(error.exception.status_code, 422)
                self.assertFalse(any('INSERT INTO' in c.args[0] for c in self.cursor.execute.call_args_list))

    def test_location_requires_both_fields(self):
        for location in [dict(plant_id=1), dict(tower_id=2)]:
            with self.assertRaises(ValidationError):
                mod.RequestWrite(machine_id=3, maintenance_type='CORRECTIVO', description='Revisar', **location)

    def test_optional_partial_preevaluation(self):
        base=dict(machine_id=3,maintenance_type='CORRECTIVO',description='Revisar equipo')
        for pre in [None,{}, {'n':3}, {'i':2,'c':None}]:
            with self.subTest(pre=pre):
                data=mod.RequestWrite(**base,preevaluation=pre)
                self.assertEqual(data.preevaluation.n if data.preevaluation else None,3 if pre=={'n':3} else None)
        with self.assertRaises(ValidationError):mod.RequestWrite(**base,preevaluation={'n':5})

    def test_multiple_planned_parts_do_not_consume_stock(self):
        data=mod.RequestWrite(machine_id=3,maintenance_type='CORRECTIVO',description='Trabajo',requested_parts=[{'spare_part_id':8,'quantity':2},{'spare_part_id':9,'quantity':5}])
        self.cursor.execute.return_value.fetchone.side_effect=[('OPERADOR',),('MOL-1','Molino','Produccion'),(12,)]
        with patch.object(mod,'part_stock',side_effect=[(('A','Rodamiento','UN'),Decimal(3),None),(('B','Perno','UN'),Decimal(1),None)]):
            self.endpoint('')(data,usuario_id=1)
        saved=json.loads(self.cursor.execute.call_args.args[4])
        self.assertEqual(len(saved['requested_parts']),2)
        self.assertTrue(saved['requested_parts'][0]['stock_sufficient'])
        self.assertFalse(saved['requested_parts'][1]['stock_sufficient'])
        self.assertFalse(any('INSERT INTO dbo.MaintenancePartsUsed' in c.args[0] for c in self.cursor.execute.call_args_list))
        for items in [[{'spare_part_id':8,'quantity':0}],[{'spare_part_id':8,'quantity':1}]*2]:
            with self.assertRaises(ValidationError):mod.RequestWrite(machine_id=3,maintenance_type='CORRECTIVO',description='Trabajo',requested_parts=items)

    def improvement(self, **changes):
        return mod.RequestWrite(**(dict(preevaluation={'n':2,'i':2,'c':2},benefits=['SEGURIDAD'],description='Faltan accesos seguros', maintenance_type='MEJORA_TECNICA',
            requesting_area='SSOMA', target_area='Torre 7', improvement_proposal='Instalar pasarela',
            technical_evaluation=dict(affects_food_safety=False,requires_shutdown=True,requires_training=False,improves_safety=True),
            urgency=1,impact=1,risk=2) | changes))

    def test_improvement_requires_proposal_evaluation_and_target(self):
        for changes in ({'improvement_proposal':''},{'requesting_area':''},{'benefits':[]},{'target_area':''},{'failure':True}):
            with self.subTest(changes=changes), self.assertRaises(ValidationError):
                self.improvement(**changes)
        with self.assertRaises(ValidationError):
            mod.RequestWrite(description='Falla',maintenance_type='CORRECTIVO',urgency=1,impact=1,risk=1)

    def test_create_improvement_for_area_without_machine(self):
        self.cursor.execute.return_value.fetchone.side_effect=[('OPERADOR',),(12,)]
        result=self.endpoint('')(self.improvement(),usuario_id=1)
        self.assertEqual(result,{'id':12})
        args=self.cursor.execute.call_args.args
        self.assertIsNone(args[1])
        payload=json.loads(args[4])
        self.assertEqual(payload['machine_name'],'Torre 7')
        self.assertEqual(payload['technical_evaluation']['requires_shutdown'],True)
        self.assertFalse(payload['failure'])

    def test_complete_improvement_preserves_type_and_material_consumption(self):
        self.original=self.improvement().model_dump(mode='json') | {'priority_validation':{'factors':{'n':2,'i':2,'c':2},'technical_review':{'feasibility':'PROCEDE'}},'planning':{'condition':'LISTA'}}
        self.cursor.execute.return_value.fetchone.side_effect=[self.locked(),(33,)]
        with patch.object(mod,'part_stock',return_value=(('MAT-1','Material','UN'),Decimal(5),None)):
            self.endpoint('/{request_id}/completar')(5,self.completion(improvement_result='Acceso seguro',other_materials='Acero recuperado'),usuario_id=9)
        calls=self.cursor.execute.call_args_list
        event=next(c.args for c in calls if 'INSERT INTO dbo.MaintenanceEvents' in c.args[0])
        self.assertIsNone(event[1])
        self.assertEqual(event[3],'MEJORA_TECNICA')
        self.assertTrue(any('INSERT INTO dbo.MaintenancePartsUsed' in c.args[0] for c in calls))
        self.connection.commit.assert_called_once()

    def test_complete_improvement_requires_result(self):
        self.original=self.improvement().model_dump(mode='json') | {'priority_validation':{'factors':{'n':2,'i':2,'c':2},'technical_review':{'feasibility':'PROCEDE'}},'planning':{'condition':'LISTA'}}
        self.cursor.execute.return_value.fetchone.return_value=self.locked()
        with self.assertRaises(HTTPException) as error:
            self.endpoint('/{request_id}/completar')(5,self.completion(),usuario_id=9)
        self.assertEqual(error.exception.status_code,422)
        self.connection.commit.assert_not_called()

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
        data = mod.RequestWrite(preevaluation={'n':2,'i':2,'c':2},machine_id=3,description='Cambiar malla',maintenance_type='CORRECTIVO',urgency=3,impact=3,risk=2)
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
                    data = mod.RequestWrite(preevaluation={'n':2,'i':2,'c':2},machine_id=3, description='Trabajo sin parada',
                        maintenance_type=maintenance_type, urgency=urgency, impact=1, risk=1)
                    self.assertIsNone(data.stopped_at)
        with self.assertRaises(ValidationError):
            mod.RequestWrite(preevaluation={'n':2,'i':2,'c':2},machine_id=3,description='Cambio',maintenance_type='CORRECTIVO',equipment_stopped=True,urgency=4,impact=3,risk=2)
        self.original['stopped_at']='2026-01-01T08:00:00'
        self.cursor.execute.return_value.fetchone.return_value=self.locked()
        with self.assertRaises(HTTPException) as error:
            self.endpoint('/{request_id}/completar')(5,self.completion(),usuario_id=2)
        self.assertEqual(error.exception.status_code,422)
        self.connection.commit.assert_not_called()


if __name__=='__main__':
    unittest.main()
