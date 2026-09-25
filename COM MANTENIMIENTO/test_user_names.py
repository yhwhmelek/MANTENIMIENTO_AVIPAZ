import unittest
from types import SimpleNamespace
from unittest.mock import MagicMock, patch

from fastapi import HTTPException
from pydantic import ValidationError

import main


class UserNamesTests(unittest.TestCase):
    def test_admin_can_assign_technical_roles(self):
        self.assertEqual(main.CambioRolRequest(rol='MECANICO').rol, 'MECANICO')
        self.assertEqual(main.CambioRolRequest(rol='ELECTRICO').rol, 'ELECTRICO')
        with self.assertRaises(ValidationError):
            main.CambioRolRequest(rol='SUPERVISOR')

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

    def test_user_updates_own_email_and_login(self):
        user = SimpleNamespace(Id=1, Nombre='ana2', Nombres='Ana', Apellidos='Pérez',
                               Correo='nuevo@example.com', Rol='USUARIO')
        connection = MagicMock()
        cursor = connection.cursor.return_value
        cursor.execute.return_value.fetchone.side_effect = [None, user]
        with patch.object(main, 'obtener_conexion', return_value=connection):
            result = main.actualizar_perfil(main.PerfilWrite(
                nombre=' ana2 ', nombres='Ana', apellidos='Pérez', correo='NUEVO@example.com'), 1)
        self.assertEqual((result.nombre, result.correo), ('ana2', 'nuevo@example.com'))
        self.assertEqual(cursor.execute.call_args.args[1:], ('ana2', 'Ana', 'Pérez', 'nuevo@example.com', 1))
        connection.commit.assert_called_once()

    def test_duplicate_email_does_not_update_profile(self):
        connection = MagicMock()
        cursor = connection.cursor.return_value
        cursor.execute.return_value.fetchone.return_value = (2,)
        with patch.object(main, 'obtener_conexion', return_value=connection):
            with self.assertRaises(HTTPException) as raised:
                main.actualizar_perfil(main.PerfilWrite(nombre='ana', correo='ocupado@example.com'), 1)
        self.assertEqual(raised.exception.status_code, 409)
        connection.commit.assert_not_called()

    def test_admin_deletes_user_without_history(self):
        connection=MagicMock()
        connection.cursor.return_value.execute.return_value.fetchone.return_value=(4,)
        with patch.object(main,'obtener_conexion',return_value=connection):
            self.assertEqual(main.eliminar_usuario(4,9),{'id':4})
        self.assertIn('DELETE FROM dbo.Usuarios',connection.cursor.return_value.execute.call_args.args[0])
        connection.commit.assert_called_once()

    def test_admin_cannot_delete_own_account(self):
        with self.assertRaises(HTTPException) as raised:
            main.eliminar_usuario(9,9)
        self.assertEqual(raised.exception.status_code,409)

    def test_password_requires_current_password(self):
        connection = MagicMock()
        cursor = connection.cursor.return_value
        cursor.execute.return_value.fetchone.return_value = SimpleNamespace(PasswordHash='hash')
        with patch.object(main, 'obtener_conexion', return_value=connection), patch.object(main.bcrypt, 'checkpw', return_value=False):
            with self.assertRaises(HTTPException) as raised:
                main.actualizar_password(main.CambioPasswordRequest(password_actual='incorrecta', password_nueva='nueva-clave'), 1)
        self.assertEqual(raised.exception.status_code, 422)
        connection.commit.assert_not_called()


if __name__ == '__main__':
    unittest.main()
