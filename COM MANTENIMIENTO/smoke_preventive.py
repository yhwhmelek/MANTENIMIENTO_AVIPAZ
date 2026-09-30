"""Prueba de integración SQL. Todos los registros de prueba se revierten al terminar."""
import json
from datetime import timedelta
from unittest.mock import patch
from fastapi import FastAPI, HTTPException
from main import obtener_conexion
import preventive_maintenance as pm
import maintenance_requests as mr


def run():
    connection = obtener_conexion()
    class RollbackConnection:
        def cursor(self): return connection.cursor()
        def commit(self): pass
        def rollback(self): pass
        def close(self): pass
    try:
        cursor = connection.cursor()
        admin = cursor.execute("SELECT TOP 1 Id FROM dbo.Usuarios WHERE Rol='ADMIN' AND Activo=1 ORDER BY Id").fetchone()
        machine = cursor.execute("SELECT TOP 1 MachineId FROM dbo.Machines WHERE Status<>'FUERA_SERVICIO' ORDER BY MachineId").fetchone()
        worker = cursor.execute("SELECT TOP 1 Id FROM dbo.Usuarios WHERE Rol IN ('MECANICO','ELECTRICO') AND Activo=1 ORDER BY Id").fetchone()
        if not admin or not machine:
            raise RuntimeError('Se requiere un administrador y una máquina existentes')
        admin, machine, worker = admin[0], machine[0], worker[0] if worker else admin[0]
        app = FastAPI()
        pm.register_preventive(app, RollbackConnection, lambda:worker, lambda:admin)
        mr.register_maintenance_requests(app, RollbackConnection, lambda:worker, lambda:admin)
        def endpoint(path, method='POST'):
            return next(r.endpoint for r in app.routes if r.path==path and method in r.methods)
        base = pm.now()-timedelta(hours=3)
        week = pm.monday(base.date())
        # Evitar reutilizar un cierre real, si la semana actual ya está cerrada.
        if cursor.execute('SELECT WeekStart FROM dbo.PreventiveWeekClosures WHERE WeekStart=?',week).fetchone():
            raise RuntimeError('La semana actual está cerrada; no se modifica para la prueba')
        activity = pm.ActivityWrite(name='PRUEBA TEMPORAL PREVENTIVO',procedure='Inspeccionar puntos',kind='ENGRASE',
            frequency={'every':1,'unit':'SEMANAS'},group='MANTENIMIENTO',duration_minutes=60,crew_size=1,factors={'n':2,'i':2,'c':2})
        aid = endpoint('/preventivos/actividades')(activity,usuario_id=admin)['id']
        plan = pm.PlanWrite(activity_id=aid,machine_id=machine,first_due=base.date(),route='PRUEBA TEMPORAL',points=[{'name':'DE','bearing_code':'TEST'},{'name':'NDE'}])
        pid = endpoint('/preventivos/planes')(plan,usuario_id=admin)['id']
        payload = pm.PublishWrite(week=week,plan_ids=[pid])
        with patch.object(pm,'now',return_value=base):
            result = endpoint('/preventivos/publicar')(payload,usuario_id=admin)
        assert len(result['request_ids'])==1
        rid = result['request_ids'][0]
        assert endpoint('/preventivos/publicar')(payload,usuario_id=admin)['request_ids']==[]
        target = week+timedelta(days=6) if base.date()!=week+timedelta(days=6) else week+timedelta(days=5)
        endpoint('/preventivos/solicitudes/{request_id}/reprogramar')(rid,pm.RescheduleWrite(scheduled_date=target,reason='Cambio de ventana de prueba'),usuario_id=admin)
        report = endpoint('/preventivos/semana','GET')(week=week,usuario_id=worker)
        rows = [r for r in report['entries'] if r['request_id']==rid]
        assert len(rows)==2 and sum(r['moved'] for r in rows)==1
        endpoint('/solicitudes-mantenimiento/{request_id}/atender')(rid,mr.StartWorkWrite(started_at=base+timedelta(minutes=5)),usuario_id=worker)
        try:
            endpoint('/solicitudes-mantenimiento/{request_id}/atender')(rid,mr.StartWorkWrite(),usuario_id=admin)
            raise AssertionError('Aceptación duplicada')
        except HTTPException as error:
            assert error.status_code==409
        endpoint('/preventivos/solicitudes/{request_id}/checklist','PUT')(rid,pm.ChecklistWrite(revision=0,
            items=[{'key':'1','status':'REALIZADO'},{'key':'2','status':'NO_REALIZADO','notes':'Sin acceso, prueba'}],
            participants=[{'user_id':worker,'minutes':60}]),usuario_id=worker)
        completed = mr.CompleteWrite(repair_started_at=(base+timedelta(minutes=5)).replace(second=0,microsecond=0),
            repair_finished_at=base+timedelta(minutes=65),work_done='Prueba temporal de checklist parcial',parts=[])
        endpoint('/solicitudes-mantenimiento/{request_id}/completar')(rid,completed,usuario_id=worker)
        endpoint('/solicitudes-mantenimiento/{request_id}/revisar')(rid,mr.ReviewWrite(),usuario_id=admin)
        endpoint('/solicitudes-mantenimiento/{request_id}/recibir')(rid,mr.ReceiptWrite(),usuario_id=admin)
        report = endpoint('/preventivos/semana','GET')(week=week,usuario_id=worker)
        row = next(r for r in report['entries'] if r['request_id']==rid and not r['moved'])
        assert row['status']=='PARCIAL' and row['human_minutes']==60
        exported = endpoint('/preventivos/semana.xlsx','GET')(week=week,usuario_id=worker)
        assert exported.body[:2]==b'PK'
        with patch.object(pm,'now',return_value=base+timedelta(days=7)):
            closed = endpoint('/preventivos/cerrar-semana')(pm.WeekWrite(week=week),usuario_id=admin)
        assert closed['closed']
        reread = endpoint('/preventivos/semana','GET')(week=week,usuario_id=worker)
        assert reread==closed
        print('SQL_SMOKE_OK: planes, publicacion idempotente, reprogramacion, aceptacion unica, checklist parcial, entrega, revision, recepcion, Excel y cierre historico')
    finally:
        connection.rollback()
        connection.close()
        print('ROLLBACK_COMPLETE: sin registros de prueba guardados')


if __name__=='__main__':
    run()
