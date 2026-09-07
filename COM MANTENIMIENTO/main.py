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
from pydantic import BaseModel, EmailStr, Field, model_validator

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


class SparePartBase(BaseModel):
    internal_code: str = Field(min_length=1, max_length=50)
    category_id: int
    description: str = Field(min_length=1, max_length=255)
    brand: str | None = Field(default=None, max_length=100)
    model: str | None = Field(default=None, max_length=100)
    part_number: str | None = Field(default=None, max_length=100)
    unit_of_measure: str = Field(min_length=1, max_length=20)
    minimum_stock: Decimal = Field(ge=0)
    maximum_stock: Decimal | None = Field(default=None, ge=0)
    unit_cost: Decimal | None = Field(default=None, ge=0)
    storage_location: str | None = Field(default=None, max_length=150)
    active: bool = True
    notes: str | None = None

    @model_validator(mode="after")
    def validar_existencias(self):
        if self.maximum_stock is not None and self.maximum_stock < self.minimum_stock:
            raise ValueError("El stock maximo no puede ser menor que el stock minimo")
        return self


class SparePartResponse(SparePartBase):
    spare_part_id: int
    image_path: str | None = None
    created_at: datetime


class SparePartWrite(SparePartBase):
    image_data: str | None = Field(default=None, max_length=14_000_000)


class SparePartCategoryResponse(BaseModel):
    category_id: int
    name: str
    description: str | None = None


class SparePartCategoryWrite(BaseModel):
    name: str = Field(min_length=1, max_length=100)
    description: str | None = Field(default=None, max_length=255)


class SupplierBase(BaseModel):
    supplier_code: str | None = Field(default=None, max_length=50)
    name: str = Field(min_length=1, max_length=200)
    ruc: str | None = Field(default=None, max_length=20)
    contact_name: str | None = Field(default=None, max_length=150)
    phone: str | None = Field(default=None, max_length=50)
    email: EmailStr | None = None
    address: str | None = Field(default=None, max_length=300)
    active: bool = True
    notes: str | None = Field(default=None, max_length=500)


class SupplierResponse(SupplierBase):
    supplier_id: int
    created_at: datetime


class SparePartSupplierWrite(BaseModel):
    supplier_id: int
    supplier_part_number: str | None = Field(default=None, max_length=100)
    current_price: Decimal | None = Field(default=None, ge=0)
    lead_time_days: int | None = Field(default=None, ge=0)
    preferred_supplier: bool = False
    notes: str | None = Field(default=None, max_length=500)


class SparePartSupplierResponse(SparePartSupplierWrite):
    spare_part_supplier_id: int
    spare_part_id: int
    supplier_name: str
    supplier_code: str | None = None


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


def convertir_repuesto(repuesto) -> SparePartResponse:
    return SparePartResponse(
        spare_part_id=repuesto.SparePartId,
        internal_code=repuesto.InternalCode,
        category_id=repuesto.CategoryId,
        description=repuesto.Description,
        brand=repuesto.Brand,
        model=repuesto.Model,
        part_number=repuesto.PartNumber,
        unit_of_measure=repuesto.UnitOfMeasure,
        minimum_stock=repuesto.MinimumStock,
        maximum_stock=repuesto.MaximumStock,
        unit_cost=repuesto.UnitCost,
        storage_location=repuesto.StorageLocation,
        active=bool(repuesto.Active),
        notes=repuesto.Notes,
        image_path=repuesto.ImagePath,
        created_at=repuesto.CreatedAt,
    )


def convertir_proveedor(proveedor) -> SupplierResponse:
    return SupplierResponse(
        supplier_id=proveedor.SupplierId,
        supplier_code=proveedor.SupplierCode,
        name=proveedor.Name,
        ruc=proveedor.RUC,
        contact_name=proveedor.ContactName,
        phone=proveedor.Phone,
        email=proveedor.Email,
        address=proveedor.Address,
        active=bool(proveedor.Active),
        notes=proveedor.Notes,
        created_at=proveedor.CreatedAt,
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


def guardar_imagen_repuesto(internal_code: str, image_data: str | None) -> str | None:
    if not image_data:
        return None
    coincidencia = re.fullmatch(
        r"data:image/(jpeg|png|webp);base64,([A-Za-z0-9+/=\r\n]+)", image_data
    )
    if not coincidencia:
        raise HTTPException(status_code=422, detail="La imagen debe ser JPG, PNG o WEBP")
    extension = {"jpeg": ".jpg", "png": ".png", "webp": ".webp"}[coincidencia.group(1)]
    try:
        contenido = base64.b64decode(coincidencia.group(2), validate=True)
    except (binascii.Error, ValueError):
        raise HTTPException(status_code=422, detail="La imagen del repuesto no es valida")
    if len(contenido) > 10 * 1024 * 1024:
        raise HTTPException(status_code=413, detail="La imagen no puede superar 10 MB")

    nombre_seguro = re.sub(r"[^A-Za-z0-9._-]", "_", internal_code.strip())
    carpeta = Path(os.getenv("SPARE_PART_IMAGE_DIR", r"D:\MANTENIMIENTO\IMAGES\REPUESTOS"))
    try:
        carpeta.mkdir(parents=True, exist_ok=True)
        ruta = carpeta / f"{nombre_seguro}{extension}"
        ruta.write_bytes(contenido)
    except OSError:
        raise HTTPException(status_code=503, detail="No se pudo guardar la imagen del repuesto")
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


SPARE_PART_SELECT = """
    SELECT SparePartId, InternalCode, CategoryId, Description, Brand, Model,
           PartNumber, UnitOfMeasure, MinimumStock, MaximumStock, UnitCost,
           StorageLocation, ImagePath, Active, Notes, CreatedAt
    FROM dbo.SpareParts
"""


SUPPLIER_SELECT = """
    SELECT SupplierId, SupplierCode, Name, RUC, ContactName, Phone, Email,
           Address, Active, Notes, CreatedAt
    FROM dbo.Suppliers
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


@app.get("/repuestos", response_model=list[SparePartResponse])
def listar_repuestos(usuario_id: int = Depends(obtener_usuario_activo)):
    try:
        with closing(obtener_conexion()) as conexion:
            repuestos = conexion.cursor().execute(
                SPARE_PART_SELECT + " ORDER BY InternalCode"
            ).fetchall()
    except (pyodbc.Error, RuntimeError):
        raise HTTPException(status_code=503, detail="No se pudo consultar la lista de repuestos")
    return [convertir_repuesto(repuesto) for repuesto in repuestos]


@app.get("/categorias-repuestos", response_model=list[SparePartCategoryResponse])
def listar_categorias_repuestos(usuario_id: int = Depends(obtener_usuario_activo)):
    try:
        with closing(obtener_conexion()) as conexion:
            categorias = conexion.cursor().execute(
                """
                SELECT CategoryId, Name, Description
                FROM dbo.SparePartCategories
                ORDER BY Name
                """
            ).fetchall()
    except (pyodbc.Error, RuntimeError):
        raise HTTPException(status_code=503, detail="No se pudo consultar la lista de categorias")
    return [
        SparePartCategoryResponse(
            category_id=categoria.CategoryId,
            name=categoria.Name,
            description=categoria.Description,
        )
        for categoria in categorias
    ]


@app.post(
    "/categorias-repuestos",
    response_model=SparePartCategoryResponse,
    status_code=status.HTTP_201_CREATED,
)
def crear_categoria_repuesto(
    datos: SparePartCategoryWrite,
    usuario_id: int = Depends(obtener_admin_actual),
):
    nombre = datos.name.strip()
    descripcion = datos.description.strip() if datos.description else None
    try:
        with closing(obtener_conexion()) as conexion:
            cursor = conexion.cursor()
            if cursor.execute(
                "SELECT CategoryId FROM dbo.SparePartCategories WHERE LOWER(Name) = LOWER(?)",
                nombre,
            ).fetchone():
                raise HTTPException(status_code=409, detail="Ya existe una categoria con ese nombre")
            categoria = cursor.execute(
                """
                INSERT INTO dbo.SparePartCategories (Name, Description)
                OUTPUT INSERTED.CategoryId, INSERTED.Name, INSERTED.Description
                VALUES (?, ?)
                """,
                nombre,
                descripcion,
            ).fetchone()
            conexion.commit()
    except HTTPException:
        raise
    except (pyodbc.Error, RuntimeError):
        raise HTTPException(status_code=503, detail="No se pudo crear la categoria")
    return SparePartCategoryResponse(
        category_id=categoria.CategoryId,
        name=categoria.Name,
        description=categoria.Description,
    )


@app.put("/categorias-repuestos/{category_id}", response_model=SparePartCategoryResponse)
def actualizar_categoria_repuesto(
    category_id: int,
    datos: SparePartCategoryWrite,
    usuario_id: int = Depends(obtener_admin_actual),
):
    nombre = datos.name.strip()
    descripcion = datos.description.strip() if datos.description else None
    try:
        with closing(obtener_conexion()) as conexion:
            cursor = conexion.cursor()
            if cursor.execute(
                """
                SELECT CategoryId FROM dbo.SparePartCategories
                WHERE LOWER(Name) = LOWER(?) AND CategoryId <> ?
                """,
                nombre,
                category_id,
            ).fetchone():
                raise HTTPException(status_code=409, detail="Ya existe una categoria con ese nombre")
            categoria = cursor.execute(
                """
                UPDATE dbo.SparePartCategories SET Name=?, Description=?
                OUTPUT INSERTED.CategoryId, INSERTED.Name, INSERTED.Description
                WHERE CategoryId=?
                """,
                nombre,
                descripcion,
                category_id,
            ).fetchone()
            if categoria is None:
                raise HTTPException(status_code=404, detail="Categoria no encontrada")
            conexion.commit()
    except HTTPException:
        raise
    except (pyodbc.Error, RuntimeError):
        raise HTTPException(status_code=503, detail="No se pudo actualizar la categoria")
    return SparePartCategoryResponse(
        category_id=categoria.CategoryId,
        name=categoria.Name,
        description=categoria.Description,
    )


@app.delete("/categorias-repuestos/{category_id}", status_code=status.HTTP_204_NO_CONTENT)
def eliminar_categoria_repuesto(
    category_id: int,
    usuario_id: int = Depends(obtener_admin_actual),
):
    try:
        with closing(obtener_conexion()) as conexion:
            cursor = conexion.cursor()
            cantidad = cursor.execute(
                "SELECT COUNT(*) FROM dbo.SpareParts WHERE CategoryId = ?", category_id
            ).fetchone()[0]
            if cantidad:
                raise HTTPException(
                    status_code=409,
                    detail=(
                        f"No se puede eliminar: la categoria tiene {cantidad} "
                        "repuesto(s) asociado(s). Reasignalos primero."
                    ),
                )
            cursor.execute(
                "DELETE FROM dbo.SparePartCategories WHERE CategoryId = ?", category_id
            )
            if cursor.rowcount == 0:
                raise HTTPException(status_code=404, detail="Categoria no encontrada")
            conexion.commit()
    except HTTPException:
        raise
    except (pyodbc.Error, RuntimeError):
        raise HTTPException(status_code=503, detail="No se pudo eliminar la categoria")


@app.get("/repuestos/{spare_part_id}", response_model=SparePartResponse)
def obtener_repuesto(spare_part_id: int, usuario_id: int = Depends(obtener_usuario_activo)):
    try:
        with closing(obtener_conexion()) as conexion:
            repuesto = conexion.cursor().execute(
                SPARE_PART_SELECT + " WHERE SparePartId = ?", spare_part_id
            ).fetchone()
    except (pyodbc.Error, RuntimeError):
        raise HTTPException(status_code=503, detail="No se pudo consultar el repuesto")
    if repuesto is None:
        raise HTTPException(status_code=404, detail="Repuesto no encontrado")
    return convertir_repuesto(repuesto)


@app.post("/repuestos", response_model=SparePartResponse, status_code=status.HTTP_201_CREATED)
def crear_repuesto(datos: SparePartWrite, usuario_id: int = Depends(obtener_usuario_activo)):
    valores = datos.model_dump(exclude={"image_data"})
    valores["internal_code"] = valores["internal_code"].strip()
    valores["description"] = valores["description"].strip()
    valores["unit_of_measure"] = valores["unit_of_measure"].strip()
    try:
        with closing(obtener_conexion()) as conexion:
            cursor = conexion.cursor()
            if cursor.execute(
                "SELECT SparePartId FROM dbo.SpareParts WHERE InternalCode = ?",
                valores["internal_code"],
            ).fetchone():
                raise HTTPException(status_code=409, detail="El codigo interno ya existe")
            imagen_ruta = guardar_imagen_repuesto(valores["internal_code"], datos.image_data)
            repuesto_id = cursor.execute(
                """
                SET NOCOUNT ON;
                INSERT INTO dbo.SpareParts (
                    InternalCode, CategoryId, Description, Brand, Model, PartNumber,
                    UnitOfMeasure, MinimumStock, MaximumStock, UnitCost,
                    StorageLocation, Active, Notes, ImagePath
                ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?);
                SELECT CAST(SCOPE_IDENTITY() AS int)
                """,
                valores["internal_code"], valores["category_id"], valores["description"],
                valores["brand"], valores["model"], valores["part_number"],
                valores["unit_of_measure"], valores["minimum_stock"],
                valores["maximum_stock"], valores["unit_cost"],
                valores["storage_location"], valores["active"], valores["notes"],
                imagen_ruta,
            ).fetchone()[0]
            repuesto = cursor.execute(
                SPARE_PART_SELECT + " WHERE SparePartId = ?", repuesto_id
            ).fetchone()
            conexion.commit()
    except HTTPException:
        raise
    except (pyodbc.Error, RuntimeError):
        raise HTTPException(status_code=503, detail="No se pudo crear el repuesto")
    return convertir_repuesto(repuesto)


@app.put("/repuestos/{spare_part_id}", response_model=SparePartResponse)
def actualizar_repuesto(
    spare_part_id: int,
    datos: SparePartWrite,
    usuario_id: int = Depends(obtener_admin_actual),
):
    valores = datos.model_dump(exclude={"image_data"})
    valores["internal_code"] = valores["internal_code"].strip()
    valores["description"] = valores["description"].strip()
    valores["unit_of_measure"] = valores["unit_of_measure"].strip()
    try:
        with closing(obtener_conexion()) as conexion:
            cursor = conexion.cursor()
            if cursor.execute(
                "SELECT SparePartId FROM dbo.SpareParts WHERE InternalCode = ? AND SparePartId <> ?",
                valores["internal_code"], spare_part_id,
            ).fetchone():
                raise HTTPException(status_code=409, detail="El codigo interno ya existe")
            actual = cursor.execute(
                "SELECT ImagePath FROM dbo.SpareParts WHERE SparePartId = ?", spare_part_id
            ).fetchone()
            if actual is None:
                raise HTTPException(status_code=404, detail="Repuesto no encontrado")
            imagen_ruta = (
                guardar_imagen_repuesto(valores["internal_code"], datos.image_data)
                if datos.image_data else actual.ImagePath
            )
            cursor.execute(
                """
                UPDATE dbo.SpareParts SET InternalCode=?, CategoryId=?, Description=?,
                    Brand=?, Model=?, PartNumber=?, UnitOfMeasure=?, MinimumStock=?,
                    MaximumStock=?, UnitCost=?, StorageLocation=?, Active=?, Notes=?, ImagePath=?
                WHERE SparePartId=?
                """,
                valores["internal_code"], valores["category_id"], valores["description"],
                valores["brand"], valores["model"], valores["part_number"],
                valores["unit_of_measure"], valores["minimum_stock"],
                valores["maximum_stock"], valores["unit_cost"],
                valores["storage_location"], valores["active"], valores["notes"],
                imagen_ruta, spare_part_id,
            )
            repuesto = cursor.execute(
                SPARE_PART_SELECT + " WHERE SparePartId = ?", spare_part_id
            ).fetchone()
            conexion.commit()
    except HTTPException:
        raise
    except (pyodbc.Error, RuntimeError):
        raise HTTPException(status_code=503, detail="No se pudo actualizar el repuesto")
    return convertir_repuesto(repuesto)


@app.delete("/repuestos/{spare_part_id}", status_code=status.HTTP_204_NO_CONTENT)
def eliminar_repuesto(spare_part_id: int, usuario_id: int = Depends(obtener_admin_actual)):
    try:
        with closing(obtener_conexion()) as conexion:
            cursor = conexion.cursor()
            cursor.execute("DELETE FROM dbo.SpareParts WHERE SparePartId = ?", spare_part_id)
            if cursor.rowcount == 0:
                raise HTTPException(status_code=404, detail="Repuesto no encontrado")
            conexion.commit()
    except HTTPException:
        raise
    except (pyodbc.Error, RuntimeError):
        raise HTTPException(status_code=503, detail="No se pudo eliminar el repuesto")


@app.get("/repuestos/{spare_part_id}/imagen", response_class=FileResponse)
def ver_imagen_repuesto(
    spare_part_id: int,
    usuario_id: int = Depends(obtener_usuario_activo),
):
    try:
        with closing(obtener_conexion()) as conexion:
            repuesto = conexion.cursor().execute(
                "SELECT ImagePath FROM dbo.SpareParts WHERE SparePartId = ?", spare_part_id
            ).fetchone()
    except (pyodbc.Error, RuntimeError):
        raise HTTPException(status_code=503, detail="No se pudo consultar la imagen")
    if repuesto is None or not repuesto.ImagePath:
        raise HTTPException(status_code=404, detail="El repuesto no tiene imagen")
    ruta = Path(repuesto.ImagePath)
    if not ruta.is_file():
        raise HTTPException(status_code=404, detail="No se encontro el archivo de la imagen")
    return FileResponse(ruta)


@app.get("/proveedores", response_model=list[SupplierResponse])
def listar_proveedores(usuario_id: int = Depends(obtener_usuario_activo)):
    try:
        with closing(obtener_conexion()) as conexion:
            proveedores = conexion.cursor().execute(
                SUPPLIER_SELECT + " ORDER BY Name"
            ).fetchall()
    except (pyodbc.Error, RuntimeError):
        raise HTTPException(status_code=503, detail="No se pudo consultar la lista de proveedores")
    return [convertir_proveedor(proveedor) for proveedor in proveedores]


@app.get("/proveedores/{supplier_id}", response_model=SupplierResponse)
def obtener_proveedor(supplier_id: int, usuario_id: int = Depends(obtener_usuario_activo)):
    try:
        with closing(obtener_conexion()) as conexion:
            proveedor = conexion.cursor().execute(
                SUPPLIER_SELECT + " WHERE SupplierId = ?", supplier_id
            ).fetchone()
    except (pyodbc.Error, RuntimeError):
        raise HTTPException(status_code=503, detail="No se pudo consultar el proveedor")
    if proveedor is None:
        raise HTTPException(status_code=404, detail="Proveedor no encontrado")
    return convertir_proveedor(proveedor)


def validar_proveedor_duplicado(cursor, datos: SupplierBase, supplier_id: int | None = None):
    condiciones = []
    parametros = []
    if datos.supplier_code:
        condiciones.append("LOWER(SupplierCode) = LOWER(?)")
        parametros.append(datos.supplier_code.strip())
    if datos.ruc:
        condiciones.append("RUC = ?")
        parametros.append(datos.ruc.strip())
    if not condiciones:
        return
    consulta = "SELECT SupplierId FROM dbo.Suppliers WHERE (" + " OR ".join(condiciones) + ")"
    if supplier_id is not None:
        consulta += " AND SupplierId <> ?"
        parametros.append(supplier_id)
    if cursor.execute(consulta, *parametros).fetchone():
        raise HTTPException(status_code=409, detail="El codigo o RUC del proveedor ya existe")


@app.post("/proveedores", response_model=SupplierResponse, status_code=status.HTTP_201_CREATED)
def crear_proveedor(datos: SupplierBase, usuario_id: int = Depends(obtener_usuario_activo)):
    valores = datos.model_dump()
    valores["name"] = valores["name"].strip()
    for campo in ("supplier_code", "ruc", "contact_name", "phone", "address", "notes"):
        valores[campo] = valores[campo].strip() if valores[campo] else None
    valores["email"] = str(valores["email"]) if valores["email"] else None
    try:
        with closing(obtener_conexion()) as conexion:
            cursor = conexion.cursor()
            validar_proveedor_duplicado(cursor, datos)
            supplier_id = cursor.execute(
                """
                SET NOCOUNT ON;
                INSERT INTO dbo.Suppliers (
                    SupplierCode, Name, RUC, ContactName, Phone, Email,
                    Address, Active, Notes
                ) VALUES (?,?,?,?,?,?,?,?,?);
                SELECT CAST(SCOPE_IDENTITY() AS int)
                """,
                valores["supplier_code"], valores["name"], valores["ruc"],
                valores["contact_name"], valores["phone"], valores["email"],
                valores["address"], valores["active"], valores["notes"],
            ).fetchone()[0]
            proveedor = cursor.execute(
                SUPPLIER_SELECT + " WHERE SupplierId = ?", supplier_id
            ).fetchone()
            conexion.commit()
    except HTTPException:
        raise
    except (pyodbc.Error, RuntimeError):
        raise HTTPException(status_code=503, detail="No se pudo crear el proveedor")
    return convertir_proveedor(proveedor)


@app.put("/proveedores/{supplier_id}", response_model=SupplierResponse)
def actualizar_proveedor(
    supplier_id: int,
    datos: SupplierBase,
    usuario_id: int = Depends(obtener_admin_actual),
):
    valores = datos.model_dump()
    valores["name"] = valores["name"].strip()
    for campo in ("supplier_code", "ruc", "contact_name", "phone", "address", "notes"):
        valores[campo] = valores[campo].strip() if valores[campo] else None
    valores["email"] = str(valores["email"]) if valores["email"] else None
    try:
        with closing(obtener_conexion()) as conexion:
            cursor = conexion.cursor()
            validar_proveedor_duplicado(cursor, datos, supplier_id)
            cursor.execute(
                """
                UPDATE dbo.Suppliers SET SupplierCode=?, Name=?, RUC=?, ContactName=?,
                    Phone=?, Email=?, Address=?, Active=?, Notes=?
                WHERE SupplierId=?
                """,
                valores["supplier_code"], valores["name"], valores["ruc"],
                valores["contact_name"], valores["phone"], valores["email"],
                valores["address"], valores["active"], valores["notes"], supplier_id,
            )
            if cursor.rowcount == 0:
                raise HTTPException(status_code=404, detail="Proveedor no encontrado")
            proveedor = cursor.execute(
                SUPPLIER_SELECT + " WHERE SupplierId = ?", supplier_id
            ).fetchone()
            conexion.commit()
    except HTTPException:
        raise
    except (pyodbc.Error, RuntimeError):
        raise HTTPException(status_code=503, detail="No se pudo actualizar el proveedor")
    return convertir_proveedor(proveedor)


@app.delete("/proveedores/{supplier_id}", status_code=status.HTTP_204_NO_CONTENT)
def eliminar_proveedor(supplier_id: int, usuario_id: int = Depends(obtener_admin_actual)):
    try:
        with closing(obtener_conexion()) as conexion:
            cursor = conexion.cursor()
            cursor.execute("DELETE FROM dbo.Suppliers WHERE SupplierId = ?", supplier_id)
            if cursor.rowcount == 0:
                raise HTTPException(status_code=404, detail="Proveedor no encontrado")
            conexion.commit()
    except HTTPException:
        raise
    except pyodbc.IntegrityError:
        raise HTTPException(
            status_code=409,
            detail="No se puede eliminar el proveedor porque tiene registros asociados",
        )
    except (pyodbc.Error, RuntimeError):
        raise HTTPException(status_code=503, detail="No se pudo eliminar el proveedor")


@app.get(
    "/repuestos/{spare_part_id}/proveedores",
    response_model=list[SparePartSupplierResponse],
)
def listar_proveedores_repuesto(
    spare_part_id: int,
    usuario_id: int = Depends(obtener_usuario_activo),
):
    try:
        with closing(obtener_conexion()) as conexion:
            relaciones = conexion.cursor().execute(
                """
                SELECT sps.SparePartSupplierId, sps.SparePartId, sps.SupplierId,
                       sps.SupplierPartNumber, sps.CurrentPrice, sps.LeadTimeDays,
                       sps.PreferredSupplier, sps.Notes, s.Name AS SupplierName,
                       s.SupplierCode
                FROM dbo.SparePartSuppliers sps
                INNER JOIN dbo.Suppliers s ON s.SupplierId = sps.SupplierId
                WHERE sps.SparePartId = ?
                ORDER BY sps.PreferredSupplier DESC, s.Name
                """,
                spare_part_id,
            ).fetchall()
    except (pyodbc.Error, RuntimeError):
        raise HTTPException(status_code=503, detail="No se pudieron consultar los proveedores del repuesto")
    return [
        SparePartSupplierResponse(
            spare_part_supplier_id=item.SparePartSupplierId,
            spare_part_id=item.SparePartId,
            supplier_id=item.SupplierId,
            supplier_part_number=item.SupplierPartNumber,
            current_price=item.CurrentPrice,
            lead_time_days=item.LeadTimeDays,
            preferred_supplier=bool(item.PreferredSupplier),
            notes=item.Notes,
            supplier_name=item.SupplierName,
            supplier_code=item.SupplierCode,
        ) for item in relaciones
    ]


@app.post(
    "/repuestos/{spare_part_id}/proveedores",
    response_model=SparePartSupplierResponse,
    status_code=status.HTTP_201_CREATED,
)
def agregar_proveedor_repuesto(
    spare_part_id: int,
    datos: SparePartSupplierWrite,
    usuario_id: int = Depends(obtener_admin_actual),
):
    try:
        with closing(obtener_conexion()) as conexion:
            cursor = conexion.cursor()
            if cursor.execute(
                "SELECT SparePartSupplierId FROM dbo.SparePartSuppliers WHERE SparePartId=? AND SupplierId=?",
                spare_part_id, datos.supplier_id,
            ).fetchone():
                raise HTTPException(status_code=409, detail="Este proveedor ya esta asociado al repuesto")
            if datos.preferred_supplier:
                cursor.execute(
                    "UPDATE dbo.SparePartSuppliers SET PreferredSupplier=0 WHERE SparePartId=?",
                    spare_part_id,
                )
            relation_id = cursor.execute(
                """
                SET NOCOUNT ON;
                INSERT INTO dbo.SparePartSuppliers
                    (SparePartId, SupplierId, SupplierPartNumber, CurrentPrice,
                     LeadTimeDays, PreferredSupplier, Notes)
                VALUES (?,?,?,?,?,?,?);
                SELECT CAST(SCOPE_IDENTITY() AS int)
                """,
                spare_part_id, datos.supplier_id, datos.supplier_part_number,
                datos.current_price, datos.lead_time_days,
                datos.preferred_supplier, datos.notes,
            ).fetchone()[0]
            item = cursor.execute(
                """
                SELECT sps.SparePartSupplierId, sps.SparePartId, sps.SupplierId,
                       sps.SupplierPartNumber, sps.CurrentPrice, sps.LeadTimeDays,
                       sps.PreferredSupplier, sps.Notes, s.Name AS SupplierName,
                       s.SupplierCode
                FROM dbo.SparePartSuppliers sps
                INNER JOIN dbo.Suppliers s ON s.SupplierId=sps.SupplierId
                WHERE sps.SparePartSupplierId=?
                """, relation_id,
            ).fetchone()
            conexion.commit()
    except HTTPException:
        raise
    except pyodbc.IntegrityError:
        raise HTTPException(status_code=422, detail="El repuesto o proveedor seleccionado no existe")
    except (pyodbc.Error, RuntimeError):
        raise HTTPException(status_code=503, detail="No se pudo asociar el proveedor")
    return SparePartSupplierResponse(
        spare_part_supplier_id=item.SparePartSupplierId, spare_part_id=item.SparePartId,
        supplier_id=item.SupplierId, supplier_part_number=item.SupplierPartNumber,
        current_price=item.CurrentPrice, lead_time_days=item.LeadTimeDays,
        preferred_supplier=bool(item.PreferredSupplier), notes=item.Notes,
        supplier_name=item.SupplierName, supplier_code=item.SupplierCode,
    )


@app.put(
    "/repuestos/{spare_part_id}/proveedores/{relation_id}",
    response_model=SparePartSupplierResponse,
)
def actualizar_proveedor_repuesto(
    spare_part_id: int,
    relation_id: int,
    datos: SparePartSupplierWrite,
    usuario_id: int = Depends(obtener_admin_actual),
):
    try:
        with closing(obtener_conexion()) as conexion:
            cursor = conexion.cursor()
            if cursor.execute(
                "SELECT SparePartSupplierId FROM dbo.SparePartSuppliers WHERE SparePartId=? AND SupplierId=? AND SparePartSupplierId<>?",
                spare_part_id, datos.supplier_id, relation_id,
            ).fetchone():
                raise HTTPException(status_code=409, detail="Este proveedor ya esta asociado al repuesto")
            if datos.preferred_supplier:
                cursor.execute(
                    "UPDATE dbo.SparePartSuppliers SET PreferredSupplier=0 WHERE SparePartId=?",
                    spare_part_id,
                )
            cursor.execute(
                """
                UPDATE dbo.SparePartSuppliers SET SupplierId=?, SupplierPartNumber=?,
                    CurrentPrice=?, LeadTimeDays=?, PreferredSupplier=?, Notes=?
                WHERE SparePartSupplierId=? AND SparePartId=?
                """,
                datos.supplier_id, datos.supplier_part_number, datos.current_price,
                datos.lead_time_days, datos.preferred_supplier, datos.notes,
                relation_id, spare_part_id,
            )
            if cursor.rowcount == 0:
                raise HTTPException(status_code=404, detail="Relacion no encontrada")
            item = cursor.execute(
                """
                SELECT sps.SparePartSupplierId, sps.SparePartId, sps.SupplierId,
                       sps.SupplierPartNumber, sps.CurrentPrice, sps.LeadTimeDays,
                       sps.PreferredSupplier, sps.Notes, s.Name AS SupplierName,
                       s.SupplierCode
                FROM dbo.SparePartSuppliers sps
                INNER JOIN dbo.Suppliers s ON s.SupplierId=sps.SupplierId
                WHERE sps.SparePartSupplierId=?
                """, relation_id,
            ).fetchone()
            conexion.commit()
    except HTTPException:
        raise
    except pyodbc.IntegrityError:
        raise HTTPException(status_code=422, detail="El proveedor seleccionado no existe")
    except (pyodbc.Error, RuntimeError):
        raise HTTPException(status_code=503, detail="No se pudo actualizar la relacion")
    return SparePartSupplierResponse(
        spare_part_supplier_id=item.SparePartSupplierId, spare_part_id=item.SparePartId,
        supplier_id=item.SupplierId, supplier_part_number=item.SupplierPartNumber,
        current_price=item.CurrentPrice, lead_time_days=item.LeadTimeDays,
        preferred_supplier=bool(item.PreferredSupplier), notes=item.Notes,
        supplier_name=item.SupplierName, supplier_code=item.SupplierCode,
    )


@app.delete(
    "/repuestos/{spare_part_id}/proveedores/{relation_id}",
    status_code=status.HTTP_204_NO_CONTENT,
)
def quitar_proveedor_repuesto(
    spare_part_id: int,
    relation_id: int,
    usuario_id: int = Depends(obtener_admin_actual),
):
    try:
        with closing(obtener_conexion()) as conexion:
            cursor = conexion.cursor()
            cursor.execute(
                "DELETE FROM dbo.SparePartSuppliers WHERE SparePartSupplierId=? AND SparePartId=?",
                relation_id, spare_part_id,
            )
            if cursor.rowcount == 0:
                raise HTTPException(status_code=404, detail="Relacion no encontrada")
            conexion.commit()
    except HTTPException:
        raise
    except (pyodbc.Error, RuntimeError):
        raise HTTPException(status_code=503, detail="No se pudo quitar el proveedor")


if __name__ == "__main__":
    import uvicorn

    uvicorn.run("main:app", host="0.0.0.0", port=8000, reload=True)
