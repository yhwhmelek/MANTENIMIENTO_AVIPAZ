import json
import unittest
from copy import deepcopy
from types import SimpleNamespace
from unittest.mock import MagicMock, patch

from fastapi import FastAPI, HTTPException, Request

import main
import maintenance_requests as maintenance
from operator_permissions import operator_request


class OperatorPermissionsTests(unittest.TestCase):
    def setUp(self):
        self.connection = MagicMock()
        self.cursor = self.connection.cursor.return_value
        self.app = FastAPI()
        maintenance.register_maintenance_requests(self.app, lambda: self.connection, lambda: 7, lambda: 1)

    def request(self, method, route, **params):
        return Request({'type': 'http', 'method': method, 'path': route,
                        'route': SimpleNamespace(path=route), 'path_params': params})

    def authorize(self, role, method, route, **params):
        self.cursor.execute.return_value.fetchone.return_value = SimpleNamespace(Activo=True, Rol=role)
        with patch.object(main, 'obtener_conexion', return_value=self.connection):
            return main.obtener_usuario_activo(self.request(method, route, **params), usuario_id=7)

    def test_operator_cannot_read_inventory_or_access_management_routes(self):
        # Check the real registered routes, including stock, invoices and mail attachments.
        prefixes = ('/repuestos', '/categorias-repuestos', '/stock-repuestos', '/alertas-stock',
                    '/compras-repuestos', '/consumos-repuestos', '/requisiciones-compra',
                    '/reportes/repuestos', '/proveedores', '/intervenciones', '/periodos-operacion',
                    '/actividades-priorizadas', '/contactos', '/contratistas')
        checked = 0
        for route in main.app.routes:
            if not hasattr(route, 'dependant'):
                continue
            protected = route.path.startswith(prefixes) or route.path.endswith('/repuestos')
            if not protected:
                continue
            if main.obtener_usuario_activo not in [d.call for d in route.dependant.dependencies]:
                continue
            for method in route.methods:
                with self.subTest(route=route.path, method=method):
                    with self.assertRaises(HTTPException) as error:
                        self.authorize('OPERADOR', method, route.path)
                    self.assertEqual(error.exception.status_code, 403)
                    checked += 1
        self.assertGreater(checked, 15)

    def test_technical_roles_keep_inventory_access(self):
        for role in ('MECANICO', 'ELECTRICO', 'TECNICO', 'ADMIN'):
            for route in ('/repuestos', '/stock-repuestos', '/maquinas/{machine_id}/repuestos'):
                with self.subTest(role=role, route=route):
                    self.assertEqual(self.authorize(role, 'GET', route), 7)

    def test_operator_can_load_request_catalogs_and_create(self):
        for method, route in [('GET', '/maquinas'), ('GET', '/plantas'), ('GET', '/torres'),
                              ('GET', '/solicitudes-mantenimiento'), ('POST', '/solicitudes-mantenimiento')]:
            self.assertEqual(self.authorize('OPERADOR', method, route), 7)

    def test_operator_cannot_execute_or_modify_a_request(self):
        for method, suffix in [('POST', 'atender'), ('POST', 'completar'), ('PUT', 'mejora')]:
            with self.assertRaises(HTTPException) as error:
                self.authorize('OPERADOR', method, '/solicitudes-mantenimiento/{request_id}/'+suffix, request_id=12)
            self.assertEqual(error.exception.status_code, 403)

    def test_operator_can_access_only_own_photos_and_receipts(self):
        for method, suffix in [('GET', 'imagen'), ('GET', 'imagenes/{index}'),
                               ('GET', 'trabajo-imagenes/{index}'), ('POST', 'recibir')]:
            for owner in (7, 9, None):
                with self.subTest(method=method, suffix=suffix, owner=owner):
                    self.cursor.execute.return_value.fetchone.side_effect = [
                        SimpleNamespace(Activo=True, Rol='OPERADOR'), (owner,) if owner else None]
                    request = self.request(method, '/solicitudes-mantenimiento/{request_id}/'+suffix, request_id=12)
                    with patch.object(main, 'obtener_conexion', return_value=self.connection):
                        if owner == 7:
                            self.assertEqual(main.obtener_usuario_activo(request, usuario_id=7), 7)
                        else:
                            with self.assertRaises(HTTPException) as error:
                                main.obtener_usuario_activo(request, usuario_id=7)
                            self.assertEqual(error.exception.status_code, 403)

    def test_operator_creation_rejects_both_parts_payload_formats(self):
        endpoint = next(r.endpoint for r in self.app.routes
                        if r.path == '/solicitudes-mantenimiento' and 'POST' in r.methods)
        for fields in ({'requested_parts': [{'spare_part_id': 8, 'quantity': 1}]},
                       {'requested_part_id': 8, 'requested_quantity': 1}):
            self.cursor.execute.return_value.fetchone.return_value = ('OPERADOR',)
            data = maintenance.RequestWrite(machine_id=3, maintenance_type='CORRECTIVO',
                                            description='Revisar equipo', **fields)
            with self.assertRaises(HTTPException) as error:
                endpoint(data, usuario_id=7)
            self.assertEqual(error.exception.status_code, 403)
            self.connection.rollback.assert_called()

    def test_operator_list_contains_only_own_requests_without_parts(self):
        endpoint = next(r.endpoint for r in self.app.routes
                        if r.path == '/solicitudes-mantenimiento' and 'GET' in r.methods)
        records = [{'id': user_id, 'requested_by': user_id, 'requested_at': '2026-01-01',
                    'request_data': json.dumps({'description': 'Trabajo', 'requested_parts': [
                        {'internal_code': 'REP-SECRETO'}]}), 'execution_data': None}
                   for user_id in (7, 9)]
        for role, expected in [('OPERADOR', [7]), ('MECANICO', [7, 9]), ('ELECTRICO', [7, 9])]:
            with self.subTest(role=role), patch.object(maintenance, 'records', return_value=deepcopy(records)):
                self.cursor.execute.return_value.fetchone.return_value = (role, None)
                self.cursor.fetchall.return_value = []
                result = endpoint(usuario_id=7)
                self.assertEqual([row['id'] for row in result], expected)
                if role == 'OPERADOR':
                    self.assertNotIn('REP-SECRETO', json.dumps(result))
                else:
                    self.assertIn('REP-SECRETO', json.dumps(result))

    def test_technical_roles_can_create_requests_with_parts(self):
        endpoint = next(r.endpoint for r in self.app.routes
                        if r.path == '/solicitudes-mantenimiento' and 'POST' in r.methods)
        for role in ('MECANICO', 'ELECTRICO', 'TECNICO'):
            with self.subTest(role=role):
                self.cursor.execute.return_value.fetchone.side_effect = [(role,), ('M1', 'Molino', 'Planta'), (12,)]
                data = maintenance.RequestWrite(machine_id=3, maintenance_type='CORRECTIVO', description='Reparar',
                                                requested_parts=[{'spare_part_id': 8, 'quantity': 1}])
                with patch.object(maintenance, 'part_stock', return_value=(('R1', 'Rodamiento', 'UN'), 5, None)):
                    self.assertEqual(endpoint(data, usuario_id=7), {'id': 12})
                saved = json.loads(self.cursor.execute.call_args.args[4])
                self.assertEqual(saved['requested_parts'][0]['spare_part_id'], 8)

    def test_redaction_preserves_work_but_hides_legacy_planned_and_used_parts(self):
        part = {'internal_code': 'REP-SECRETO', 'stock_before': '20'}
        row = {'requested_by': 7, 'request_data': {
            'description': 'Revisar equipo', 'requested_part_id': 8, 'requested_quantity': 1,
            'requested_part_name': 'REP-SECRETO', 'requested_part_code': 'REP-SECRETO',
            'stock_at_request': '20', 'stock_sufficient': True, 'requested_parts': [part],
            'planning': {'responsible': 'Técnico', 'requested_parts': [part], 'resources': 'REP-SECRETO'},
            'planning_history': [{'requested_parts': [part]}]},
            'execution_data': {'work_done': 'Ajuste terminado', 'parts': [part],
                               'tools': [{'description': 'REP-SECRETO'}], 'other_materials': 'REP-SECRETO'}}
        original = deepcopy(row)
        result = operator_request(row)
        self.assertNotIn('REP-SECRETO', json.dumps(result))
        self.assertNotIn('stock_at_request', result['request_data'])
        self.assertEqual(result['execution_data']['work_done'], 'Ajuste terminado')
        self.assertEqual(row, original)


if __name__ == '__main__':
    unittest.main()
