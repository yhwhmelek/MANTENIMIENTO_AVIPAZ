import unittest
from copy import deepcopy
from types import SimpleNamespace
from unittest.mock import MagicMock, patch
from fastapi import HTTPException, FastAPI
from pydantic import ValidationError
import main
import preventive_maintenance as preventive
from plant_alerts import request_in_plant, route_request_alerts, filter_hour_alerts
from request_priority import ASSIGNMENT_GROUPS


class PlantAssignmentTests(unittest.TestCase):
    def test_plant_update_is_admin_only(self):
        route = next(r for r in main.app.routes if r.path == '/usuarios/{usuario_id}/planta')
        self.assertIn(main.obtener_admin_actual, [d.call for d in route.dependant.dependencies])

    def test_admin_assigns_existing_plant_and_profile_preserves_it(self):
        user = SimpleNamespace(Id=7,Nombre='personal',Nombres='Ana',Apellidos='Perez',Correo='ana@example.com',Rol='MECANICO',PlantId=2)
        connection = MagicMock()
        cursor = connection.cursor.return_value
        cursor.execute.return_value.fetchone.side_effect = [(2,), user]
        with patch.object(main,'obtener_conexion',return_value=connection):
            result = main.cambiar_planta(7, main.CambioPlantaRequest(planta_id=2), 1)
        self.assertEqual(result.planta_id,2)
        self.assertEqual(cursor.execute.call_args.args[1:],(2,7))
        connection.commit.assert_called_once()
        self.assertEqual(main.respuesta_usuario(user).planta_id,2)

    def test_missing_plant_is_rejected_without_update(self):
        connection = MagicMock()
        connection.cursor.return_value.execute.return_value.fetchone.return_value = None
        with patch.object(main,'obtener_conexion',return_value=connection), self.assertRaises(HTTPException) as error:
            main.cambiar_planta(7,main.CambioPlantaRequest(planta_id=99),1)
        self.assertEqual(error.exception.status_code,422)
        connection.commit.assert_not_called()
        self.assertEqual(connection.cursor.return_value.execute.call_count,1)

    def test_missing_user_is_rejected(self):
        connection = MagicMock()
        connection.cursor.return_value.execute.return_value.fetchone.return_value = None
        with patch.object(main,'obtener_conexion',return_value=connection), self.assertRaises(HTTPException) as error:
            main.cambiar_planta(999,main.CambioPlantaRequest(planta_id=None),1)
        self.assertEqual(error.exception.status_code,404)
        connection.commit.assert_not_called()

    def test_invalid_ids_and_no_implicit_plant(self):
        self.assertIsNone(main.CambioPlantaRequest(planta_id=None).planta_id)
        for plant in (0,-1):
            with self.assertRaises(ValidationError): main.CambioPlantaRequest(planta_id=plant)


class PlantRoutingTests(unittest.TestCase):
    def setUp(self):
        self.rows = [dict(id=1,request_data={'plant_id':1}),dict(id=2,request_data={'plant_id':2}),
                     dict(id=3,request_data={}),dict(id=4,machine_plant_id=2,request_data={}),
                     dict(id=5,request_data={'plant_id':None,'preventive':{'machines':[{'machine_id':1,'plant_id':1},{'machine_id':2,'plant_id':2}]}})]

    def test_requests_match_only_staff_plant_and_keep_history(self):
        for role in ('MECANICO','ELECTRICO','TECNICO'):
            rows = route_request_alerts(deepcopy(self.rows),role,2)
            self.assertEqual([r['id'] for r in rows if r['alert_in_plant']],[2,4,5])
            self.assertEqual(len(rows),5)
            self.assertTrue(all(r['alert_plant_id']==2 for r in rows))

    def test_missing_plant_does_not_broadcast(self):
        self.assertFalse(any(r['alert_in_plant'] for r in route_request_alerts(deepcopy(self.rows),'MECANICO',None)))
        self.assertFalse(request_in_plant({'request_data':{'plant_id':None}},None))

    def test_admin_receives_all_and_operator_flow_is_unchanged(self):
        for role in ('ADMIN','OPERADOR','USUARIO'):
            self.assertTrue(all(r['alert_in_plant'] for r in route_request_alerts(deepcopy(self.rows),role,None)))

    def test_hour_alerts_intersect_specialty_plant_and_threshold(self):
        entries = [dict(plan_id=1,group='MECANICO',machines=[dict(machine_id=1,state='VENCIDO'),dict(machine_id=2,state='PROXIMO'),dict(machine_id=3,state='AL_DIA')])]
        plants = {1:1,2:2,3:2}
        result = filter_hour_alerts(entries,'MECANICO',2,plants,ASSIGNMENT_GROUPS)
        self.assertEqual([m['machine_id'] for m in result[0]['machines']],[2])
        self.assertEqual(filter_hour_alerts(entries,'ELECTRICO',2,plants,ASSIGNMENT_GROUPS),[])
        self.assertEqual(filter_hour_alerts(entries,'MECANICO',None,plants,ASSIGNMENT_GROUPS),[])
        self.assertEqual(len(filter_hour_alerts(entries,'ADMIN',None,{},ASSIGNMENT_GROUPS)[0]['machines']),2)
        self.assertEqual(len(entries[0]['machines']),3)

    def test_hours_endpoint_uses_current_database_assignment(self):
        app = FastAPI()
        connection = MagicMock()
        cursor = connection.cursor.return_value
        preventive.register_preventive(app,lambda:connection,lambda:7,lambda:1)
        endpoint = next(r.endpoint for r in app.routes if r.path=='/preventivos/alertas-horas')
        entries = [dict(plan_id=1,group='MECANICO',machines=[dict(machine_id=1,state='VENCIDO'),dict(machine_id=2,state='PROXIMO')])]
        for plant, machine in ((1,1),(2,2)):
            cursor.execute.return_value.fetchone.side_effect = [('MECANICO',),('MECANICO',plant)]
            cursor.execute.return_value.fetchall.side_effect = [[(1,1),(2,2)],[],[]]
            with patch.object(preventive,'hour_states',return_value=entries):
                result = endpoint(usuario_id=7)
            self.assertEqual([m['machine_id'] for m in result[0]['machines']],[machine])

    def test_technician_has_own_group_and_general_maintenance_but_not_specialist_groups(self):
        entries = [dict(plan_id=i,group=group,machines=[dict(machine_id=1,state='VENCIDO')])
                   for i,group in enumerate(ASSIGNMENT_GROUPS)]
        result = filter_hour_alerts(entries,'TECNICO',1,{1:1},ASSIGNMENT_GROUPS)
        self.assertEqual({r['group'] for r in result},{'TECNICO','MANTENIMIENTO'})


if __name__=='__main__': unittest.main()
