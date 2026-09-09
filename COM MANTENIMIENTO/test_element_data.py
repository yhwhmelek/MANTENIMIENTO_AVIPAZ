import unittest
from types import SimpleNamespace
from unittest.mock import MagicMock, patch

from fastapi import HTTPException
from pydantic import ValidationError

import main


class ElementDataTests(unittest.TestCase):
    def test_supported_assignments(self):
        for kind in ('NONE', 'MOTOR', 'REDUCTOR'):
            self.assertEqual(main.MachineElementTypeWrite(name='Tipo', specification_type=kind).specification_type, kind)
        with self.assertRaises(ValidationError):
            main.MachineElementTypeWrite(name='Tipo', specification_type='UNKNOWN')

    def test_wrong_data_rejected_for_all_operations(self):
        for suffix, expected, other, model in (
            ('motor', 'MOTOR', 'REDUCTOR', main.MotorSpecificationWrite),
            ('reductor', 'REDUCTOR', 'MOTOR', main.GearReducerSpecificationWrite),
        ):
            for assigned in (other, 'NONE'):
                for operation in ('obtener', 'guardar', 'eliminar'):
                    with self.subTest(data=expected, assigned=assigned, operation=operation):
                        connection = MagicMock()
                        connection.cursor.return_value.execute.return_value.fetchone.return_value = SimpleNamespace(SpecificationType=assigned)
                        args = (1, model()) if operation == 'guardar' else (1,)
                        with patch.object(main, 'obtener_conexion', return_value=connection):
                            with self.assertRaises(HTTPException) as error:
                                getattr(main, f'{operation}_especificaciones_{suffix}')(*args, usuario_id=1)
                        self.assertEqual(error.exception.status_code, 409)
                        connection.commit.assert_not_called()

    def test_missing_element(self):
        cursor = MagicMock()
        cursor.execute.return_value.fetchone.return_value = None
        with self.assertRaises(HTTPException) as error:
            main.validar_tipo_data(cursor, 99, 'MOTOR')
        self.assertEqual(error.exception.status_code, 404)

    def test_matching_data_allowed(self):
        for kind in ('MOTOR', 'REDUCTOR'):
            cursor = MagicMock()
            cursor.execute.return_value.fetchone.return_value = SimpleNamespace(SpecificationType=kind)
            main.validar_tipo_data(cursor, 1, kind)

    def test_existing_incompatible_data_blocks_reassignment(self):
        for kind in ('NONE', 'MOTOR', 'REDUCTOR'):
            cursor = MagicMock()
            cursor.execute.return_value.fetchone.return_value = SimpleNamespace(ElementId=1)
            with self.assertRaises(HTTPException) as error:
                main.validar_data_existente(cursor, 1, kind)
            self.assertEqual(error.exception.status_code, 409)

    def test_type_update_preserves_existing_data(self):
        connection = MagicMock()
        cursor = connection.cursor.return_value
        cursor.execute.return_value.fetchone.side_effect = [
            SimpleNamespace(SpecificationType='MOTOR'), SimpleNamespace(ElementId=1),
        ]
        cursor.execute.return_value.fetchall.return_value = [SimpleNamespace(ElementId=1)]
        with patch.object(main, 'obtener_conexion', return_value=connection):
            with self.assertRaises(HTTPException) as error:
                main.actualizar_tipo_elemento(1, main.MachineElementTypeWrite(name='Tipo', specification_type='REDUCTOR'), usuario_id=1)
        self.assertEqual(error.exception.status_code, 409)
        connection.commit.assert_not_called()
        self.assertFalse(any('UPDATE ' in call.args[0] for call in cursor.execute.call_args_list))


if __name__ == '__main__':
    unittest.main()
