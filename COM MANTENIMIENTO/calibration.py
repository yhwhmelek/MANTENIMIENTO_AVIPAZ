"""Módulo de calibración y verificación metrológica (procedimiento MT/03, versión 06).

Borrador. Requiere las migraciones 024_calibration_module.sql y 025_calibration_activities_orders.sql.

Flujo (similar a preventivos):
1. El administrador crea actividades de calibración (procedimiento, método, frecuencia y responsable sugeridos).
2. Asigna la actividad a un instrumento (plan): frecuencia, responsable (grupo, persona o contratista) y primera fecha.
3. Prepara y publica los ciclos de un período: se generan órdenes en el calendario.
4. El responsable registra la verificación desde la orden; el administrador revisa y firma.

Lectura y registro: ADMIN, MECANICO, ELECTRICO y TECNICO. Configuración, publicación, revisión y anulación: ADMIN.
"""
import calendar
from contextlib import closing
from datetime import date, datetime, time, timedelta, timezone
from decimal import Decimal
from typing import Literal

import pyodbc
from fastapi import Depends, HTTPException
from pydantic import BaseModel, Field, field_validator, model_validator

ECUADOR = timezone(timedelta(hours=-5))
STAFF_ROLES = ('ADMIN', 'MECANICO', 'ELECTRICO', 'TECNICO')
MIGRATION_HINT = 'Verifica las migraciones 024 y 025 de calibración.'

InstrumentType = Literal['BALANZA', 'SISTEMA_PESAJE', 'BASCULA_CAMIONERA', 'TEMPERATURA_HUMEDAD', 'MANOMETRO', 'CAUDALIMETRO', 'OTRO']
ControlMethod = Literal['VERIFICACION_INTERNA', 'CALIBRACION_INTERNA', 'CALIBRACION_EXTERNA']
FrequencyUnit = Literal['DIAS', 'SEMANAS', 'MESES']
ResponsibleGroup = Literal['MANTENIMIENTO', 'MECANICO', 'ELECTRICO', 'TECNICO', 'EXTERNO']
AssigneeType = Literal['GRUPO', 'USUARIO', 'CONTRATISTA']
ActionTaken = Literal['NINGUNA', 'AJUSTE', 'MANTENIMIENTO', 'CALIBRACION_EXTERNA', 'RETIRO', 'REEMPLAZO']
Magnitude = Literal['MASA', 'TEMPERATURA', 'HUMEDAD', 'PRESION', 'VOLUMEN', 'OTRA']

GROUP_ROLES = {'MANTENIMIENTO': ('MECANICO', 'ELECTRICO', 'TECNICO'), 'MECANICO': ('MECANICO',), 'ELECTRICO': ('ELECTRICO',),
               'TECNICO': ('TECNICO',), 'EXTERNO': ()}
GROUP_LABELS = {'MANTENIMIENTO': 'Mantenimiento (todos)', 'MECANICO': 'Mecánico', 'ELECTRICO': 'Eléctrico', 'TECNICO': 'Técnico',
                'EXTERNO': 'Proveedor externo'}
OPEN_ORDER = ('PROGRAMADA', 'NO_CONFORME')

# Formato de registro según el procedimiento MT/03 (sección 11).
FORMAT_BY_TYPE = {
    'BALANZA': 'MT/03-04',
    'SISTEMA_PESAJE': 'MT/03-05',
    'TEMPERATURA_HUMEDAD': 'MT/03-03',
    'MANOMETRO': 'MT/03-06',
    'CAUDALIMETRO': 'MT/03-07',
}
EXTERNAL_FORMAT = 'MT/03-02'


def today():
    return datetime.now(ECUADOR).date()


def format_code(instrument_type, method):
    if method == 'CALIBRACION_EXTERNA' or instrument_type == 'BASCULA_CAMIONERA':
        return EXTERNAL_FORMAT
    return FORMAT_BY_TYPE.get(instrument_type, EXTERNAL_FORMAT)


def add_frequency(start, every, unit):
    if unit == 'DIAS':
        return start + timedelta(days=every)
    if unit == 'SEMANAS':
        return start + timedelta(weeks=every)
    month_index = start.month - 1 + every
    year, month = start.year + month_index // 12, month_index % 12 + 1
    return date(year, month, min(start.day, calendar.monthrange(year, month)[1]))


def evaluate_point(reference, measured, emp):
    """Error = valor medido − valor patrón; conforme cuando |error| ≤ EMP (MT/03 6.2.4)."""
    error = Decimal(measured) - Decimal(reference)
    return error, abs(error) <= Decimal(emp)


def project_occurrences(next_due, every, unit, start, end, limit=400):
    """Fechas del plan entre start y end, partiendo del próximo vencimiento pendiente."""
    dates, current = [], next_due
    while current <= end and len(dates) < limit:
        if current >= start:
            dates.append(current)
        current = add_frequency(current, every, unit)
    return dates


def due_cycles(next_due, every, unit, start, end, limit=60):
    """Ciclos por publicar hasta `end` y el siguiente vencimiento resultante.

    Los ciclos atrasados (anteriores a `start`) se agrupan en una sola orden programada en `start`,
    conservando la fecha de vencimiento original y el número de ciclos omitidos, como en preventivos.
    """
    cycles, current, overdue, skipped = [], next_due, None, 0
    while current <= end and len(cycles) < limit:
        if current < start:
            if overdue is not None:
                skipped += 1
            overdue = current
        else:
            cycles.append(dict(due=current, scheduled=current, skipped=0))
        current = add_frequency(current, every, unit)
    if overdue is not None:
        cycles.insert(0, dict(due=overdue, scheduled=start, skipped=skipped))
    return cycles, current


def can_execute(role, user_id, order):
    """Quién puede registrar una orden: administrador, la persona asignada o un miembro del grupo asignado."""
    if role == 'ADMIN':
        return True
    if order['assignee_type'] == 'USUARIO':
        return order['assigned_user_id'] == user_id
    if order['assignee_type'] == 'GRUPO':
        return role in GROUP_ROLES.get(order['responsible_group'], ())
    return False  # Contratista: el resultado externo lo registra el administrador.


def assignee_label(item):
    if item.get('assignee_type') == 'USUARIO':
        return item.get('assigned_user_name') or 'Persona no disponible'
    if item.get('assignee_type') == 'CONTRATISTA':
        return f"Contratista · {item.get('assigned_contractor_name') or 'no disponible'}"
    return GROUP_LABELS.get(item.get('responsible_group'), item.get('responsible_group'))


def clean(value):
    if value is None:
        return None
    value = value.strip()
    return value or None


class StandardWrite(BaseModel):
    code: str = Field(min_length=1, max_length=40)
    description: str = Field(min_length=1, max_length=150)
    magnitude: Magnitude
    nominal_value: Decimal | None = Field(default=None, max_digits=18, decimal_places=4)
    unit: str | None = Field(default=None, max_length=20)
    accuracy_class: str | None = Field(default=None, max_length=30)
    quantity: int = Field(default=1, ge=1, le=10000)
    certificate_number: str | None = Field(default=None, max_length=80)
    laboratory: str | None = Field(default=None, max_length=150)
    calibrated_on: date | None = None
    valid_until: date | None = None
    notes: str | None = Field(default=None, max_length=500)
    active: bool = True

    @field_validator('code', 'description')
    @classmethod
    def required_text(cls, value):
        value = value.strip()
        if not value:
            raise ValueError('Campo obligatorio')
        return value

    @model_validator(mode='after')
    def validity(self):
        if self.calibrated_on and self.valid_until and self.valid_until < self.calibrated_on:
            raise ValueError('La vigencia no puede ser anterior a la fecha de calibración')
        return self


class InstrumentWrite(BaseModel):
    code: str = Field(min_length=1, max_length=40)
    name: str = Field(min_length=1, max_length=150)
    instrument_type: InstrumentType
    brand_model: str | None = Field(default=None, max_length=120)
    plant_id: int | None = None
    area: str = Field(min_length=1, max_length=100)
    range_min: Decimal | None = Field(default=None, max_digits=18, decimal_places=4)
    range_max: Decimal | None = Field(default=None, max_digits=18, decimal_places=4)
    unit: str = Field(min_length=1, max_length=20)
    resolution: Decimal | None = Field(default=None, ge=0, max_digits=18, decimal_places=4)
    emp: Decimal = Field(ge=0, max_digits=18, decimal_places=4)
    criticality: Literal['ALTA', 'MEDIA', 'BAJA'] = 'MEDIA'
    notes: str | None = Field(default=None, max_length=500)
    active: bool = True

    @field_validator('code', 'name', 'area', 'unit')
    @classmethod
    def required_text(cls, value):
        value = value.strip()
        if not value:
            raise ValueError('Campo obligatorio')
        return value

    @model_validator(mode='after')
    def range_order(self):
        if self.range_min is not None and self.range_max is not None and self.range_min > self.range_max:
            raise ValueError('El rango mínimo no puede ser mayor que el máximo')
        return self


class ActivityWrite(BaseModel):
    name: str = Field(min_length=1, max_length=150)
    control_method: ControlMethod
    instrument_type: InstrumentType | None = None
    procedure: str = Field(min_length=1, max_length=4000)
    frequency_every: int = Field(ge=1, le=3650)
    frequency_unit: FrequencyUnit
    responsible_group: ResponsibleGroup
    duration_minutes: int = Field(ge=1, le=10080)
    crew_size: int = Field(default=1, ge=1, le=50)
    start_time: time = time(8)
    active: bool = True

    @field_validator('name', 'procedure')
    @classmethod
    def required_text(cls, value):
        value = value.strip()
        if not value:
            raise ValueError('Campo obligatorio')
        return value


class Assignee(BaseModel):
    assignee_type: AssigneeType = 'GRUPO'
    assigned_user_id: int | None = None
    assigned_contractor_id: int | None = None

    @model_validator(mode='after')
    def assignee(self):
        if self.assignee_type == 'USUARIO' and not self.assigned_user_id:
            raise ValueError('Selecciona la persona responsable')
        if self.assignee_type == 'CONTRATISTA' and not self.assigned_contractor_id:
            raise ValueError('Selecciona el contratista responsable')
        if self.assignee_type != 'USUARIO':
            self.assigned_user_id = None
        if self.assignee_type != 'CONTRATISTA':
            self.assigned_contractor_id = None
        return self


class PlanWrite(Assignee):
    activity_id: int | None = None
    control_method: ControlMethod
    frequency_every: int = Field(ge=1, le=3650)
    frequency_unit: FrequencyUnit
    responsible_group: ResponsibleGroup
    start_time: time = time(8)
    next_due: date
    active: bool = True


class PublishWrite(BaseModel):
    start: date
    end: date
    plan_ids: list[int] = Field(min_length=1, max_length=500)


class OrderUpdate(Assignee):
    scheduled_date: date
    start_time: time
    responsible_group: ResponsibleGroup
    reason: str | None = Field(default=None, max_length=300)


class ReasonWrite(BaseModel):
    reason: str = Field(min_length=3, max_length=300)


class PointWrite(BaseModel):
    label: str = Field(min_length=1, max_length=60)
    reference_value: Decimal = Field(max_digits=18, decimal_places=4)
    measured_value: Decimal = Field(max_digits=18, decimal_places=4)
    emp: Decimal | None = Field(default=None, ge=0, max_digits=18, decimal_places=4)


class RecordWrite(BaseModel):
    instrument_id: int
    order_id: int | None = None
    plan_id: int | None = None
    control_method: ControlMethod | None = None
    scheduled_for: date | None = None
    performed_on: date
    points: list[PointWrite] = Field(default_factory=list, max_length=60)
    standard_ids: list[int] = Field(default_factory=list, max_length=30)
    result: Literal['CONFORME', 'NO_CONFORME'] | None = None
    action_taken: ActionTaken = 'NINGUNA'
    area_responsible: str | None = Field(default=None, max_length=150)
    external_provider: str | None = Field(default=None, max_length=150)
    certificate_number: str | None = Field(default=None, max_length=80)
    observations: str | None = Field(default=None, max_length=1000)


def rows_as_dicts(cursor):
    columns = [column[0] for column in cursor.description]
    return [dict(zip(columns, row)) for row in cursor.fetchall()]


USER_NAME = "COALESCE(NULLIF(LTRIM(RTRIM(CONCAT({0}.Nombres,' ',{0}.Apellidos))),''),{0}.Nombre)"


def register_calibration(app, connect, active_user, admin_user):
    def run(operation, error_message):
        try:
            with closing(connect()) as connection:
                cursor = connection.cursor()
                result = operation(cursor)
                connection.commit()
                return result
        except HTTPException:
            raise
        except pyodbc.IntegrityError:
            raise HTTPException(409, 'Ya existe un registro con esos datos o el ciclo ya fue publicado.')
        except (pyodbc.Error, RuntimeError):
            raise HTTPException(503, f'{error_message} {MIGRATION_HINT}')

    def staff_role(cursor, user_id):
        row = cursor.execute('SELECT Rol FROM dbo.Usuarios WHERE Id=? AND Activo=1', user_id).fetchone()
        if not row or str(row[0]).upper() not in STAFF_ROLES:
            raise HTTPException(403, 'El módulo de calibración es para el personal de mantenimiento.')
        return str(row[0]).upper()

    def check_assignee(cursor, data):
        if data.assignee_type == 'USUARIO':
            row = cursor.execute('SELECT Rol FROM dbo.Usuarios WHERE Id=? AND Activo=1', data.assigned_user_id).fetchone()
            if not row or str(row[0]).upper() not in STAFF_ROLES:
                raise HTTPException(422, 'La persona responsable debe ser personal de mantenimiento activo.')
        if data.assignee_type == 'CONTRATISTA':
            if not cursor.execute('SELECT 1 FROM dbo.Contractors WHERE ContractorId=? AND Active=1', data.assigned_contractor_id).fetchone():
                raise HTTPException(422, 'El contratista no existe o está inactivo.')

    # ---------- Responsables disponibles ----------
    @app.get('/calibracion/responsables')
    def responsible_options(usuario_id: int = Depends(active_user)):
        def operation(cursor):
            staff_role(cursor, usuario_id)
            cursor.execute(f'''SELECT u.Id AS id, {USER_NAME.format('u')} AS name, u.Rol AS role FROM dbo.Usuarios u
                WHERE u.Activo=1 AND u.Rol IN ('ADMIN','MECANICO','ELECTRICO','TECNICO') ORDER BY name''')
            users = rows_as_dicts(cursor)
            try:
                cursor.execute('SELECT ContractorId AS id, Name AS name, Specialty AS specialty FROM dbo.Contractors WHERE Active=1 ORDER BY Name')
                contractors = rows_as_dicts(cursor)
            except pyodbc.Error:
                contractors = []
            return dict(users=users, contractors=contractors)
        return run(operation, 'No se pudieron consultar los responsables.')

    # ---------- Patrones (Anexo 3) ----------
    standard_columns = '''StandardId AS id, Code AS code, Description AS description, Magnitude AS magnitude,
        NominalValue AS nominal_value, Unit AS unit, AccuracyClass AS accuracy_class, Quantity AS quantity,
        CertificateNumber AS certificate_number, Laboratory AS laboratory, CalibratedOn AS calibrated_on,
        ValidUntil AS valid_until, Notes AS notes, Active AS active'''

    def standard_payload(data):
        return [data.code, data.description, data.magnitude, data.nominal_value, clean(data.unit), clean(data.accuracy_class),
                data.quantity, clean(data.certificate_number), clean(data.laboratory), data.calibrated_on, data.valid_until,
                clean(data.notes), data.active]

    def with_validity(item):
        item['active'] = bool(item['active'])
        item['expired'] = bool(item['valid_until'] and item['valid_until'] < today())
        return item

    @app.get('/calibracion/patrones')
    def list_standards(usuario_id: int = Depends(active_user)):
        def operation(cursor):
            staff_role(cursor, usuario_id)
            cursor.execute(f'SELECT {standard_columns} FROM dbo.CalibrationStandards ORDER BY Active DESC, Code')
            return [with_validity(item) for item in rows_as_dicts(cursor)]
        return run(operation, 'No se pudieron consultar los patrones.')

    @app.post('/calibracion/patrones', status_code=201)
    def create_standard(data: StandardWrite, usuario_id: int = Depends(admin_user)):
        def operation(cursor):
            new_id = cursor.execute('''INSERT INTO dbo.CalibrationStandards(Code,Description,Magnitude,NominalValue,Unit,AccuracyClass,
                Quantity,CertificateNumber,Laboratory,CalibratedOn,ValidUntil,Notes,Active)
                OUTPUT INSERTED.StandardId VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)''', *standard_payload(data)).fetchone()[0]
            cursor.execute(f'SELECT {standard_columns} FROM dbo.CalibrationStandards WHERE StandardId=?', new_id)
            return with_validity(rows_as_dicts(cursor)[0])
        return run(operation, 'No se pudo guardar el patrón.')

    @app.put('/calibracion/patrones/{standard_id}')
    def update_standard(standard_id: int, data: StandardWrite, usuario_id: int = Depends(admin_user)):
        def operation(cursor):
            cursor.execute('''UPDATE dbo.CalibrationStandards SET Code=?,Description=?,Magnitude=?,NominalValue=?,Unit=?,AccuracyClass=?,
                Quantity=?,CertificateNumber=?,Laboratory=?,CalibratedOn=?,ValidUntil=?,Notes=?,Active=? WHERE StandardId=?''',
                           *standard_payload(data), standard_id)
            if cursor.rowcount == 0:
                raise HTTPException(404, 'Patrón no encontrado.')
            cursor.execute(f'SELECT {standard_columns} FROM dbo.CalibrationStandards WHERE StandardId=?', standard_id)
            return with_validity(rows_as_dicts(cursor)[0])
        return run(operation, 'No se pudo guardar el patrón.')

    # ---------- Actividades de calibración ----------
    activity_columns = '''ActivityId AS id, Name AS name, ControlMethod AS control_method, InstrumentType AS instrument_type,
        ProcedureText AS [procedure], FrequencyEvery AS frequency_every, FrequencyUnit AS frequency_unit, ResponsibleGroup AS responsible_group,
        DurationMinutes AS duration_minutes, CrewSize AS crew_size, StartTime AS start_time, Active AS active'''

    def activity_payload(data):
        return [data.name, data.control_method, data.instrument_type, data.procedure, data.frequency_every, data.frequency_unit,
                data.responsible_group, data.duration_minutes, data.crew_size, data.start_time, data.active]

    def load_activity(cursor, activity_id):
        cursor.execute(f'SELECT {activity_columns} FROM dbo.CalibrationActivities WHERE ActivityId=?', activity_id)
        rows = rows_as_dicts(cursor)
        if not rows:
            raise HTTPException(404, 'Actividad no encontrada.')
        return {**rows[0], 'active': bool(rows[0]['active'])}

    @app.get('/calibracion/actividades')
    def list_activities(usuario_id: int = Depends(active_user)):
        def operation(cursor):
            staff_role(cursor, usuario_id)
            cursor.execute(f'SELECT {activity_columns} FROM dbo.CalibrationActivities ORDER BY Active DESC, Name')
            return [{**item, 'active': bool(item['active'])} for item in rows_as_dicts(cursor)]
        return run(operation, 'No se pudieron consultar las actividades.')

    @app.post('/calibracion/actividades', status_code=201)
    def create_activity(data: ActivityWrite, usuario_id: int = Depends(admin_user)):
        def operation(cursor):
            new_id = cursor.execute('''INSERT INTO dbo.CalibrationActivities(Name,ControlMethod,InstrumentType,ProcedureText,FrequencyEvery,
                FrequencyUnit,ResponsibleGroup,DurationMinutes,CrewSize,StartTime,Active) OUTPUT INSERTED.ActivityId
                VALUES(?,?,?,?,?,?,?,?,?,?,?)''', *activity_payload(data)).fetchone()[0]
            return load_activity(cursor, new_id)
        return run(operation, 'No se pudo guardar la actividad.')

    @app.put('/calibracion/actividades/{activity_id}')
    def update_activity(activity_id: int, data: ActivityWrite, usuario_id: int = Depends(admin_user)):
        # Los planes conservan su propia frecuencia y responsable; las órdenes publicadas no cambian.
        def operation(cursor):
            cursor.execute('''UPDATE dbo.CalibrationActivities SET Name=?,ControlMethod=?,InstrumentType=?,ProcedureText=?,FrequencyEvery=?,
                FrequencyUnit=?,ResponsibleGroup=?,DurationMinutes=?,CrewSize=?,StartTime=?,Active=? WHERE ActivityId=?''',
                           *activity_payload(data), activity_id)
            if cursor.rowcount == 0:
                raise HTTPException(404, 'Actividad no encontrada.')
            return load_activity(cursor, activity_id)
        return run(operation, 'No se pudo guardar la actividad.')

    # ---------- Instrumentos (Anexo 1) y planes / matriz AMEM (Anexo 2) ----------
    instrument_columns = '''i.InstrumentId AS id, i.Code AS code, i.Name AS name, i.InstrumentType AS instrument_type,
        i.BrandModel AS brand_model, i.PlantId AS plant_id, p.Name AS plant_name, i.Area AS area, i.RangeMin AS range_min,
        i.RangeMax AS range_max, i.Unit AS unit, i.Resolution AS resolution, i.Emp AS emp, i.Criticality AS criticality,
        i.Status AS status, i.Notes AS notes, i.Active AS active'''
    plan_columns = f'''pl.PlanId AS id, pl.InstrumentId AS instrument_id, pl.ActivityId AS activity_id, a.Name AS activity_name,
        pl.ControlMethod AS control_method, pl.FrequencyEvery AS frequency_every, pl.FrequencyUnit AS frequency_unit,
        pl.ResponsibleGroup AS responsible_group, pl.AssigneeType AS assignee_type, pl.AssignedUserId AS assigned_user_id,
        {USER_NAME.format('u')} AS assigned_user_name, pl.AssignedContractorId AS assigned_contractor_id, c.Name AS assigned_contractor_name,
        pl.StartTime AS start_time, pl.NextDue AS next_due, pl.Active AS active,
        (SELECT COUNT(*) FROM dbo.CalibrationOrders o WHERE o.PlanId=pl.PlanId AND o.Status IN ('PROGRAMADA','NO_CONFORME')) AS open_orders'''
    plan_from = '''FROM dbo.CalibrationPlans pl LEFT JOIN dbo.CalibrationActivities a ON a.ActivityId=pl.ActivityId
        LEFT JOIN dbo.Usuarios u ON u.Id=pl.AssignedUserId LEFT JOIN dbo.Contractors c ON c.ContractorId=pl.AssignedContractorId'''

    def plan_state(plan):
        plan['active'] = bool(plan['active'])
        plan['days_to_due'] = (plan['next_due'] - today()).days
        plan['assignee'] = assignee_label(plan)
        return plan

    def load_instruments(cursor, instrument_id=None):
        where = 'WHERE i.InstrumentId=?' if instrument_id else ''
        args = [instrument_id] if instrument_id else []
        cursor.execute(f'''SELECT {instrument_columns} FROM dbo.CalibrationInstruments i
            LEFT JOIN dbo.Plants p ON p.PlantId=i.PlantId {where} ORDER BY i.Active DESC, i.Code''', *args)
        instruments = rows_as_dicts(cursor)
        if not instruments:
            return []
        cursor.execute(f"SELECT {plan_columns} {plan_from} WHERE pl.Active=1{' AND pl.InstrumentId=?' if instrument_id else ''}", *args)
        plans = [plan_state(plan) for plan in rows_as_dicts(cursor)]
        cursor.execute('SELECT InstrumentId, MAX(PerformedOn) FROM dbo.CalibrationRecords WHERE Voided=0 GROUP BY InstrumentId')
        last = {row[0]: row[1] for row in cursor.fetchall()}
        for item in instruments:
            item['active'] = bool(item['active'])
            item['last_performed_on'] = last.get(item['id'])
            item['plans'] = [plan for plan in plans if plan['instrument_id'] == item['id']]
            for plan in item['plans']:
                plan['format_code'] = format_code(item['instrument_type'], plan['control_method'])
        return instruments

    def instrument_payload(data):
        return [data.code, data.name, data.instrument_type, clean(data.brand_model), data.plant_id, data.area,
                data.range_min, data.range_max, data.unit, data.resolution, data.emp, data.criticality, clean(data.notes), data.active]

    @app.get('/calibracion/instrumentos')
    def list_instruments(usuario_id: int = Depends(active_user)):
        def operation(cursor):
            staff_role(cursor, usuario_id)
            return load_instruments(cursor)
        return run(operation, 'No se pudieron consultar los instrumentos.')

    @app.post('/calibracion/instrumentos', status_code=201)
    def create_instrument(data: InstrumentWrite, usuario_id: int = Depends(admin_user)):
        def operation(cursor):
            new_id = cursor.execute('''INSERT INTO dbo.CalibrationInstruments(Code,Name,InstrumentType,BrandModel,PlantId,Area,
                RangeMin,RangeMax,Unit,Resolution,Emp,Criticality,Notes,Active) OUTPUT INSERTED.InstrumentId
                VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)''', *instrument_payload(data)).fetchone()[0]
            return load_instruments(cursor, new_id)[0]
        return run(operation, 'No se pudo guardar el instrumento.')

    @app.put('/calibracion/instrumentos/{instrument_id}')
    def update_instrument(instrument_id: int, data: InstrumentWrite, usuario_id: int = Depends(admin_user)):
        def operation(cursor):
            cursor.execute('''UPDATE dbo.CalibrationInstruments SET Code=?,Name=?,InstrumentType=?,BrandModel=?,PlantId=?,Area=?,
                RangeMin=?,RangeMax=?,Unit=?,Resolution=?,Emp=?,Criticality=?,Notes=?,Active=? WHERE InstrumentId=?''',
                           *instrument_payload(data), instrument_id)
            if cursor.rowcount == 0:
                raise HTTPException(404, 'Instrumento no encontrado.')
            if not data.active:
                cursor.execute('UPDATE dbo.CalibrationPlans SET Active=0 WHERE InstrumentId=?', instrument_id)
            return load_instruments(cursor, instrument_id)[0]
        return run(operation, 'No se pudo guardar el instrumento.')

    def check_activity(cursor, data):
        if data.activity_id is None:
            return
        row = cursor.execute('SELECT ControlMethod, Active FROM dbo.CalibrationActivities WHERE ActivityId=?', data.activity_id).fetchone()
        if not row or not row[1]:
            raise HTTPException(422, 'La actividad no existe o está inactiva.')
        if row[0] != data.control_method:
            raise HTTPException(422, 'El método del plan debe coincidir con el de la actividad.')

    @app.post('/calibracion/instrumentos/{instrument_id}/planes', status_code=201)
    def create_plan(instrument_id: int, data: PlanWrite, usuario_id: int = Depends(admin_user)):
        def operation(cursor):
            if not cursor.execute('SELECT 1 FROM dbo.CalibrationInstruments WHERE InstrumentId=? AND Active=1', instrument_id).fetchone():
                raise HTTPException(404, 'Instrumento no encontrado o inactivo.')
            if cursor.execute('SELECT 1 FROM dbo.CalibrationPlans WHERE InstrumentId=? AND ControlMethod=? AND Active=1',
                              instrument_id, data.control_method).fetchone():
                raise HTTPException(409, 'El instrumento ya tiene un plan activo con ese método. Edítalo en lugar de crear otro.')
            check_activity(cursor, data)
            check_assignee(cursor, data)
            cursor.execute('''INSERT INTO dbo.CalibrationPlans(InstrumentId,ActivityId,ControlMethod,FrequencyEvery,FrequencyUnit,ResponsibleGroup,
                AssigneeType,AssignedUserId,AssignedContractorId,StartTime,NextDue,Active) VALUES(?,?,?,?,?,?,?,?,?,?,?,1)''',
                           instrument_id, data.activity_id, data.control_method, data.frequency_every, data.frequency_unit,
                           data.responsible_group, data.assignee_type, data.assigned_user_id, data.assigned_contractor_id,
                           data.start_time, data.next_due)
            return load_instruments(cursor, instrument_id)[0]
        return run(operation, 'No se pudo guardar el plan.')

    @app.put('/calibracion/planes/{plan_id}')
    def update_plan(plan_id: int, data: PlanWrite, usuario_id: int = Depends(admin_user)):
        # Cambiar el plan no modifica las órdenes ya publicadas.
        def operation(cursor):
            row = cursor.execute('SELECT InstrumentId, ControlMethod FROM dbo.CalibrationPlans WHERE PlanId=? AND Active=1', plan_id).fetchone()
            if not row:
                raise HTTPException(404, 'Plan no encontrado o inactivo.')
            if row[1] != data.control_method:
                raise HTTPException(422, 'Para cambiar el método de control desactiva este plan y crea otro.')
            check_activity(cursor, data)
            check_assignee(cursor, data)
            cursor.execute('''UPDATE dbo.CalibrationPlans SET ActivityId=?,FrequencyEvery=?,FrequencyUnit=?,ResponsibleGroup=?,AssigneeType=?,
                AssignedUserId=?,AssignedContractorId=?,StartTime=?,NextDue=?,Active=? WHERE PlanId=?''',
                           data.activity_id, data.frequency_every, data.frequency_unit, data.responsible_group, data.assignee_type,
                           data.assigned_user_id, data.assigned_contractor_id, data.start_time, data.next_due, data.active, plan_id)
            return load_instruments(cursor, row[0])[0]
        return run(operation, 'No se pudo guardar el plan.')

    # ---------- Publicación y órdenes ----------
    order_columns = f'''o.OrderId AS id, o.PlanId AS plan_id, o.InstrumentId AS instrument_id, i.Code AS instrument_code,
        i.Name AS instrument_name, i.InstrumentType AS instrument_type, i.Area AS area, pt.Name AS plant_name, o.ActivityId AS activity_id,
        a.Name AS activity_name, a.ProcedureText AS [procedure], a.DurationMinutes AS duration_minutes, a.CrewSize AS crew_size,
        o.ControlMethod AS control_method, o.DueDate AS due_date, o.SkippedCycles AS skipped_cycles, o.ScheduledDate AS scheduled_date,
        o.StartTime AS start_time, o.ResponsibleGroup AS responsible_group, o.AssigneeType AS assignee_type,
        o.AssignedUserId AS assigned_user_id, {USER_NAME.format('u')} AS assigned_user_name, o.AssignedContractorId AS assigned_contractor_id,
        c.Name AS assigned_contractor_name, o.Status AS status, o.Rescheduled AS rescheduled, o.ChangeReason AS change_reason,
        {USER_NAME.format('pb')} AS published_by, o.PublishedAt AS published_at, o.ClosedAt AS closed_at,
        (SELECT TOP 1 r.RecordId FROM dbo.CalibrationRecords r WHERE r.OrderId=o.OrderId AND r.Voided=0 ORDER BY r.RecordId DESC) AS last_record_id'''
    order_from = '''FROM dbo.CalibrationOrders o JOIN dbo.CalibrationInstruments i ON i.InstrumentId=o.InstrumentId
        LEFT JOIN dbo.Plants pt ON pt.PlantId=i.PlantId LEFT JOIN dbo.CalibrationActivities a ON a.ActivityId=o.ActivityId
        LEFT JOIN dbo.Usuarios u ON u.Id=o.AssignedUserId LEFT JOIN dbo.Contractors c ON c.ContractorId=o.AssignedContractorId
        JOIN dbo.Usuarios pb ON pb.Id=o.PublishedBy'''

    def order_state(order, role=None, user_id=None):
        order['rescheduled'] = bool(order['rescheduled'])
        order['assignee'] = assignee_label(order)
        order['format_code'] = format_code(order['instrument_type'], order['control_method'])
        order['overdue'] = order['status'] in OPEN_ORDER and order['scheduled_date'] < today()
        if role:
            order['can_execute'] = order['status'] in OPEN_ORDER and can_execute(role, user_id, order)
        return order

    def load_order(cursor, order_id, role=None, user_id=None):
        cursor.execute(f'SELECT {order_columns} {order_from} WHERE o.OrderId=?', order_id)
        rows = rows_as_dicts(cursor)
        if not rows:
            raise HTTPException(404, 'Orden no encontrada.')
        return order_state(rows[0], role, user_id)

    def pending_cycles(cursor, start, end, plan_ids=None):
        instruments = [item for item in load_instruments(cursor) if item['active']]
        # Los ciclos ya vencidos que nunca se publicaron se agrupan en una sola orden para hoy.
        start = max(start, today())
        if end < start:
            return []
        rows = []
        for instrument in instruments:
            for plan in instrument['plans']:
                if plan_ids is not None and plan['id'] not in plan_ids:
                    continue
                cycles, following = due_cycles(plan['next_due'], plan['frequency_every'], plan['frequency_unit'], start, end)
                if not cycles:
                    continue
                rows.append(dict(plan=plan, instrument=dict(id=instrument['id'], code=instrument['code'], name=instrument['name'],
                                                            area=instrument['area'], plant_name=instrument['plant_name'],
                                                            instrument_type=instrument['instrument_type']),
                                 cycles=cycles, following=following, blocked=plan['open_orders'] > 0))
        return rows

    @app.get('/calibracion/proximos')
    def upcoming(start: date, end: date, usuario_id: int = Depends(admin_user)):
        if end < start or (end - start).days > 92:
            raise HTTPException(422, 'El período a publicar debe ser de hasta 92 días.')
        return run(lambda cursor: pending_cycles(cursor, start, end), 'No se pudieron calcular los ciclos por publicar.')

    @app.post('/calibracion/publicar')
    def publish(data: PublishWrite, usuario_id: int = Depends(admin_user)):
        if data.end < data.start or (data.end - data.start).days > 92:
            raise HTTPException(422, 'El período a publicar debe ser de hasta 92 días.')

        def operation(cursor):
            selected = set(data.plan_ids)
            rows = pending_cycles(cursor, data.start, data.end, selected)
            blocked = [f"{row['instrument']['code']}" for row in rows if row['blocked']]
            if blocked:
                raise HTTPException(409, f"Hay órdenes abiertas sin cerrar para: {', '.join(blocked)}. Regístralas o cancélalas antes de publicar nuevos ciclos.")
            order_ids = []
            for row in sorted(rows, key=lambda item: item['plan']['id']):
                plan = row['plan']
                for cycle in row['cycles']:
                    order_ids.append(cursor.execute('''INSERT INTO dbo.CalibrationOrders(PlanId,InstrumentId,ActivityId,ControlMethod,DueDate,
                        SkippedCycles,ScheduledDate,StartTime,ResponsibleGroup,AssigneeType,AssignedUserId,AssignedContractorId,PublishedBy)
                        OUTPUT INSERTED.OrderId VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)''',
                        plan['id'], row['instrument']['id'], plan['activity_id'], plan['control_method'], cycle['due'], cycle['skipped'],
                        cycle['scheduled'], plan['start_time'], plan['responsible_group'], plan['assignee_type'], plan['assigned_user_id'],
                        plan['assigned_contractor_id'], usuario_id).fetchone()[0])
                # Igual que preventivos: publicar avanza el plan al siguiente ciclo no publicado.
                cursor.execute('UPDATE dbo.CalibrationPlans SET NextDue=? WHERE PlanId=? AND NextDue=?', row['following'], plan['id'], plan['next_due'])
                if cursor.rowcount == 0:
                    raise HTTPException(409, 'El plan cambió mientras se publicaba. Actualiza y vuelve a intentarlo.')
            return dict(order_ids=order_ids)
        return run(operation, 'No se pudieron publicar las calibraciones.')

    @app.get('/calibracion/ordenes')
    def list_orders(start: date | None = None, end: date | None = None, mine: bool = False, open_only: bool = False,
                    usuario_id: int = Depends(active_user)):
        def operation(cursor):
            role = staff_role(cursor, usuario_id)
            filters, args = ["o.Status<>'CANCELADA'"], []
            if start:
                filters.append('o.ScheduledDate>=?'); args.append(start)
            if end:
                filters.append('o.ScheduledDate<=?'); args.append(end)
            if open_only:
                filters.append("o.Status IN ('PROGRAMADA','NO_CONFORME')")
            cursor.execute(f"SELECT TOP 1000 {order_columns} {order_from} WHERE {' AND '.join(filters)} ORDER BY o.ScheduledDate, o.StartTime, i.Code", *args)
            orders = [order_state(order, role, usuario_id) for order in rows_as_dicts(cursor)]
            if mine:
                orders = [order for order in orders if order['status'] in OPEN_ORDER and can_execute(role if role != 'ADMIN' else 'X', usuario_id, order)]
            return orders
        return run(operation, 'No se pudieron consultar las órdenes.')

    @app.get('/calibracion/ordenes/{order_id}')
    def get_order(order_id: int, usuario_id: int = Depends(active_user)):
        def operation(cursor):
            return load_order(cursor, order_id, staff_role(cursor, usuario_id), usuario_id)
        return run(operation, 'No se pudo consultar la orden.')

    @app.put('/calibracion/ordenes/{order_id}')
    def update_order(order_id: int, data: OrderUpdate, usuario_id: int = Depends(admin_user)):
        def operation(cursor):
            row = cursor.execute('SELECT ScheduledDate, Status FROM dbo.CalibrationOrders WHERE OrderId=?', order_id).fetchone()
            if not row:
                raise HTTPException(404, 'Orden no encontrada.')
            if row[1] not in OPEN_ORDER:
                raise HTTPException(409, 'Solo se pueden reprogramar o reasignar órdenes abiertas.')
            moved = data.scheduled_date != row[0]
            if moved and not clean(data.reason):
                raise HTTPException(422, 'Indica el motivo de la reprogramación.')
            check_assignee(cursor, data)
            cursor.execute('''UPDATE dbo.CalibrationOrders SET ScheduledDate=?,StartTime=?,ResponsibleGroup=?,AssigneeType=?,AssignedUserId=?,
                AssignedContractorId=?,Rescheduled=CASE WHEN ?=1 THEN 1 ELSE Rescheduled END,ChangeReason=COALESCE(?,ChangeReason) WHERE OrderId=?''',
                           data.scheduled_date, data.start_time, data.responsible_group, data.assignee_type, data.assigned_user_id,
                           data.assigned_contractor_id, 1 if moved else 0, clean(data.reason), order_id)
            return load_order(cursor, order_id, 'ADMIN', usuario_id)
        return run(operation, 'No se pudo actualizar la orden.')

    @app.post('/calibracion/ordenes/{order_id}/cancelar')
    def cancel_order(order_id: int, data: ReasonWrite, usuario_id: int = Depends(admin_user)):
        # Cancelar no regresa el plan: el ciclo queda registrado como cancelado con su motivo.
        def operation(cursor):
            cursor.execute('''UPDATE dbo.CalibrationOrders SET Status='CANCELADA', ChangeReason=?, ClosedAt=SYSDATETIME()
                WHERE OrderId=? AND Status IN ('PROGRAMADA','NO_CONFORME')''', data.reason.strip(), order_id)
            if cursor.rowcount == 0:
                raise HTTPException(409, 'La orden no existe o ya está cerrada.')
            return load_order(cursor, order_id, 'ADMIN', usuario_id)
        return run(operation, 'No se pudo cancelar la orden.')

    # ---------- Registros MT/03-02 a MT/03-07 ----------
    record_columns = f'''r.RecordId AS id, r.InstrumentId AS instrument_id, i.Code AS instrument_code, i.Name AS instrument_name,
        i.InstrumentType AS instrument_type, i.Area AS area, pl.Name AS plant_name, i.Unit AS unit, r.PlanId AS plan_id, r.OrderId AS order_id,
        r.ControlMethod AS control_method, r.FormatCode AS format_code, r.ScheduledFor AS scheduled_for, r.PerformedOn AS performed_on,
        r.Result AS result, r.ActionTaken AS action_taken, r.AreaResponsible AS area_responsible, r.ExternalProvider AS external_provider,
        r.CertificateNumber AS certificate_number, r.Observations AS observations, r.RegisteredAt AS registered_at,
        {USER_NAME.format('u')} AS registered_by, r.ReviewedAt AS reviewed_at, {USER_NAME.format('v')} AS reviewed_by,
        r.Voided AS voided, r.VoidReason AS void_reason'''
    record_from = '''FROM dbo.CalibrationRecords r JOIN dbo.CalibrationInstruments i ON i.InstrumentId=r.InstrumentId
        LEFT JOIN dbo.Plants pl ON pl.PlantId=i.PlantId JOIN dbo.Usuarios u ON u.Id=r.RegisteredBy
        LEFT JOIN dbo.Usuarios v ON v.Id=r.ReviewedBy'''

    def load_record(cursor, record_id):
        cursor.execute(f'SELECT {record_columns} {record_from} WHERE r.RecordId=?', record_id)
        records = rows_as_dicts(cursor)
        if not records:
            raise HTTPException(404, 'Registro no encontrado.')
        record = records[0]
        record['voided'] = bool(record['voided'])
        cursor.execute('''SELECT Position AS position, Label AS label, ReferenceValue AS reference_value, MeasuredValue AS measured_value,
            Error AS error, Emp AS emp, Conforms AS conforms FROM dbo.CalibrationRecordPoints WHERE RecordId=? ORDER BY Position''', record_id)
        record['points'] = [{**point, 'conforms': bool(point['conforms'])} for point in rows_as_dicts(cursor)]
        cursor.execute('''SELECT s.StandardId AS id, s.Code AS code, s.Description AS description, s.CertificateNumber AS certificate_number,
            s.ValidUntil AS valid_until FROM dbo.CalibrationRecordStandards rs JOIN dbo.CalibrationStandards s ON s.StandardId=rs.StandardId
            WHERE rs.RecordId=? ORDER BY s.Code''', record_id)
        record['standards'] = rows_as_dicts(cursor)
        return record

    @app.get('/calibracion/registros')
    def list_records(instrument_id: int | None = None, start: date | None = None, end: date | None = None,
                     include_voided: bool = False, usuario_id: int = Depends(active_user)):
        def operation(cursor):
            staff_role(cursor, usuario_id)
            filters, args = [], []
            if instrument_id:
                filters.append('r.InstrumentId=?'); args.append(instrument_id)
            if start:
                filters.append('r.PerformedOn>=?'); args.append(start)
            if end:
                filters.append('r.PerformedOn<=?'); args.append(end)
            if not include_voided:
                filters.append('r.Voided=0')
            where = f"WHERE {' AND '.join(filters)}" if filters else ''
            cursor.execute(f'SELECT TOP 500 {record_columns} {record_from} {where} ORDER BY r.PerformedOn DESC, r.RecordId DESC', *args)
            return [{**item, 'voided': bool(item['voided'])} for item in rows_as_dicts(cursor)]
        return run(operation, 'No se pudieron consultar los registros.')

    @app.get('/calibracion/registros/{record_id}')
    def get_record(record_id: int, usuario_id: int = Depends(active_user)):
        def operation(cursor):
            staff_role(cursor, usuario_id)
            return load_record(cursor, record_id)
        return run(operation, 'No se pudo consultar el registro.')

    @app.post('/calibracion/registros', status_code=201)
    def create_record(data: RecordWrite, usuario_id: int = Depends(active_user)):
        def operation(cursor):
            role = staff_role(cursor, usuario_id)
            if data.performed_on > today():
                raise HTTPException(422, 'La fecha de ejecución no puede ser futura.')
            instrument = cursor.execute('SELECT InstrumentType, Emp FROM dbo.CalibrationInstruments WHERE InstrumentId=? AND Active=1',
                                        data.instrument_id).fetchone()
            if not instrument:
                raise HTTPException(404, 'Instrumento no encontrado o inactivo.')
            instrument_type, instrument_emp = instrument[0], instrument[1]

            # Orden publicada: la indicada o, si se registra desde el plan, la orden abierta más antigua.
            order_sql = '''SELECT OrderId, PlanId, InstrumentId, ControlMethod, Status, AssigneeType, AssignedUserId, ResponsibleGroup,
                ScheduledDate FROM dbo.CalibrationOrders WHERE '''
            order = None
            if data.order_id is not None:
                order = cursor.execute(order_sql + 'OrderId=?', data.order_id).fetchone()
                if not order or order[2] != data.instrument_id:
                    raise HTTPException(422, 'La orden no corresponde al instrumento.')
            elif data.plan_id is not None:
                order = cursor.execute(order_sql + "PlanId=? AND Status IN ('PROGRAMADA','NO_CONFORME') ORDER BY ScheduledDate, OrderId",
                                       data.plan_id).fetchone()
            if order:
                if order[4] not in OPEN_ORDER:
                    raise HTTPException(409, 'La orden ya está cerrada o cancelada.')
                if not can_execute(role, usuario_id, dict(assignee_type=order[5], assigned_user_id=order[6], responsible_group=order[7])):
                    raise HTTPException(403, 'Esta calibración está asignada a otro responsable.')
            plan_id = order[1] if order else data.plan_id
            plan = None
            if plan_id is not None:
                plan = cursor.execute('''SELECT ControlMethod, FrequencyEvery, FrequencyUnit, NextDue FROM dbo.CalibrationPlans
                    WHERE PlanId=? AND InstrumentId=?''', plan_id, data.instrument_id).fetchone()
                if not plan:
                    raise HTTPException(422, 'El plan no pertenece al instrumento.')
            method = order[3] if order else plan[0] if plan else data.control_method
            if not method:
                raise HTTPException(422, 'Selecciona el método de control.')
            external = method == 'CALIBRACION_EXTERNA'

            if not external and not data.points:
                raise HTTPException(422, 'Registra al menos un punto de medición.')
            if external and not clean(data.certificate_number):
                raise HTTPException(422, 'La calibración externa requiere el número de certificado o informe (MT/03 8.1.3).')
            standard_ids = sorted(set(data.standard_ids))
            if not external and not standard_ids:
                raise HTTPException(422, 'Selecciona los patrones utilizados (trazabilidad, política 5.3).')
            if standard_ids:
                marks = ','.join('?' * len(standard_ids))
                rows = cursor.execute(f'''SELECT StandardId, Code, Active, ValidUntil FROM dbo.CalibrationStandards
                    WHERE StandardId IN ({marks})''', *standard_ids).fetchall()
                if len(rows) != len(standard_ids):
                    raise HTTPException(422, 'Uno o más patrones no existen.')
                invalid = [row[1] for row in rows if not row[2] or (row[3] and row[3] < data.performed_on)]
                if invalid:
                    raise HTTPException(422, f"Patrones inactivos o con calibración vencida: {', '.join(invalid)}.")

            evaluated = []
            for position, point in enumerate(data.points, start=1):
                emp = point.emp if point.emp is not None else instrument_emp
                error, conforms = evaluate_point(point.reference_value, point.measured_value, emp)
                evaluated.append((position, point.label.strip(), point.reference_value, point.measured_value, error, emp, conforms))
            if evaluated:
                result = 'CONFORME' if all(item[6] for item in evaluated) else 'NO_CONFORME'
            elif data.result:
                result = data.result
            else:
                raise HTTPException(422, 'Indica el resultado del certificado externo.')
            if result == 'NO_CONFORME' and data.action_taken == 'NINGUNA':
                raise HTTPException(422, 'Un resultado no conforme requiere una acción (MT/03 6.2.5).')

            record_id = cursor.execute('''INSERT INTO dbo.CalibrationRecords(InstrumentId,PlanId,OrderId,ControlMethod,FormatCode,ScheduledFor,
                PerformedOn,Result,ActionTaken,AreaResponsible,ExternalProvider,CertificateNumber,Observations,RegisteredBy)
                OUTPUT INSERTED.RecordId VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)''',
                data.instrument_id, plan_id, order[0] if order else None, method, format_code(instrument_type, method),
                order[8] if order else data.scheduled_for or (plan[3] if plan else None), data.performed_on, result, data.action_taken,
                clean(data.area_responsible), clean(data.external_provider), clean(data.certificate_number),
                clean(data.observations), usuario_id).fetchone()[0]
            for item in evaluated:
                cursor.execute('''INSERT INTO dbo.CalibrationRecordPoints(RecordId,Position,Label,ReferenceValue,MeasuredValue,Error,Emp,Conforms)
                    VALUES(?,?,?,?,?,?,?,?)''', record_id, *item)
            for standard_id in standard_ids:
                cursor.execute('INSERT INTO dbo.CalibrationRecordStandards(RecordId,StandardId) VALUES(?,?)', record_id, standard_id)

            out_of_use = data.action_taken in ('RETIRO', 'REEMPLAZO')
            cursor.execute('UPDATE dbo.CalibrationInstruments SET Status=? WHERE InstrumentId=?', 'FUERA_DE_USO' if out_of_use else result, data.instrument_id)
            if order:
                # Un no conforme deja la orden abierta para repetir la verificación después del ajuste (MT/03 6.1.2, paso 6).
                status = 'FUERA_DE_USO' if out_of_use else 'REALIZADA' if result == 'CONFORME' else 'NO_CONFORME'
                cursor.execute('''UPDATE dbo.CalibrationOrders SET Status=?, ClosedAt=CASE WHEN ? IN ('REALIZADA','FUERA_DE_USO')
                    THEN SYSDATETIME() ELSE NULL END WHERE OrderId=?''', status, status, order[0])
            elif plan and result == 'CONFORME':
                # Registro de un ciclo no publicado: se da por ejecutado y el plan avanza.
                following = add_frequency(data.performed_on, plan[1], plan[2])
                if following > plan[3]:
                    cursor.execute('UPDATE dbo.CalibrationPlans SET NextDue=? WHERE PlanId=?', following, plan_id)
            return load_record(cursor, record_id)
        return run(operation, 'No se pudo guardar el registro.')

    @app.post('/calibracion/registros/{record_id}/revisar')
    def review_record(record_id: int, usuario_id: int = Depends(admin_user)):
        def operation(cursor):
            cursor.execute('''UPDATE dbo.CalibrationRecords SET ReviewedBy=?, ReviewedAt=SYSDATETIME()
                WHERE RecordId=? AND Voided=0 AND ReviewedAt IS NULL''', usuario_id, record_id)
            if cursor.rowcount == 0:
                raise HTTPException(409, 'El registro no existe, está anulado o ya fue revisado.')
            return load_record(cursor, record_id)
        return run(operation, 'No se pudo revisar el registro.')

    @app.post('/calibracion/registros/{record_id}/anular')
    def void_record(record_id: int, data: ReasonWrite, usuario_id: int = Depends(admin_user)):
        def operation(cursor):
            row = cursor.execute('SELECT OrderId FROM dbo.CalibrationRecords WHERE RecordId=? AND Voided=0', record_id).fetchone()
            if not row:
                raise HTTPException(409, 'El registro no existe o ya está anulado.')
            cursor.execute('UPDATE dbo.CalibrationRecords SET Voided=1, VoidReason=? WHERE RecordId=?', data.reason.strip(), record_id)
            if row[0]:
                # La orden vuelve a quedar abierta para registrar nuevamente.
                cursor.execute('''UPDATE dbo.CalibrationOrders SET Status='PROGRAMADA', ClosedAt=NULL
                    WHERE OrderId=? AND Status<>'CANCELADA' AND NOT EXISTS (SELECT 1 FROM dbo.CalibrationRecords r WHERE r.OrderId=? AND r.Voided=0)''',
                               row[0], row[0])
            return load_record(cursor, record_id)
        return run(operation, 'No se pudo anular el registro.')

    # ---------- Calendario y resumen ----------
    @app.get('/calibracion/calendario')
    def calibration_calendar(start: date, end: date, usuario_id: int = Depends(active_user)):
        if end < start or (end - start).days > 92:
            raise HTTPException(422, 'El rango del calendario debe ser de hasta 92 días.')

        def operation(cursor):
            role = staff_role(cursor, usuario_id)
            current = today()
            events = []
            # Ciclos planificados aún no publicados (proyección desde NextDue).
            for instrument in load_instruments(cursor):
                if not instrument['active']:
                    continue
                for plan in instrument['plans']:
                    base = dict(kind='PLANIFICADA', instrument_id=instrument['id'], instrument_code=instrument['code'],
                                instrument_name=instrument['name'], instrument_type=instrument['instrument_type'], area=instrument['area'],
                                plant_name=instrument['plant_name'], plan_id=plan['id'], activity_name=plan['activity_name'],
                                control_method=plan['control_method'], responsible_group=plan['responsible_group'],
                                assignee=plan['assignee'], assignee_type=plan['assignee_type'], assigned_user_id=plan['assigned_user_id'],
                                format_code=plan['format_code'], time=plan['start_time'])
                    for occurrence in project_occurrences(plan['next_due'], plan['frequency_every'], plan['frequency_unit'], start, end):
                        state = 'VENCIDA' if occurrence == plan['next_due'] and occurrence < current else 'PROYECTADA'
                        events.append({**base, 'date': occurrence, 'state': state})
            # Órdenes publicadas.
            cursor.execute(f"SELECT {order_columns} {order_from} WHERE o.Status<>'CANCELADA' AND o.ScheduledDate BETWEEN ? AND ?", start, end)
            for order in (order_state(item, role, usuario_id) for item in rows_as_dicts(cursor)):
                state = {'REALIZADA': 'REALIZADA', 'FUERA_DE_USO': 'REALIZADA', 'NO_CONFORME': 'NO_CONFORME'}.get(order['status'],
                                                                                                                   'VENCIDA' if order['overdue'] else 'PENDIENTE')
                events.append(dict(kind='ORDEN', order_id=order['id'], record_id=order['last_record_id'], plan_id=order['plan_id'],
                                   instrument_id=order['instrument_id'], instrument_code=order['instrument_code'],
                                   instrument_name=order['instrument_name'], instrument_type=order['instrument_type'], area=order['area'],
                                   plant_name=order['plant_name'], activity_name=order['activity_name'], control_method=order['control_method'],
                                   responsible_group=order['responsible_group'], assignee=order['assignee'], assignee_type=order['assignee_type'],
                                   assigned_user_id=order['assigned_user_id'], format_code=order['format_code'], date=order['scheduled_date'],
                                   time=order['start_time'], state=state, rescheduled=order['rescheduled'], can_execute=order['can_execute'],
                                   result='NO_CONFORME' if order['status'] == 'NO_CONFORME' else None))
            # Registros sin orden (evaluaciones eventuales o ciclos registrados antes de publicar).
            cursor.execute('''SELECT r.RecordId AS record_id, r.InstrumentId AS instrument_id, i.Code AS instrument_code,
                i.Name AS instrument_name, i.InstrumentType AS instrument_type, i.Area AS area, r.PlanId AS plan_id,
                r.ControlMethod AS control_method, r.FormatCode AS format_code, r.PerformedOn AS date, r.Result AS result
                FROM dbo.CalibrationRecords r JOIN dbo.CalibrationInstruments i ON i.InstrumentId=r.InstrumentId
                WHERE r.Voided=0 AND r.OrderId IS NULL AND r.PerformedOn BETWEEN ? AND ?''', start, end)
            events += [{**item, 'kind': 'REGISTRO', 'state': 'REALIZADA'} for item in rows_as_dicts(cursor)]
            return sorted(events, key=lambda item: (item['date'], str(item.get('time') or ''), item['instrument_code']))
        return run(operation, 'No se pudo consultar el calendario de calibración.')

    @app.get('/calibracion/resumen')
    def calibration_summary(usuario_id: int = Depends(active_user)):
        def operation(cursor):
            role = staff_role(cursor, usuario_id)
            current = today()
            unpublished = cursor.execute('''SELECT COUNT(*) FROM dbo.CalibrationPlans p JOIN dbo.CalibrationInstruments i ON i.InstrumentId=p.InstrumentId
                WHERE p.Active=1 AND i.Active=1 AND p.NextDue <= DATEADD(DAY, 7, CAST(? AS DATE))''', current).fetchone()[0]
            cursor.execute(f"SELECT {order_columns} {order_from} WHERE o.Status IN ('PROGRAMADA','NO_CONFORME')")
            orders = [order_state(item, role, usuario_id) for item in rows_as_dicts(cursor)]
            nonconforming = cursor.execute("SELECT COUNT(*) FROM dbo.CalibrationInstruments WHERE Active=1 AND Status='NO_CONFORME'").fetchone()[0]
            expired = cursor.execute('SELECT COUNT(*) FROM dbo.CalibrationStandards WHERE Active=1 AND ValidUntil < ?', current).fetchone()[0]
            pending_review = cursor.execute('SELECT COUNT(*) FROM dbo.CalibrationRecords WHERE Voided=0 AND ReviewedAt IS NULL').fetchone()[0]
            return dict(overdue=sum(order['overdue'] for order in orders), open_orders=len(orders),
                        mine=sum(1 for order in orders if can_execute(role if role != 'ADMIN' else 'X', usuario_id, order)),
                        to_publish=unpublished, nonconforming=nonconforming, expired_standards=expired, pending_review=pending_review)
        return run(operation, 'No se pudo consultar el resumen de calibración.')
