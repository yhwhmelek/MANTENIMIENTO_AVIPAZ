import unittest
from types import SimpleNamespace
from unittest.mock import MagicMock, patch

import main


class UserNamesTests(unittest.TestCase):
    def test_existing_account_falls_back_to_login(self):
        user = SimpleNamespace(Id=1, Nombre='operador1', Nombres=None, Apellidos=None,
                               Correo='operador@example.com', Rol='OPERADOR')
        self.assertEqual(main.respuesta_usuario(user).nombre_completo, 'operador1')

    def test_admin_updates_name_without_changing_login(self):
        user = SimpleNamespace(Id=1, Nombre='operador1', Nombres='Ana', Apellidos='Pérez',
                               Correo='operador@example.com', Rol='OPERADOR')
        connection = MagicMock()
        connection.cursor.return_value.execute.return_value.fetchone.return_value = user
        with patch.object(main, 'obtener_conexion', return_value=connection):
            result = main.cambiar_nombre(1, main.CambioNombreRequest(nombres=' Ana ', apellidos=' Pérez '), 9)
        self.assertEqual(result.nombre_completo, 'Ana Pérez')
        self.assertEqual(result.nombre, 'operador1')
        connection.commit.assert_called_once()
        self.assertEqual(connection.cursor.return_value.execute.call_args.args[1:], ('Ana', 'Pérez', 1))


if __name__ == '__main__':
    unittest.main()
