# API de Mantenimiento

API de autenticacion creada con FastAPI, pyodbc y SQL Server.

## Preparacion

Se necesita Python 3.10 o superior y Microsoft ODBC Driver 18 for SQL Server.

```powershell
python -m venv .venv
.venv\Scripts\Activate.ps1
pip install -r requirements.txt
Copy-Item .env.example .env
```

Edita `.env` con los datos reales de SQL Server y una clave JWT secreta.

## Crear el primer usuario

La contrasena se solicita sin mostrarla en la terminal y solo se guarda su hash bcrypt.

```powershell
python crear_usuario.py
```

## Ejecutar la API

```powershell
uvicorn main:app --reload
```

Documentacion interactiva: http://127.0.0.1:8000/docs

Ejemplo de `POST /auth/login`:

```json
{
  "nombre": "admin",
  "password": "tu-contrasena"
}
```
