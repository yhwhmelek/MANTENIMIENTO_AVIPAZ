import ast
from pathlib import Path
from types import SimpleNamespace
from contextlib import closing
from unittest import TestCase, main
from unittest.mock import Mock
from fastapi import HTTPException
from fastapi.responses import FileResponse


class MachinePhotoTests(TestCase):
    def endpoint(self, row, stored):
        tree = ast.parse(Path(__file__).with_name('main.py').read_text(encoding='utf-8-sig'))
        fn = next(node for node in tree.body if isinstance(node, ast.FunctionDef) and node.name == 'imagen_maquina')
        self.assertIn('obtener_usuario_activo', ast.unparse(fn.args.defaults[0]))
        fn.decorator_list = []
        fn.args.defaults = []
        connection = Mock()
        cursor = connection.cursor.return_value
        cursor.execute.return_value.fetchone.return_value = row
        resolve = Mock(return_value=stored)
        ns = dict(closing=closing, obtener_conexion=lambda: connection,
                  pyodbc=SimpleNamespace(Error=OSError), HTTPException=HTTPException,
                  FileResponse=FileResponse, stored_image=resolve)
        exec(compile(ast.Module(body=[fn], type_ignores=[]), '<endpoint>', 'exec'), ns)
        return ns['imagen_maquina'], cursor, resolve

    def test_returns_corresponding_machine_photo(self):
        endpoint, cursor, resolve = self.endpoint(SimpleNamespace(MachineImagePath='saved.jpg'), Path('saved.jpg'))
        result = endpoint(27, 3)
        self.assertIsInstance(result, FileResponse)
        cursor.execute.assert_called_once_with('SELECT MachineImagePath FROM dbo.Machines WHERE MachineId = ?', 27)
        resolve.assert_called_once_with('saved.jpg')

    def test_missing_machine_photo_or_file(self):
        for row in [None, SimpleNamespace(MachineImagePath=None), SimpleNamespace(MachineImagePath='missing.jpg')]:
            endpoint, _, _ = self.endpoint(row, None)
            with self.assertRaises(HTTPException) as error:
                endpoint(27, 3)
            self.assertEqual(error.exception.status_code, 404)


if __name__ == '__main__':
    main()
