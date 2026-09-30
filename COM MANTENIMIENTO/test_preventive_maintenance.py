import json
import unittest
from datetime import date, timedelta
from io import BytesIO
from unittest.mock import MagicMock
from zipfile import ZipFile
from xml.etree import ElementTree as ET
from fastapi import FastAPI, HTTPException
from pydantic import ValidationError
from preventive_maintenance import (ActivityWrite, PlanWrite, Frequency, ChecklistResult, ChecklistWrite,
    due_cycles, next_due, monday, item_status, checklist_complete, register_preventive, now, WeekWrite)
from preventive_export import workbook


class RecurrenceTests(unittest.TestCase):
    def test_month_end_does_not_drift(self):
        f={'unit':'MESES','every':1}
        feb=next_due(date(2026,1,31),f,31)
        self.assertEqual(feb,date(2026,2,28))
        self.assertEqual(next_due(feb,f,31),date(2026,3,31))
        self.assertEqual(next_due(date(2028,1,31),f,31),date(2028,2,29))

    def test_month_end_year_transition(self):
        self.assertEqual(next_due(date(2026,12,31),{'unit':'MESES','every':3},31),date(2027,3,31))

    def test_week_normalizes_sunday(self):
        self.assertEqual(monday(date(2026,10,4)),date(2026,9,28))

    def test_daily_includes_sunday(self):
        p={'next_due':'2026-09-28','first_due':'2026-09-28'}
        cycles=due_cycles(p,{'frequency':{'unit':'DIAS','every':1}},date(2026,10,1))
        self.assertEqual(len(cycles),7)
        self.assertEqual(cycles[-1]['scheduled'],'2026-10-04')
        self.assertEqual(cycles[-1]['next_due'],'2026-10-05')

    def test_overdue_keeps_original_due_without_alert_storm(self):
        p={'next_due':'2020-01-01','first_due':'2020-01-01'}
        cycles=due_cycles(p,{'frequency':{'unit':'DIAS','every':1}},date(2026,10,1))
        self.assertLessEqual(len(cycles),8)
        self.assertEqual(cycles[0]['due'],'2020-01-01')
        self.assertGreater(cycles[0]['skipped'],2000)
        self.assertEqual(cycles[0]['scheduled'],'2026-09-28')

    def test_override_frequency(self):
        p={'next_due':'2026-09-28','first_due':'2026-09-28','frequency_override':{'unit':'MESES','every':1}}
        cycles=due_cycles(p,{'frequency':{'unit':'DIAS','every':1}},date(2026,10,1))
        self.assertEqual(len(cycles),1)
        self.assertEqual(cycles[0]['next_due'],'2026-10-28')

    def test_future_plan_not_due(self):
        self.assertEqual(due_cycles({'next_due':'2026-11-01','first_due':'2026-11-01'},{'frequency':{'unit':'MESES','every':1}},date(2026,10,1)),[])

    def test_invalid_frequency(self):
        for every in [0,-1,1201]:
            with self.assertRaises(ValidationError): Frequency(every=every,unit='DIAS')

    def test_plan_override_requires_reason(self):
        with self.assertRaises(ValidationError):
            PlanWrite(activity_id=1,machine_id=1,first_due='2026-10-01',frequency_override={'every':2,'unit':'MESES'})

    def test_point_names_unique(self):
        with self.assertRaises(ValidationError):
            PlanWrite(activity_id=1,machine_id=1,first_due='2026-10-01',points=[{'name':'DE'},{'name':'de'}])

    def test_missing_work_requires_reason(self):
        with self.assertRaises(ValidationError): ChecklistResult(key='1',status='NO_REALIZADO',notes=' ')

    def test_priority_must_be_explicit(self):
        with self.assertRaises(ValidationError):
            ActivityWrite(name='Engrase',procedure='Revisar',frequency={'every':1,'unit':'MESES'},group='MECANICO',duration_minutes=60)


class ExecutionTests(unittest.TestCase):
    def test_partial_route_is_not_executed(self):
        data={'preventive':{'items':[{'status':'REALIZADO'},{'status':'NO_REALIZADO'}]},'admin_review':{'by':1}}
        self.assertEqual(item_status('CERRADA',data),'PARCIAL')

    def test_delivered_and_verified_are_distinct(self):
        data={'preventive':{'items':[{'status':'REALIZADO'}]}}
        self.assertEqual(item_status('POR_RECIBIR',data),'POR_VALIDAR')
        data['admin_review']={'by':1}
        self.assertEqual(item_status('POR_RECIBIR',data),'EJECUTADO')
        self.assertEqual(item_status('CERRADA',data,moved=True),'REPROGRAMADO')

    def test_all_omitted_is_not_executed(self):
        self.assertEqual(item_status('CERRADA',{'preventive':{'items':[{'status':'NO_REALIZADO'}]}}),'NO_REALIZADO')

    def test_delivery_requires_all_points_and_participants(self):
        for items,people in [([],[]),([{'status':'PENDIENTE'}],[{'user_id':1,'minutes':30}]),([{'status':'REALIZADO'}],[])]:
            with self.assertRaises(HTTPException):checklist_complete({'preventive':{'items':items,'participants':people}})
        checklist_complete({'preventive':{'items':[{'status':'REALIZADO'},{'status':'NO_REALIZADO','notes':'Sin acceso'}],'participants':[{'user_id':1,'minutes':30}]}})
        checklist_complete({})


class EndpointTests(unittest.TestCase):
    def setUp(self):
        self.conn=MagicMock(); self.cursor=self.conn.cursor.return_value; self.app=FastAPI()
        register_preventive(self.app,lambda:self.conn,lambda:1,lambda:1)

    def endpoint(self,path,method='GET'):
        return next(r.endpoint for r in self.app.routes if r.path==path and method in r.methods)

    def test_read_rejects_nonmaintenance(self):
        for role in ('USUARIO','OPERADOR'):
            self.cursor.execute.return_value.fetchone.return_value=(role,)
            with self.assertRaises(HTTPException) as e:self.endpoint('/preventivos/catalogo')(usuario_id=2)
            self.assertEqual(e.exception.status_code,403)

    def test_week_returns_closed_snapshot_without_recomputing(self):
        snapshot={'week':'2026-09-21','closed':True,'entries':[{'status':'PENDIENTE'}]}
        self.cursor.execute.return_value.fetchone.side_effect=[('MECANICO',),(json.dumps(snapshot),)]
        self.assertEqual(self.endpoint('/preventivos/semana')(week=date(2026,9,21),usuario_id=2),snapshot)
        self.assertEqual(self.cursor.execute.call_count,2)

    def test_checklist_rejects_other_executor(self):
        self.cursor.execute.return_value.fetchone.side_effect=[('MECANICO',),('EN_PROCESO',3,'{}')]
        data=ChecklistWrite(revision=0,items=[{'key':'1','status':'REALIZADO'}])
        with self.assertRaises(HTTPException):self.endpoint('/preventivos/solicitudes/{request_id}/checklist','PUT')(1,data,usuario_id=2)
        self.conn.commit.assert_not_called()

    def test_checklist_rejects_changed_point_ids(self):
        raw=json.dumps({'preventive':{'revision':0,'items':[{'key':'1','name':'DE','status':'PENDIENTE'}]}})
        self.cursor.execute.return_value.fetchone.side_effect=[('MECANICO',),('EN_PROCESO',2,raw)]
        data=ChecklistWrite(revision=0,items=[{'key':'forged','status':'REALIZADO'}])
        with self.assertRaises(HTTPException) as e:self.endpoint('/preventivos/solicitudes/{request_id}/checklist','PUT')(1,data,usuario_id=2)
        self.assertEqual(e.exception.status_code,422)

    def test_close_future_week_rejected(self):
        self.cursor.execute.return_value.fetchone.return_value=None
        with self.assertRaises(HTTPException) as e:self.endpoint('/preventivos/cerrar-semana','POST')(WeekWrite(week=now().date()+timedelta(days=14)),usuario_id=1)
        self.assertEqual(e.exception.status_code,422)


class ExportTests(unittest.TestCase):
    def test_xlsx_is_valid_and_user_text_is_not_formula(self):
        r=dict(key='x',request_id=1,scheduled='2026-10-04',status='PARCIAL',notes='=HYPERLINK("x")',completed_at=None,
               origin='MT/02-01',plant='Planta',tower='Torre',machine='Molino',element='Eje',activity='Engrase',route='Ruta',
               kind='PREVENTIVO',priority='MEDIO',crew_size=2,minutes=60,group='MECANICO',assignee='Persona',reviewer=None,
               items=[dict(name='DE',status='NO_REALIZADO',notes='Sin acceso')])
        report=dict(week='2026-09-28',end='2026-10-04',closed=False,summary=dict(programmed=1,executed=0,percent=0),entries=[r])
        with ZipFile(BytesIO(workbook(report))) as z:
            for name in z.namelist():ET.fromstring(z.read(name))
            root=ET.fromstring(z.read('xl/worksheets/sheet1.xml'))
            ns={'m':'http://schemas.openxmlformats.org/spreadsheetml/2006/main'}
            self.assertEqual(root.findall('.//m:f',ns),[])
            self.assertIn('Domingo',z.read('xl/worksheets/sheet1.xml').decode())
            self.assertIn('NO_REALIZADO',z.read('xl/worksheets/sheet2.xml').decode())


if __name__=='__main__':unittest.main()
