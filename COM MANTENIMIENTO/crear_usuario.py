import getpass
import os

import bcrypt
import pyodbc
from dotenv import load_dotenv


load_dotenv()


def main():
    cadena = os.getenv("SQLSERVER_CONNECTION_STRING")
    if not cadena:
        raise RuntimeError("Falta SQLSERVER_CONNECTION_STRING en el archivo .env")

    nombre = input("Nombre de usuario: ").strip()
    nombres = input("Nombre: ").strip()
    apellidos = input("Apellido: ").strip()
    correo = input("Correo: ").strip().lower()
    password = getpass.getpass("Contrasena: ")
    rol = input("Rol [ADMIN/USUARIO]: ").strip().upper()

    if not nombre or not nombres or not apellidos or not correo or not password:
        raise ValueError("Usuario, nombre, apellido, correo y contrasena son obligatorios")
    if rol not in {"ADMIN", "USUARIO"}:
        raise ValueError("El rol debe ser ADMIN o USUARIO")

    password_hash = bcrypt.hashpw(
        password.encode("utf-8"), bcrypt.gensalt()
    ).decode("utf-8")

    with pyodbc.connect(cadena) as conexion:
        conexion.cursor().execute(
            """
            INSERT INTO dbo.Usuarios (Nombre, Nombres, Apellidos, Correo, PasswordHash, Rol)
            VALUES (?, ?, ?, ?, ?, ?)
            """,
            nombre,
            nombres,
            apellidos,
            correo,
            password_hash,
            rol,
        )
        conexion.commit()

    print("Usuario creado correctamente.")


if __name__ == "__main__":
    main()
