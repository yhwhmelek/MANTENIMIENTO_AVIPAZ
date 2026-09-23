import json
import unittest
from pathlib import Path
from datetime import datetime
from unittest.mock import MagicMock
from fastapi import FastAPI, HTTPException
from pydantic import ValidationError
from maintenance_requests import RequestWrite, CompleteWrite, StartWorkWrite, register_maintenance_requests
from request_priority import NIC, priority, backlog_key, ValidationWrite, PlanningWrite


class PriorityTests(unittest.TestCase):
    def setUp(self):
        self.connection=MagicMock()
        self.cursor=self.connection.cursor.return_value
        self.app=FastAPI()
        self.active=lambda:1
        self.admin=lambda:9
        register_maintenance_requests(self.app,lambda:self.connection,self.active,self.admin)
        self.original={'machine_id':1,'maintenance_type':'CORRECTIVO','preevaluation':{'n':1,'i':1,'c':1}}

    def endpoint(self,suffix):
        return next(r.endpoint for r in self.app.routes if r.path=='/solicitudes-mantenimiento/{request_id}/'+suffix)

    def lock(self,status='PENDIENTE'):
        return (1,None,status,json.dumps(self.original),datetime(2026,1,1,8),datetime(2026,1,1,7),None)

    def validation(self,**changes):
        return ValidationWrite(**(dict(factors={'n':1,'i':1,'c':4},justification='Consecuencia confirmada',expected_revision=0)|changes))

    def plan(self,**changes):
        return PlanningWrite(**(dict(assigned_user_id=9,responsible='Tecnico',resources='Rodamiento y personal',permits='No aplica',window='Parada de linea',
            condition='ESPERA_REPUESTOS',notes='Compra pendiente',expected_revision=0)|changes))

    def test_all_64_combinations_match_matrix_maps(self):
        cases=json.loads(Path(__file__).with_name('priority_matrix_reference.json').read_text(encoding='utf-8'))['cases']
        self.assertEqual(len(cases),64)
        for case in cases:
            with self.subTest(case=case):
                result=priority({key:case[key] for key in ('n','i','c')})
                self.assertEqual(result['level'],case['level'])
                self.assertEqual(result['score'],case['n']*case['i']*case['c'])
        for factors,level in [((3,4,2),'ALTO'),((4,1,4),'ALTO'),((2,1,1),'BAJO'),((2,2,1),'BAJO'),((4,3,2),'ALTO'),((3,1,4),'ALTO')]:
            self.assertEqual(priority(dict(zip(('n','i','c'),factors)))['level'],level)

    def test_invalid_factors_and_forged_official_fields_rejected(self):
        for value in [0,5,True,1.5]:
            with self.assertRaises(ValidationError): NIC(n=value,i=1,c=1)
        self.assertIsNone(RequestWrite(machine_id=1,maintenance_type='CORRECTIVO',description='Anomalia').preevaluation)
        with self.assertRaises(ValidationError):
            RequestWrite(machine_id=1,maintenance_type='CORRECTIVO',description='Anomalia',preevaluation={'n':1,'i':1,'c':1},priority_validation={})
        data=RequestWrite(machine_id=1,maintenance_type='CORRECTIVO',description='Anomalia',preevaluation={'n':4,'i':1,'c':1})
        self.assertIsNone(data.stopped_at)  # N=4 no equivale a equipo parado.

    def test_sort_uses_level_c_i_n_then_age_not_product(self):
        def row(id,n,i,c,date='2026-01-01'):
            return {'id':id,'requested_at':date,'request_data':{'priority_validation':{'factors':dict(n=n,i=i,c=c)}}}
        rows=[row(1,4,3,2),row(2,1,1,4),row(3,4,4,4),row(4,1,2,4),row(5,2,2,4),row(6,2,2,4,'2025-01-01')]
        self.assertEqual([r['id'] for r in sorted(rows,key=backlog_key)],[3,6,5,4,2,1])

    def test_unvalidated_requests_come_first_by_age(self):
        rows=[{'id':2,'requested_at':'2026-01-02','request_data':{'priority_validation':None}},
              {'id':1,'requested_at':'2026-01-01','request_data':{'priority_validation':None}},
              {'id':3,'requested_at':'2025-01-01','request_data':{'priority_validation':{'factors':{'n':4,'i':4,'c':4}}}}]
        self.assertEqual([r['id'] for r in sorted(rows,key=backlog_key)],[1,2,3])

    def test_validation_preserves_preevaluation_and_records_actor(self):
        self.cursor.execute.return_value.fetchone.side_effect=[self.lock(),('Jefe',)]
        result=self.endpoint('evaluar')(1,self.validation(),usuario_id=9)
        saved=json.loads(self.cursor.execute.call_args.args[1])
        self.assertEqual(saved['preevaluation'],self.original['preevaluation'])
        self.assertEqual(saved['priority_validation']['by'],9)
        self.assertEqual(saved['priority_history'][0]['justification'],'Consecuencia confirmada')
        self.assertEqual(result['priority']['level'],'ALTO')
        self.assertTrue(result['priority']['escalated'])

    def test_programming_does_not_reduce_priority(self):
        self.original['priority_validation']={'factors':{'n':4,'i':4,'c':4}}
        self.cursor.execute.return_value.fetchone.side_effect=[self.lock(),('TÃ©cnico','MECANICO'),('Jefe',)]
        self.endpoint('programar')(1,self.plan(),usuario_id=9)
        saved=json.loads(self.cursor.execute.call_args.args[1])
        self.assertEqual(priority(saved['priority_validation']['factors'])['level'],'CRITICO')
        self.assertEqual(saved['planning']['condition'],'ESPERA_REPUESTOS')
        self.assertEqual((saved['planning']['assigned_user_id'],saved['planning']['responsible']),(9,'TÃ©cnico'))

    def test_programming_saves_parts_assigned_to_a_machine(self):
        self.original['priority_validation']={'factors':{'n':2,'i':2,'c':2}}
        relation=(17,1,10,25,'ROD-01','Rodamiento','UN','M-01','Molino','MOT-01','Motor principal')
        self.cursor.execute.return_value.fetchone.side_effect=[self.lock(),('TÃ©cnico','MECANICO'),relation,('Jefe',)]
        data=self.plan(requested_parts=[{'machine_spare_part_id':17,'quantity':'2'}])
        self.endpoint('programar')(1,data,usuario_id=9)
        saved=json.loads(self.cursor.execute.call_args.args[1])
        part=saved['planning']['requested_parts'][0]
        self.assertEqual((part['spare_part_id'],part['quantity'],part['machine_code']),(25,'2','M-01'))

    def test_programming_accepts_active_contractor(self):
        self.original['priority_validation']={'factors':{'n':2,'i':2,'c':2}}
        self.cursor.execute.return_value.fetchone.side_effect=[self.lock(),('Servicio externo','ELECTRICO'),('Jefe',)]
        data=self.plan(assignment_type='CONTRACTOR',assigned_user_id=None,contractor_id=4)
        self.endpoint('programar')(1,data,usuario_id=9)
        saved=json.loads(self.cursor.execute.call_args.args[1])['planning']
        self.assertEqual((saved['contractor_id'],saved['responsible'],saved['responsible_role']),(4,'Servicio externo','CONTRATISTA'))
        self.assertTrue(saved['review_required'])

    def test_programming_rejects_duplicate_assigned_part(self):
        with self.assertRaises(ValidationError):
            self.plan(requested_parts=[{'machine_spare_part_id':17,'quantity':'1'},{'machine_spare_part_id':17,'quantity':'2'}])

    def test_execution_gates_and_closed_evaluation(self):
        for data in [self.original, self.original|{'priority_validation':{'factors':{'n':1,'i':1,'c':1}}}]:
            self.original=data
            self.cursor.execute.return_value.fetchone.return_value=self.lock()
            with self.assertRaises(HTTPException) as error:self.endpoint('atender')(1,StartWorkWrite(estimated_repair_minutes=60),usuario_id=9)
            self.assertEqual(error.exception.status_code,409)
        self.cursor.execute.return_value.fetchone.return_value=self.lock('POR_RECIBIR')
        with self.assertRaises(HTTPException):self.endpoint('evaluar')(1,self.validation(),usuario_id=9)
        self.connection.commit.assert_not_called()

    def test_improvement_requires_full_review_and_favorable_feasibility(self):
        self.original['maintenance_type']='MEJORA_TECNICA'
        self.cursor.execute.return_value.fetchone.return_value=self.lock()
        with self.assertRaises(HTTPException) as error:self.endpoint('evaluar')(1,self.validation(),usuario_id=9)
        self.assertEqual(error.exception.status_code,422)
        self.original['priority_validation']={'factors':{'n':1,'i':1,'c':1},'technical_review':{'feasibility':'NO_PROCEDE'}}
        self.original['planning']={'condition':'LISTA'}
        self.cursor.execute.return_value.fetchone.return_value=self.lock()
        with self.assertRaises(HTTPException):self.endpoint('atender')(1,StartWorkWrite(estimated_repair_minutes=60),usuario_id=9)

    def test_stale_revision_rejected_and_planning_dates_checked(self):
        self.original['priority_revision']=1
        self.cursor.execute.return_value.fetchone.return_value=self.lock()
        with self.assertRaises(HTTPException) as error:self.endpoint('evaluar')(1,self.validation(),usuario_id=9)
        self.assertEqual(error.exception.status_code,409)
        with self.assertRaises(ValidationError):self.plan(condition='LISTA')
        with self.assertRaises(ValidationError):self.plan(starts_at='2026-01-01T09:00',ends_at='2026-01-01T08:00')

    def test_priority_endpoints_are_admin_only(self):
        for route in self.app.routes:
            if getattr(route,'path','').endswith(('/evaluar','/programar')):
                self.assertIn(self.admin,[d.call for d in route.dependant.dependencies])

    def test_same_day_planning_allows_start(self):
        from maintenance_requests import local_now
        day=local_now().date().isoformat()
        plan=self.plan(condition='LISTA',starts_at=day+'T10:00',estimated_duration_days=0,estimated_duration_minutes=60)
        self.assertEqual(plan.ends_at.isoformat(),day+'T11:00:00')
        self.original['priority_validation']={'factors':{'n':2,'i':2,'c':2}}
        self.original['planning']=plan.model_dump(mode='json')
        self.cursor.execute.return_value.fetchone.return_value=self.lock()
        self.endpoint('atender')(1,StartWorkWrite(estimated_repair_minutes=60),usuario_id=9)
        self.assertIn("Status='EN_PROCESO'",self.cursor.execute.call_args.args[0])
        self.connection.commit.assert_called_once()

    def test_planning_requires_positive_duration_when_start_is_set(self):
        with self.assertRaises(ValidationError):
            self.plan(starts_at='2026-01-01T09:00')
        plan=self.plan(starts_at='2026-01-01T09:00',estimated_duration_days=1,estimated_duration_minutes=30)
        self.assertEqual(plan.ends_at.isoformat(),'2026-01-02T09:30:00')
