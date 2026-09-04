import os
import base64
import binascii
import re
from contextlib import closing
from datetime import date, datetime, timedelta, timezone
from decimal import Decimal
from pathlib import Path
from typing import Literal

import bcrypt
import jwt
import pyodbc
from dotenv import load_dotenv
from fastapi import Depends, FastAPI, HTTPException, status
from fastapi.middleware.cors import CORSMiddleware
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from fastapi.responses import FileResponse
from pydantic import BaseModel, EmailStr, Field

load_dotenv(Path(__file__).with_name(".env"), override=True)

app = FastAPI(
    title="API de Mantenimiento",
    version="1.0.0",
    description="API para autenticacion y acceso a SQL Server.",
)

origenes_permitidos = [
    origen.strip()
    for origen in os.getenv(
        "CORS_ORIGINS",
        "http://localhost:5173,http://127.0.0.1:5173",
    ).split(",")
    if origen.strip()
]

app.add_middleware(
    CORSMiddleware,
    allow_origins=origenes_permitidos,
    allow_origin_regex=(
        r"https?://(localhost|127\.0\.0\.1|"
        r"10(?:\.\d{1,3}){3}|"
        r"192\.168(?:\.\d{1,3}){2}|"
        r"172\.(?:1[6-9]|2\d|3[01])(?:\.\d{1,3}){2})"
        r"(?::\d+)?"
    ),
    allow_credentials=True,
    allow_methods=["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allow_headers=["Authorization", "Content-Type"],
)


class LoginRequest(BaseModel):
    nombre: str = Field(min_length=1, max_length=100)
    password: str = Field(min_length=1, max_length=128)


class RegistroRequest(BaseModel):
    nombre: str = Field(min_length=1, max_length=100)
    correo: EmailStr
    password: str = Field(min_length=8, max_length=128)


class UsuarioResponse(BaseModel):
    id: int
    nombre: str
    correo: EmailStr
    rol: str


class LoginResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"
    usuario: UsuarioResponse


class UsuarioAdministracionResponse(UsuarioResponse):
    activo: bool
    creado_en: datetime


class CambioRolRequest(BaseModel):
    rol: Literal["ADMIN", "USUARIO"]


class MotorBase(BaseModel):
    asset_code: str = Field(min_length=1, max_length=50)
    description: str = Field(min_length=1, max_length=200)
    brand: str | None = Field(default=None, max_length=100)
    model: str | None = Field(default=None, max_length=100)
    serial_number: str | None = Field(default=None, max_length=100)
    area: str | None = Field(default=None, max_length=100)
    location: str | None = Field(default=None, max_length=200)
    associated_equipment: str | None = Field(default=None, max_length=200)
    power_kw: Decimal | None = None
    power_hp: Decimal | None = None
    rated_voltage: Decimal | None = None
    rated_current: Decimal | None = None
    frequency_hz: Decimal | None = Decimal("60.00")
    rpm: int | None = None
    frame: str | None = Field(default=None, max_length=50)
    protection_class: str | None = Field(default="IP55", max_length=20)
    insulation_class: str | None = Field(default="F", max_length=20)
    service_factor: Decimal | None = Decimal("1.00")
    installation_date: date | None = None
    commissioning_date: date | None = None
    criticality: Literal["LOW", "MEDIUM", "HIGH", "CRITICAL"] | None = "MEDIUM"
    status: Literal["ACTIVE", "STOPPED", "REPAIR", "STANDBY", "DECOMMISSIONED"] = "ACTIVE"
    notes: str | None = None


class MotorResponse(MotorBase):
    motor_id: int
    nameplate_image_path: str | None = None
    created_at: datetime


class MotorWrite(MotorBase):
    nameplate_image_data: str | None = Field(default=None, max_length=14_000_000)


seguridad_bearer = HTTPBearer()


def obtener_variable(nombre: str) -> str:
    valor = os.getenv(nombre)
    if not valor:
        raise RuntimeError(f"Falta configurar la variable {nombre}")
    return valor


def obtener_conexion() -> pyodbc.Connection:
    cadena_conexion = obtener_variable("SQLSERVER_CONNECTION_STRING")

    # Permite ejecutar el proyecto en equipos que tienen Driver 17 aunque el
    # .env haya sido creado originalmente para Driver 18.
    drivers_instalados = set(pyodbc.drivers())
    driver_18 = "ODBC Driver 18 for SQL Server"
    driver_17 = "ODBC Driver 17 for SQL Server"
    if driver_18 not in drivers_instalados and driver_17 in drivers_instalados:
        cadena_conexion = cadena_conexion.replace(driver_18, driver_17)

    return pyodbc.connect(
        cadena_conexion,
        timeout=5,
    )


def crear_token(usuario_id: int, rol: str) -> str:
    ahora = datetime.now(timezone.utc)
    minutos = int(os.getenv("JWT_EXPIRE_MINUTES", "480"))
    payload = {
        "sub": str(usuario_id),
        "rol": rol,
        "iat": ahora,
        "exp": ahora + timedelta(minutes=minutos),
    }
    return jwt.encode(
        payload,
        obtener_variable("JWT_SECRET"),
        algorithm="HS256",
    )


def obtener_usuario_autenticado(
    credenciales: HTTPAuthorizationCredentials = Depends(seguridad_bearer),
) -> int:
    try:
        payload = jwt.decode(
            credenciales.credentials,
            obtener_variable("JWT_SECRET"),
            algorithms=["HS256"],
        )
        usuario_id = int(payload["sub"])
    except (jwt.PyJWTError, KeyError, TypeError, ValueError):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="La sesion no es valida o ha expirado",
            headers={"WWW-Authenticate": "Bearer"},
        )
    return usuario_id


def obtener_admin_actual(
    usuario_id: int = Depends(obtener_usuario_autenticado),
) -> int:
    try:
        with closing(obtener_conexion()) as conexion:
            usuario = conexion.cursor().execute(
                """
                SELECT Rol, Activo
                FROM dbo.Usuarios
                WHERE Id = ?
                """,
                usuario_id,
            ).fetchone()
    except (pyodbc.Error, RuntimeError):
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="No se pudo verificar los permisos del usuario",
        )

    if usuario is None or not bool(usuario.Activo):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="El usuario no existe o esta inactivo",
            headers={"WWW-Authenticate": "Bearer"},
        )

    if str(usuario.Rol).upper() != "ADMIN":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Solo un administrador puede administrar usuarios y roles",
        )

    return usuario_id


def obtener_usuario_activo(
    usuario_id: int = Depends(obtener_usuario_autenticado),
) -> int:
    try:
        with closing(obtener_conexion()) as conexion:
            usuario = conexion.cursor().execute(
                "SELECT Activo FROM dbo.Usuarios WHERE Id = ?",
                usuario_id,
            ).fetchone()
    except (pyodbc.Error, RuntimeError):
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="No se pudo verificar el usuario",
        )
    if usuario is None or not bool(usuario.Activo):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="El usuario no existe o esta inactivo",
        )
    return usuario_id


def convertir_motor(motor) -> MotorResponse:
    return MotorResponse(
        motor_id=motor.MotorId,
        asset_code=motor.AssetCode,
        description=motor.Description,
        brand=motor.Brand,
        model=motor.Model,
        serial_number=motor.SerialNumber,
        area=motor.Area,
        location=motor.Location,
        associated_equipment=motor.AssociatedEquipment,
        power_kw=motor.PowerKW,
        power_hp=motor.PowerHP,
        rated_voltage=motor.RatedVoltage,
        rated_current=motor.RatedCurrent,
        frequency_hz=motor.FrequencyHz,
        rpm=motor.RPM,
        frame=motor.Frame,
        protection_class=motor.ProtectionClass,
        insulation_class=motor.InsulationClass,
        service_factor=motor.ServiceFactor,
        installation_date=motor.InstallationDate,
        commissioning_date=motor.CommissioningDate,
        criticality=motor.Criticality,
        status=motor.Status,
        notes=motor.Notes,
        nameplate_image_path=motor.NameplateImagePath,
        created_at=motor.CreatedAt,
    )


def guardar_imagen_placa(asset_code: str, image_data: str | None) -> str | None:
    if not image_data:
        return None
    coincidencia = re.fullmatch(
        r"data:image/(jpeg|png|webp);base64,([A-Za-z0-9+/=\r\n]+)",
        image_data,
    )
    if not coincidencia:
        raise HTTPException(status_code=422, detail="La placa debe ser JPG, PNG o WEBP")
    extension = {"jpeg": ".jpg", "png": ".png", "webp": ".webp"}[coincidencia.group(1)]
    try:
        contenido = base64.b64decode(coincidencia.group(2), validate=True)
    except (binascii.Error, ValueError):
        raise HTTPException(status_code=422, detail="La imagen de la placa no es valida")
    if len(contenido) > 10 * 1024 * 1024:
        raise HTTPException(status_code=413, detail="La imagen no puede superar 10 MB")

    nombre_seguro = re.sub(r"[^A-Za-z0-9._-]", "_", asset_code.strip())
    carpeta = Path(os.getenv("MOTOR_NAMEPLATE_DIR", r"D:\MANTENIMIENTO\IMAGES\MOTORES\PLACAS"))
    try:
        carpeta.mkdir(parents=True, exist_ok=True)
        ruta = carpeta / f"{nombre_seguro}{extension}"
        ruta.write_bytes(contenido)
    except OSError:
        raise HTTPException(status_code=503, detail="No se pudo guardar la imagen de la placa")
    return str(ruta)


MOTOR_SELECT = """
    SELECT MotorId, AssetCode, Description, Brand, Model, SerialNumber,
           Area, Location, AssociatedEquipment, PowerKW, PowerHP,
           RatedVoltage, RatedCurrent, FrequencyHz, RPM, Frame,
           ProtectionClass, InsulationClass, ServiceFactor,
           InstallationDate, CommissioningDate, Criticality, Status,
           Notes, NameplateImagePath, CreatedAt
    FROM dbo.Motors
"""


@app.get("/salud")
def comprobar_salud():
    try:
        with closing(obtener_conexion()) as conexion:
            conexion.cursor().execute("SELECT 1").fetchone()
    except (pyodbc.Error, RuntimeError):
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="No se pudo conectar con la base de datos",
        )
    return {"estado": "ok"}


@app.post("/auth/login", response_model=LoginResponse)
def login(datos: LoginRequest):
    nombre = datos.nombre.strip()

    try:
        with closing(obtener_conexion()) as conexion:
            usuario = conexion.cursor().execute(
                """
                SELECT Id, Nombre, Correo, PasswordHash, Rol, Activo
                FROM dbo.Usuarios
                WHERE LOWER(Nombre) = LOWER(?)
                """,
                nombre,
            ).fetchone()
    except (pyodbc.Error, RuntimeError):
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="No se pudo consultar la base de datos",
        )

    # Se usa el mismo mensaje para no revelar si el usuario existe.
    credenciales_invalidas = HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Nombre de usuario o contrasena incorrectos",
        headers={"WWW-Authenticate": "Bearer"},
    )

    if usuario is None:
        raise credenciales_invalidas

    if not bool(usuario.Activo):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="El usuario esta inactivo",
        )

    try:
        password_valido = bcrypt.checkpw(
            datos.password.encode("utf-8"),
            usuario.PasswordHash.encode("utf-8"),
        )
    except (TypeError, ValueError):
        password_valido = False

    if not password_valido:
        raise credenciales_invalidas

    token = crear_token(usuario.Id, usuario.Rol)
    return LoginResponse(
        access_token=token,
        usuario=UsuarioResponse(
            id=usuario.Id,
            nombre=usuario.Nombre,
            correo=usuario.Correo,
            rol=usuario.Rol,
        ),
    )


@app.post("/auth/registro", response_model=UsuarioResponse, status_code=status.HTTP_201_CREATED)
def registrar_usuario(datos: RegistroRequest):
    nombre = datos.nombre.strip()
    correo = str(datos.correo).strip().lower()

    if not nombre:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="El nombre de usuario es obligatorio",
        )

    password_hash = bcrypt.hashpw(
        datos.password.encode("utf-8"), bcrypt.gensalt()
    ).decode("utf-8")

    try:
        with closing(obtener_conexion()) as conexion:
            cursor = conexion.cursor()
            existente = cursor.execute(
                """
                SELECT Id
                FROM dbo.Usuarios
                WHERE LOWER(Nombre) = LOWER(?) OR LOWER(Correo) = LOWER(?)
                """,
                nombre,
                correo,
            ).fetchone()

            if existente is not None:
                raise HTTPException(
                    status_code=status.HTTP_409_CONFLICT,
                    detail="El nombre de usuario o correo ya esta registrado",
                )

            usuario = cursor.execute(
                """
                INSERT INTO dbo.Usuarios
                    (Nombre, Correo, PasswordHash, Rol, Activo, CreadoEn)
                OUTPUT INSERTED.Id, INSERTED.Nombre, INSERTED.Correo, INSERTED.Rol
                VALUES (?, ?, ?, 'USUARIO', 1, SYSUTCDATETIME())
                """,
                nombre,
                correo,
                password_hash,
            ).fetchone()
            conexion.commit()
    except HTTPException:
        raise
    except (pyodbc.Error, RuntimeError):
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="No se pudo registrar el usuario en la base de datos",
        )

    return UsuarioResponse(
        id=usuario.Id,
        nombre=usuario.Nombre,
        correo=usuario.Correo,
        rol=usuario.Rol,
    )


@app.get("/usuarios", response_model=list[UsuarioAdministracionResponse])
def listar_usuarios(usuario_id: int = Depends(obtener_admin_actual)):
    try:
        with closing(obtener_conexion()) as conexion:
            usuarios = conexion.cursor().execute(
                """
                SELECT Id, Nombre, Correo, Rol, Activo, CreadoEn
                FROM dbo.Usuarios
                ORDER BY CreadoEn DESC, Id DESC
                """
            ).fetchall()
    except (pyodbc.Error, RuntimeError):
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="No se pudo consultar la lista de usuarios",
        )

    return [
        UsuarioAdministracionResponse(
            id=usuario.Id,
            nombre=usuario.Nombre,
            correo=usuario.Correo,
            rol=usuario.Rol,
            activo=bool(usuario.Activo),
            creado_en=usuario.CreadoEn,
        )
        for usuario in usuarios
    ]


@app.patch("/usuarios/{usuario_id}/rol", response_model=UsuarioResponse)
def cambiar_rol(
    usuario_id: int,
    datos: CambioRolRequest,
    usuario_actual_id: int = Depends(obtener_admin_actual),
):
    try:
        with closing(obtener_conexion()) as conexion:
            usuario = conexion.cursor().execute(
                """
                UPDATE dbo.Usuarios
                SET Rol = ?
                OUTPUT INSERTED.Id, INSERTED.Nombre, INSERTED.Correo, INSERTED.Rol
                WHERE Id = ?
                """,
                datos.rol,
                usuario_id,
            ).fetchone()
            if usuario is None:
                raise HTTPException(
                    status_code=status.HTTP_404_NOT_FOUND,
                    detail="Usuario no encontrado",
                )
            conexion.commit()
    except HTTPException:
        raise
    except (pyodbc.Error, RuntimeError):
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="No se pudo actualizar el rol",
        )

    return UsuarioResponse(
        id=usuario.Id,
        nombre=usuario.Nombre,
        correo=usuario.Correo,
        rol=usuario.Rol,
    )


@app.get("/motores", response_model=list[MotorResponse])
def listar_motores(usuario_id: int = Depends(obtener_usuario_activo)):
    try:
        with closing(obtener_conexion()) as conexion:
            motores = conexion.cursor().execute(
                MOTOR_SELECT + " ORDER BY AssetCode"
            ).fetchall()
    except (pyodbc.Error, RuntimeError):
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="No se pudo consultar la lista de motores",
        )
    return [convertir_motor(motor) for motor in motores]


@app.get("/motores/{motor_id}", response_model=MotorResponse)
def obtener_motor(motor_id: int, usuario_id: int = Depends(obtener_usuario_activo)):
    try:
        with closing(obtener_conexion()) as conexion:
            motor = conexion.cursor().execute(
                MOTOR_SELECT + " WHERE MotorId = ?",
                motor_id,
            ).fetchone()
    except (pyodbc.Error, RuntimeError):
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="No se pudo consultar el motor",
        )
    if motor is None:
        raise HTTPException(status_code=404, detail="Motor no encontrado")
    return convertir_motor(motor)


@app.post("/motores", response_model=MotorResponse, status_code=status.HTTP_201_CREATED)
def crear_motor(datos: MotorWrite, usuario_id: int = Depends(obtener_usuario_activo)):
    valores = datos.model_dump(exclude={"nameplate_image_data"})
    valores["asset_code"] = valores["asset_code"].strip()
    valores["description"] = valores["description"].strip()
    try:
        with closing(obtener_conexion()) as conexion:
            cursor = conexion.cursor()
            if cursor.execute(
                "SELECT MotorId FROM dbo.Motors WHERE AssetCode = ?",
                valores["asset_code"],
            ).fetchone():
                raise HTTPException(status_code=409, detail="El codigo del activo ya existe")
            imagen_ruta = guardar_imagen_placa(
                valores["asset_code"], datos.nameplate_image_data
            )
            motor_id = cursor.execute(
                """
                SET NOCOUNT ON;
                INSERT INTO dbo.Motors (
                    AssetCode, Description, Brand, Model, SerialNumber, Area,
                    Location, AssociatedEquipment, PowerKW, PowerHP, RatedVoltage,
                    RatedCurrent, FrequencyHz, RPM, Frame, ProtectionClass,
                    InsulationClass, ServiceFactor, InstallationDate,
                    CommissioningDate, Criticality, Status, Notes, NameplateImagePath
                ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?);
                SELECT CAST(SCOPE_IDENTITY() AS int)
                """,
                *valores.values(), imagen_ruta,
            ).fetchone()[0]
            motor = cursor.execute(MOTOR_SELECT + " WHERE MotorId = ?", motor_id).fetchone()
            conexion.commit()
    except HTTPException:
        raise
    except (pyodbc.Error, RuntimeError):
        raise HTTPException(status_code=503, detail="No se pudo crear el motor")
    return convertir_motor(motor)


@app.put("/motores/{motor_id}", response_model=MotorResponse)
def actualizar_motor(
    motor_id: int,
    datos: MotorWrite,
    usuario_id: int = Depends(obtener_admin_actual),
):
    valores = datos.model_dump(exclude={"nameplate_image_data"})
    valores["asset_code"] = valores["asset_code"].strip()
    valores["description"] = valores["description"].strip()
    try:
        with closing(obtener_conexion()) as conexion:
            cursor = conexion.cursor()
            duplicado = cursor.execute(
                "SELECT MotorId FROM dbo.Motors WHERE AssetCode = ? AND MotorId <> ?",
                valores["asset_code"], motor_id,
            ).fetchone()
            if duplicado:
                raise HTTPException(status_code=409, detail="El codigo del activo ya existe")
            actual = cursor.execute(
                "SELECT NameplateImagePath FROM dbo.Motors WHERE MotorId = ?", motor_id
            ).fetchone()
            if actual is None:
                raise HTTPException(status_code=404, detail="Motor no encontrado")
            imagen_ruta = (
                guardar_imagen_placa(valores["asset_code"], datos.nameplate_image_data)
                if datos.nameplate_image_data
                else actual.NameplateImagePath
            )
            cursor.execute(
                """
                UPDATE dbo.Motors SET
                    AssetCode=?, Description=?, Brand=?, Model=?, SerialNumber=?,
                    Area=?, Location=?, AssociatedEquipment=?, PowerKW=?, PowerHP=?,
                    RatedVoltage=?, RatedCurrent=?, FrequencyHz=?, RPM=?, Frame=?,
                    ProtectionClass=?, InsulationClass=?, ServiceFactor=?,
                    InstallationDate=?, CommissioningDate=?, Criticality=?, Status=?, Notes=?
                    , NameplateImagePath=?
                WHERE MotorId=?
                """,
                *valores.values(), imagen_ruta, motor_id,
            )
            if cursor.rowcount == 0:
                raise HTTPException(status_code=404, detail="Motor no encontrado")
            motor = cursor.execute(MOTOR_SELECT + " WHERE MotorId = ?", motor_id).fetchone()
            conexion.commit()
    except HTTPException:
        raise
    except (pyodbc.Error, RuntimeError):
        raise HTTPException(status_code=503, detail="No se pudo actualizar el motor")
    return convertir_motor(motor)


@app.delete("/motores/{motor_id}", status_code=status.HTTP_204_NO_CONTENT)
def eliminar_motor(motor_id: int, usuario_id: int = Depends(obtener_admin_actual)):
    try:
        with closing(obtener_conexion()) as conexion:
            cursor = conexion.cursor()
            cursor.execute("DELETE FROM dbo.Motors WHERE MotorId = ?", motor_id)
            if cursor.rowcount == 0:
                raise HTTPException(status_code=404, detail="Motor no encontrado")
            conexion.commit()
    except HTTPException:
        raise
    except (pyodbc.Error, RuntimeError):
        raise HTTPException(status_code=503, detail="No se pudo eliminar el motor")


@app.get("/motores/{motor_id}/placa", response_class=FileResponse)
def ver_imagen_placa(
    motor_id: int,
    usuario_id: int = Depends(obtener_usuario_activo),
):
    try:
        with closing(obtener_conexion()) as conexion:
            motor = conexion.cursor().execute(
                "SELECT NameplateImagePath FROM dbo.Motors WHERE MotorId = ?",
                motor_id,
            ).fetchone()
    except (pyodbc.Error, RuntimeError):
        raise HTTPException(status_code=503, detail="No se pudo consultar la placa")
    if motor is None or not motor.NameplateImagePath:
        raise HTTPException(status_code=404, detail="El motor no tiene imagen de placa")
    ruta = Path(motor.NameplateImagePath)
    if not ruta.is_file():
        raise HTTPException(status_code=404, detail="No se encontro el archivo de la placa")
    return FileResponse(ruta)


if __name__ == "__main__":
    import uvicorn

    uvicorn.run("main:app", host="0.0.0.0", port=8000, reload=True)
