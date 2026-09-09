import unittest
from types import SimpleNamespace
from unittest.mock import MagicMock, patch

from fastapi import HTTPException
import main


class DuplicateSparePartTests(unittest.TestCase):
    def test_copy_codes_and_new_identity(self):
        for original, occupied, expected in [
            ('REP-1', [], 'REP-1--copy'),
            ('REP-1--copy', [(2,)], 'REP-1--copy-2'),
            ('A' * 50, [], 'A' * 44 + '--copy'),
        ]:
            with self.subTest(original=original):
                connection = MagicMock()
                cursor = connection.cursor.return_value
                record = object()
                cursor.execute.return_value.fetchone.side_effect = [
                    SimpleNamespace(InternalCode=original), *occupied, None, (9,), record,
                ]
                with patch.object(main, 'obtener_conexion', return_value=connection), patch.object(main, 'convertir_repuesto', return_value='copy') as convert:
                    self.assertEqual(main.duplicar_repuesto(1, usuario_id=3), 'copy')
                insert = next(call.args for call in cursor.execute.call_args_list if 'INSERT INTO' in call.args[0])
                self.assertEqual(insert[1:], (expected, 1))
                self.assertIn('ImagePath', insert[0])
                convert.assert_called_once_with(record)
                connection.commit.assert_called_once()

    def test_missing_source_does_not_commit(self):
        connection = MagicMock()
        connection.cursor.return_value.execute.return_value.fetchone.return_value = None
        with patch.object(main, 'obtener_conexion', return_value=connection), self.assertRaises(HTTPException) as error:
            main.duplicar_repuesto(999, usuario_id=3)
        self.assertEqual(error.exception.status_code, 404)
        connection.commit.assert_not_called()

    def test_only_admin_can_duplicate(self):
        route = next(route for route in main.app.routes if getattr(route, 'path', '') == '/repuestos/{spare_part_id}/duplicar')
        self.assertIn(main.obtener_admin_actual, [dependency.call for dependency in route.dependant.dependencies])


if __name__ == '__main__':
    unittest.main()
