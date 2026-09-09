import unittest
from unittest.mock import MagicMock, patch

from fastapi import HTTPException
from pydantic import ValidationError

import main


class MachineSparePartTests(unittest.TestCase):
    def test_quantity_and_identifiers(self):
        self.assertIsNone(main.MachineSparePartWrite(spare_part_id=1).element_id)
        for quantity in ('0', '-1', '1.001', '100000000', 'NaN'):
            with self.subTest(quantity=quantity), self.assertRaises(ValidationError):
                main.MachineSparePartWrite(spare_part_id=1, quantity_required=quantity)
        with self.assertRaises(ValidationError):
            main.MachineSparePartWrite(spare_part_id=1, element_id=0)

    def test_element_from_another_machine_rejected(self):
        connection = MagicMock()
        cursor = connection.cursor.return_value
        cursor.execute.return_value.fetchone.side_effect = [(1,), None]
        with patch.object(main, 'obtener_conexion', return_value=connection):
            with self.assertRaises(HTTPException) as error:
                main.guardar_repuesto_maquina(1, main.MachineSparePartWrite(spare_part_id=25, element_id=10))
        self.assertEqual(error.exception.status_code, 422)
        connection.commit.assert_not_called()

    def test_general_assignment_persists_null_element(self):
        connection = MagicMock()
        cursor = connection.cursor.return_value
        cursor.execute.return_value.fetchone.side_effect = [(1,), (25,), (3,)]
        cursor.description = [('machine_spare_part_id',)]
        cursor.fetchall.return_value = [(3,)]
        with patch.object(main, 'obtener_conexion', return_value=connection):
            result = main.guardar_repuesto_maquina(1, main.MachineSparePartWrite(spare_part_id=25))
        insert = next(call for call in cursor.execute.call_args_list if 'INSERT INTO' in call.args[0])
        self.assertIsNone(insert.args[1])
        self.assertEqual(result['machine_spare_part_id'], 3)
        connection.commit.assert_called_once()

    def test_edit_cannot_access_other_machine_relation(self):
        connection = MagicMock()
        cursor = connection.cursor.return_value
        cursor.execute.return_value.fetchone.side_effect = [(1,), None]
        with patch.object(main, 'obtener_conexion', return_value=connection):
            with self.assertRaises(HTTPException) as error:
                main.guardar_repuesto_maquina(1, main.MachineSparePartWrite(spare_part_id=25), 99)
        self.assertEqual(error.exception.status_code, 404)
        connection.commit.assert_not_called()

    def test_remove_deactivates_only_scoped_relation(self):
        connection = MagicMock()
        cursor = connection.cursor.return_value
        cursor.rowcount = 1
        with patch.object(main, 'obtener_conexion', return_value=connection):
            main.quitar_repuesto_maquina(1, 3, usuario_id=1)
        query = cursor.execute.call_args
        self.assertIn('SET Active=0', query.args[0])
        self.assertEqual(query.args[1:], (1, 3))
        connection.commit.assert_called_once()

    def test_report_filters_are_parameterized_and_exclude_inactive(self):
        for filters, expected in (
            ({'machine_id': 1}, ('m.MachineId=?', 1)),
            ({'element_id': 10}, ('m.ElementId=?', 10)),
            ({'spare_part_id': 25}, ('m.SparePartId=?', 25)),
        ):
            with self.subTest(filters=filters):
                connection = MagicMock()
                cursor = connection.cursor.return_value
                cursor.description = [('machine_spare_part_id',)]
                cursor.fetchall.return_value = [(3,)]
                args = dict(machine_id=None, element_id=None, spare_part_id=None, critical_only=True, usuario_id=1)
                args.update(filters)
                with patch.object(main, 'obtener_conexion', return_value=connection):
                    self.assertEqual(main.consultar_aplicaciones_repuestos(**args), [{'machine_spare_part_id': 3}])
                query = cursor.execute.call_args.args
                self.assertIn(expected[0], query[0])
                self.assertEqual(query[1:], (expected[1],))
                self.assertIn('m.Active=1', query[0])
                self.assertIn('m.IsCritical=1', query[0])
                self.assertIn('LEFT JOIN dbo.MachineElements', query[0])
                connection.commit.assert_not_called()

    def test_report_requires_selection(self):
        with patch.object(main, 'obtener_conexion') as connect:
            with self.assertRaises(HTTPException) as error:
                main.consultar_aplicaciones_repuestos(machine_id=None, element_id=None, spare_part_id=None, usuario_id=1)
        self.assertEqual(error.exception.status_code, 422)
        connect.assert_not_called()

    def test_report_requires_active_user(self):
        route = next(route for route in main.app.routes if getattr(route, 'path', '') == '/reportes/repuestos')
        self.assertIn(main.obtener_usuario_activo, [dependency.call for dependency in route.dependant.dependencies])

    def test_write_routes_require_admin(self):
        routes = [route for route in main.app.routes if getattr(route, 'path', '').startswith('/maquinas/{machine_id}/repuestos')]
        self.assertEqual(len(routes), 4)
        for route in routes:
            expected = main.obtener_usuario_activo if 'GET' in route.methods else main.obtener_admin_actual
            self.assertIn(expected, [dependency.call for dependency in route.dependant.dependencies])


if __name__ == '__main__':
    unittest.main()
