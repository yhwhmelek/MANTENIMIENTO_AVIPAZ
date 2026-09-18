"""Solicitudes, entrega y recepcion. Fechas operativas en hora local de Ecuador (UTC-5)."""
import json
import base64
import binascii
import os
import re
from contextlib import closing
from datetime import datetime, timedelta, timezone
from decimal import Decimal
from pathlib import Path
from typing import Literal
from uuid import uuid4

import pyodbc
from fastapi import Depends, HTTPException
from fastapi.responses import FileResponse
from pydantic import BaseModel, Field, ConfigDict, model_validator
from parts_history import records
from request_priority import NIC, decorate, backlog_key, register_priority, require_planned


def local_now():
    return datetime.now(timezone(timedelta(hours=-5))).replace(tzinfo=None, microsecond=0)


class StrictModel(BaseModel):
    model_config = ConfigDict(extra='forbid', str_strip_whitespace=True)


class TechnicalEvaluation(StrictModel):
    affects_food_safety: bool
    requires_shutdown: bool
    requires_training: bool
    improves_safety: bool
    food_safety_notes: str = Field(default='', max_length=500)
    shutdown_notes: str = Field(default='', max_length=500)
    training_notes: str = Field(default='', max_length=500)
    safety_notes: str = Field(default='', max_length=500)


class Preevaluation(StrictModel):
    n: int | None = Field(default=None, ge=1, le=4, strict=True)
    i: int | None = Field(default=None, ge=1, le=4, strict=True)
    c: int | None = Field(default=None, ge=1, le=4, strict=True)


class RequestedPart(StrictModel):
    spare_part_id: int = Field(gt=0)
    quantity: Decimal = Field(gt=0, max_digits=10, decimal_places=2)


class RequestWrite(StrictModel):
    image_data: str | None = Field(default=None, max_length=14_000_000)
    plant_id: int | None = Field(default=None, gt=0)
    tower_id: int | None = Field(default=None, gt=0)
    preevaluation: Preevaluation | None = None
    requested_parts: list[RequestedPart] = Field(default_factory=list, max_length=30)
    equipment_stopped: bool = False
    benefits: list[Literal['SEGURIDAD', 'PRODUCCION', 'CALIDAD', 'AMBIENTE', 'ERGONOMIA', 'COSTOS', 'CONFIABILIDAD', 'LEGAL']] = Field(default_factory=list, max_length=8)
    benefit_notes: str = Field(default='', max_length=1000)
    machine_id: int | None = Field(default=None, gt=0)
    description: str = Field(min_length=1, max_length=1000)
    maintenance_type: Literal['PREVENTIVO', 'CORRECTIVO', 'MEJORA_TECNICA']
    requesting_area: str = Field(default='', max_length=150)
    target_area: str = Field(default='', max_length=200)
    improvement_proposal: str = Field(default='', max_length=2000)
    technical_evaluation: TechnicalEvaluation | None = None
    urgency: int | None = Field(default=None, ge=1, le=4)
    impact: int | None = Field(default=None, ge=1, le=4)
    risk: int | None = Field(default=None, ge=1, le=4)
    failure: bool = False
    detected_at: datetime = Field(default_factory=local_now)
    stopped_at: datetime | None = None
    planned_start: datetime | None = None
    planned_end: datetime | None = None
    hour_meter: Decimal | None = Field(default=None, ge=0, max_digits=12, decimal_places=2)
    requested_part_id: int | None = Field(default=None, gt=0)
    requested_quantity: Decimal | None = Field(default=None, gt=0, max_digits=10, decimal_places=2)

    @model_validator(mode='after')
    def validate_request(self):
        if self.tower_id is not None and self.plant_id is None:
            raise ValueError("Selecciona la planta de la torre")
        if self.maintenance_type != 'MEJORA_TECNICA' and self.plant_id is not None and self.tower_id is None:
            raise ValueError("Selecciona una torre")
        if len({p.spare_part_id for p in self.requested_parts}) != len(self.requested_parts):
            raise ValueError('Agrupa la cantidad de cada repuesto previsto en una sola fila')
        if self.requested_parts and self.requested_part_id is not None:
            raise ValueError('Usa la lista de repuestos o el campo anterior, no ambos')
        if self.maintenance_type == 'MEJORA_TECNICA':
            if not self.requesting_area or not self.improvement_proposal:
                raise ValueError('Completa el area solicitante y la propuesta')
            if not self.benefits and not self.benefit_notes:
                raise ValueError('Indica el beneficio o resultado esperado de la mejora')
            if self.machine_id is None and not self.target_area:
                raise ValueError('Selecciona una maquina o indica el equipo, sistema o area de la mejora')
        elif self.machine_id is None:
            raise ValueError('Selecciona una maquina para la solicitud de mantenimiento')
        for value in (self.detected_at, self.stopped_at, self.planned_start, self.planned_end):
            if value and value.tzinfo is not None:
                raise ValueError('Usa fechas locales de Ecuador sin zona horaria')
        if self.stopped_at and self.stopped_at > local_now():
            raise ValueError('La parada no puede ser futura')
        if self.equipment_stopped and self.stopped_at is None:
            raise ValueError('Si el equipo esta parado, registra el inicio real de la parada')
        if self.detected_at > local_now():
            raise ValueError('La deteccion del daño no puede ser futura')
        if (self.planned_start is None) != (self.planned_end is None):
            raise ValueError('Completa ambas fechas planificadas')
        if self.planned_start and self.planned_end <= self.planned_start:
            raise ValueError('El fin planificado debe ser posterior al inicio')
        if self.failure and self.maintenance_type != 'CORRECTIVO':
            raise ValueError('Una falla debe registrarse como correctiva')
        if (self.requested_part_id is None) != (self.requested_quantity is None):
            raise ValueError('Completa el repuesto previsto y su cantidad')
        return self


class PartUsed(StrictModel):
    spare_part_id: int = Field(gt=0)
    quantity: Decimal = Field(gt=0, max_digits=10, decimal_places=2)
    removed_part: str = Field(default='', max_length=150)
    position: str = Field(default='', max_length=150)


class ToolReconciliation(StrictModel):
    description: str = Field(min_length=1, max_length=100)
    quantity_in: int = Field(ge=0, le=10000)
    quantity_out: int = Field(ge=0, le=10000)


class CompleteWrite(StrictModel):
    improvement_result: str = Field(default='', max_length=2000)
    other_materials: str = Field(default='', max_length=2000)
    repair_started_at: datetime
    repair_finished_at: datetime
    stopped_at: datetime | None = None
    restored_at: datetime | None = None
    work_done: str = Field(min_length=1, max_length=2000)
    cause: str | None = Field(default=None, max_length=1000)
    recommendations: str | None = Field(default=None, max_length=1000)
    delivery_conditions: str | None = Field(default=None, max_length=1000)
    hour_meter: Decimal | None = Field(default=None, ge=0, max_digits=12, decimal_places=2)
    waiting_parts_minutes: int = Field(default=0, ge=0, le=525600)
    parts: list[PartUsed] = Field(default_factory=list, max_length=30)
    tools: list[ToolReconciliation] = Field(default_factory=list, max_length=20)

    @model_validator(mode='after')
    def validate_times(self):
        for field in ('cause', 'recommendations', 'delivery_conditions'):
            setattr(self, field, getattr(self, field) or None)
        for value in (self.repair_started_at, self.repair_finished_at, self.stopped_at, self.restored_at):
            if value and value.tzinfo is not None:
                raise ValueError('Usa fechas locales de Ecuador sin zona horaria')
            if value and value > local_now():
                raise ValueError('Los tiempos reales no pueden ser futuros')
        if self.repair_finished_at <= self.repair_started_at:
            raise ValueError('El fin de reparacion debe ser posterior al inicio')
        if (self.stopped_at is None) != (self.restored_at is None):
            raise ValueError('Completa inicio de parada y retorno a servicio')
        if self.stopped_at and (self.restored_at < self.repair_finished_at or self.stopped_at > self.repair_started_at):
            raise ValueError('La parada debe contener el intervalo de reparacion')
        if len({p.spare_part_id for p in self.parts}) != len(self.parts):
            raise ValueError('Agrupa la cantidad de cada repuesto en una sola fila')
        interval = (self.restored_at - self.stopped_at) if self.stopped_at else (self.repair_finished_at - self.repair_started_at)
        if self.waiting_parts_minutes > interval.total_seconds() / 60:
            raise ValueError('La espera por repuestos no puede superar el intervalo de trabajo o parada')
        return self


class ReceiptWrite(StrictModel):
    notes: str | None = Field(default='Entrega conforme', max_length=1000)

    @model_validator(mode='after')
    def default_receipt_notes(self):
        self.notes = self.notes or 'Entrega conforme'
        return self


class ImportedImprovement(StrictModel):
    source_key: str = Field(pattern=r'^SANTAFE-HACCP-2026-\d{2}$')
    source_sheet: str
    source_requester: str
    requested_at: datetime
    requesting_area: str = Field(min_length=1, max_length=150)
    target_area: str = Field(min_length=1, max_length=200)
    description: str = Field(min_length=1, max_length=1000)
    improvement_proposal: str = Field(min_length=1, max_length=2000)
    technical_evaluation: TechnicalEvaluation


class ImprovementUpdate(StrictModel):
    image_data: str | None = Field(default=None, max_length=14_000_000)
    plant_id: int = Field(gt=0)
    tower_id: int | None = Field(default=None, gt=0)
    machine_id: int | None = Field(default=None, gt=0)
    detected_at: datetime
    preevaluation: Preevaluation | None = None
    requesting_area: str = Field(min_length=1, max_length=150)
    target_area: str = Field(min_length=1, max_length=200)
    description: str = Field(min_length=1, max_length=1000)
    improvement_proposal: str = Field(min_length=1, max_length=2000)
    technical_evaluation: TechnicalEvaluation
    benefits: list[Literal['SEGURIDAD', 'PRODUCCION', 'CALIDAD', 'AMBIENTE', 'ERGONOMIA', 'COSTOS', 'CONFIABILIDAD', 'LEGAL']] = Field(default_factory=list)
    benefit_notes: str = Field(default='', max_length=1000)

    @model_validator(mode='after')
    def validate_location(self):
        if self.machine_id is not None and self.tower_id is None:
            raise ValueError('Selecciona la torre de la máquina')
        if self.detected_at.tzinfo is not None or self.detected_at > local_now():
            raise ValueError('La fecha de detección debe ser una hora local pasada')
        return self


def request_image_directory():
    return Path(os.getenv('REQUEST_IMAGE_DIR', str(Path(__file__).parent / 'uploads' / 'solicitudes'))).resolve()


def save_request_image(image_data):
    match = re.fullmatch(r'data:image/(jpeg|png|webp);base64,([A-Za-z0-9+/=]+)', image_data or '')
    if not match:
        raise HTTPException(422, 'La foto debe ser JPG, PNG o WEBP')
    try:
        content = base64.b64decode(match.group(2), validate=True)
    except (binascii.Error, ValueError):
        raise HTTPException(422, 'La foto no es válida')
    signatures = {'jpeg': (b'\xff\xd8\xff',), 'png': (b'\x89PNG\r\n\x1a\n',), 'webp': (b'RIFF',)}
    kind = match.group(1)
    valid = any(content.startswith(prefix) for prefix in signatures[kind])
    if kind == 'webp':
        valid = valid and content[8:12] == b'WEBP'
    if not valid or len(content) > 10 * 1024 * 1024:
        raise HTTPException(422, 'La foto no es válida o supera 10 MB')
    extension = {'jpeg': '.jpg', 'png': '.png', 'webp': '.webp'}[kind]
    path = request_image_directory() / f'{uuid4().hex}{extension}'
    try:
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(content)
    except OSError:
        raise HTTPException(503, 'No se pudo guardar la foto en el servidor')
    return str(path)


class OperatingPeriodWrite(StrictModel):
    machine_id: int = Field(gt=0)
    starts_at: datetime
    ends_at: datetime
    scheduled_hours: Decimal = Field(gt=0, max_digits=12, decimal_places=2)
    operating_hours: Decimal = Field(ge=0, max_digits=12, decimal_places=2)
    notes: str = Field(min_length=1, max_length=500)

    @model_validator(mode='after')
    def validate_period(self):
        if self.starts_at.tzinfo or self.ends_at.tzinfo:
            raise ValueError('Usa hora local de Ecuador')
        if self.ends_at <= self.starts_at or self.ends_at > local_now():
            raise ValueError('Registra un periodo finalizado con fin posterior al inicio')
        if self.operating_hours > self.scheduled_hours or float(self.scheduled_hours) > (self.ends_at-self.starts_at).total_seconds()/3600:
            raise ValueError('Las horas operadas no pueden superar las programadas ni la duracion del periodo')
        return self


SELECT = '''SELECT r.RequestId AS id, r.MachineId AS machine_id,
    r.RequestedBy AS requested_by, r.RequestedAt AS requested_at, r.Status AS status,
    r.RequestData AS request_data, r.AssignedTo AS assigned_to, r.AcceptedAt AS accepted_at,
    r.CompletedAt AS completed_at, r.ExecutionData AS execution_data,
    r.MaintenanceEventId AS maintenance_event_id, r.ReceivedAt AS received_at,
    r.ReceiptNotes AS receipt_notes, r.ReceivedBy AS received_by,
    COALESCE(NULLIF(LTRIM(RTRIM(CONCAT(u.Nombres, ' ', u.Apellidos))), ''), u.Nombre) AS requester_name,
    COALESCE(NULLIF(LTRIM(RTRIM(CONCAT(a.Nombres, ' ', a.Apellidos))), ''), a.Nombre) AS assignee_name,
    COALESCE(NULLIF(LTRIM(RTRIM(CONCAT(receiver.Nombres, ' ', receiver.Apellidos))), ''), receiver.Nombre) AS receiver_name,
    COALESCE(NULLIF(LTRIM(RTRIM(CONCAT(executor.Nombres, ' ', executor.Apellidos))), ''), executor.Nombre) AS executor_name
    FROM dbo.MaintenanceRequests r JOIN dbo.Usuarios u ON u.Id=r.RequestedBy
    LEFT JOIN dbo.Usuarios a ON a.Id=r.AssignedTo
    LEFT JOIN dbo.Usuarios receiver ON receiver.Id=r.ReceivedBy
    LEFT JOIN dbo.MaintenanceEvents event ON event.MaintenanceEventId=r.MaintenanceEventId
    LEFT JOIN dbo.Usuarios executor ON executor.Id=event.CreatedBy'''


def decode(row, user_names=None):
    row['request_data'] = json.loads(row['request_data'])
    row['execution_data'] = json.loads(row['execution_data']) if row['execution_data'] else None
    if user_names:
        data = row['request_data']
        for key in ('priority_validation', 'planning'):
            entry = data.get(key)
            if isinstance(entry, dict) and entry.get('by') in user_names:
                entry['name'] = user_names[entry['by']]
        for key in ('priority_history', 'planning_history'):
            for entry in data.get(key) or []:
                if isinstance(entry, dict) and entry.get('by') in user_names:
                    entry['name'] = user_names[entry['by']]
    return decorate(row)


def part_stock(cursor, part_id):
    # Misma fecha de corte que las alertas; bloquea el repuesto durante el consumo.
    part = cursor.execute('SELECT InternalCode, Description, UnitOfMeasure FROM dbo.SpareParts WITH (UPDLOCK, HOLDLOCK) WHERE SparePartId=? AND Active=1', part_id).fetchone()
    if part is None:
        raise HTTPException(422, 'Selecciona un repuesto activo')
    opening = cursor.execute('SELECT CutoffDate, Quantity FROM dbo.SparePartOpeningBalances WITH (HOLDLOCK) WHERE SparePartId=?', part_id).fetchone()
    cutoff, quantity = (opening[0], Decimal(opening[1])) if opening else (None, Decimal(0))
    purchase = cursor.execute('SELECT COALESCE(SUM(Quantity),0) FROM dbo.SparePartPurchases WITH (HOLDLOCK) WHERE SparePartId=? AND VoidedAt IS NULL' + (' AND PurchasedOn>?' if cutoff else ''), *([part_id, cutoff] if cutoff else [part_id])).fetchone()[0]
    used = cursor.execute('''SELECT COALESCE(SUM(c.Quantity),0) FROM dbo.MaintenancePartsUsed c WITH (HOLDLOCK)
        JOIN dbo.MaintenanceEvents e ON e.MaintenanceEventId=c.MaintenanceEventId
        WHERE c.SparePartId=? AND c.VoidedAt IS NULL''' + (' AND e.PerformedOn>?' if cutoff else ''), *([part_id, cutoff] if cutoff else [part_id])).fetchone()[0]
    return part, quantity + Decimal(purchase) - Decimal(used), cutoff


def register_maintenance_requests(app, connect, active_user, admin_user):
    def write(operation):
        try:
            with closing(connect()) as connection:
                try:
                    result = operation(connection.cursor())
                    connection.commit()
                    return result
                except Exception:
                    connection.rollback()
                    raise
        except pyodbc.IntegrityError:
            raise HTTPException(409, 'La solicitud cambio o contiene referencias no validas. Actualiza el listado.')
        except (pyodbc.Error, RuntimeError):
            raise HTTPException(503, 'No se pudo guardar la solicitud. Verifica las migraciones 005 y 006 y la conexion.')

    def locked(cursor, request_id):
        row = cursor.execute('SELECT RequestedBy, AssignedTo, Status, RequestData, AcceptedAt FROM dbo.MaintenanceRequests WITH (UPDLOCK, HOLDLOCK) WHERE RequestId=?', request_id).fetchone()
        if row is None:
            raise HTTPException(404, 'Solicitud no encontrada')
        return row

    def delete_flow(cursor, request_id=None, event_id=None):
        if request_id is not None:
            row = cursor.execute('SELECT MaintenanceEventId FROM dbo.MaintenanceRequests WITH (UPDLOCK,HOLDLOCK) WHERE RequestId=?', request_id).fetchone()
            if row is None:
                raise HTTPException(404, 'Solicitud no encontrada')
            event_id = row[0]
        else:
            row = cursor.execute('SELECT RequestId FROM dbo.MaintenanceRequests WITH (UPDLOCK,HOLDLOCK) WHERE MaintenanceEventId=?', event_id).fetchone()
            request_id = row[0] if row else None
        if event_id is not None:
            if not cursor.execute('SELECT MaintenanceEventId FROM dbo.MaintenanceEvents WITH (UPDLOCK,HOLDLOCK) WHERE MaintenanceEventId=?', event_id).fetchone():
                raise HTTPException(404, 'Intervencion no encontrada')
        if request_id is not None:
            cursor.execute('DELETE FROM dbo.MaintenanceRequests WHERE RequestId=?', request_id)
        if event_id is not None:
            cursor.execute('DELETE FROM dbo.MaintenancePartsUsed WHERE MaintenanceEventId=?', event_id)
            cursor.execute('DELETE FROM dbo.MaintenanceEvents WHERE MaintenanceEventId=?', event_id)
        return {'deleted': True}

    @app.delete('/intervenciones/{event_id}')
    def delete_intervention(event_id: int, usuario_id: int = Depends(admin_user)):
        return write(lambda cursor: delete_flow(cursor, event_id=event_id))

    @app.delete('/solicitudes-mantenimiento/{request_id}')
    def delete_request(request_id: int, usuario_id: int = Depends(admin_user)):
        return write(lambda cursor: delete_flow(cursor, request_id=request_id))

    @app.get('/periodos-operacion')
    def list_periods(usuario_id: int = Depends(active_user)):
        try:
            with closing(connect()) as connection:
                cursor = connection.cursor()
                cursor.execute('''SELECT p.OperatingPeriodId AS id, p.MachineId AS machine_id,
                    m.AssetCode AS machine_code, p.StartsAt AS starts_at, p.EndsAt AS ends_at,
                    p.ScheduledHours AS scheduled_hours, p.OperatingHours AS operating_hours,
                    p.Notes AS notes FROM dbo.MachineOperatingPeriods p
                    JOIN dbo.Machines m ON m.MachineId=p.MachineId ORDER BY p.StartsAt DESC''')
                return records(cursor)
        except (pyodbc.Error, RuntimeError):
            raise HTTPException(503, 'No se pudieron consultar los periodos. Verifica las migraciones 005 y 006.')

    @app.post('/periodos-operacion', status_code=201)
    def create_period(data: OperatingPeriodWrite, usuario_id: int = Depends(active_user)):
        def operation(cursor):
            role = cursor.execute('SELECT Rol FROM dbo.Usuarios WHERE Id=? AND Activo=1', usuario_id).fetchone()
            if not role or role[0] not in ('ADMIN','OPERADOR'):
                raise HTTPException(403, 'Solo operadores y administradores pueden registrar periodos')
            if not cursor.execute('SELECT MachineId FROM dbo.Machines WITH (UPDLOCK,HOLDLOCK) WHERE MachineId=?', data.machine_id).fetchone():
                raise HTTPException(422, 'Maquina no encontrada')
            if cursor.execute('SELECT OperatingPeriodId FROM dbo.MachineOperatingPeriods WITH (UPDLOCK,HOLDLOCK) WHERE MachineId=? AND StartsAt<? AND EndsAt>?', data.machine_id, data.ends_at, data.starts_at).fetchone():
                raise HTTPException(409, 'El periodo se superpone con otro registrado para esta maquina')
            cursor.execute('''INSERT INTO dbo.MachineOperatingPeriods
                (MachineId,StartsAt,EndsAt,ScheduledHours,OperatingHours,Notes,CreatedBy,CreatedAt)
                VALUES (?,?,?,?,?,?,?,?)''', data.machine_id, data.starts_at, data.ends_at,
                data.scheduled_hours, data.operating_hours, data.notes, usuario_id, local_now())
            return {'saved': True}
        return write(operation)

    @app.get('/solicitudes-mantenimiento')
    def list_requests(usuario_id: int = Depends(active_user)):
        try:
            with closing(connect()) as connection:
                cursor = connection.cursor()
                cursor.execute(SELECT + ' ORDER BY r.RequestId DESC')
                rows = records(cursor)
                if not rows:
                    return []
                cursor.execute("SELECT Id, COALESCE(NULLIF(LTRIM(RTRIM(CONCAT(Nombres, ' ', Apellidos))), ''), Nombre) FROM dbo.Usuarios")
                names = {user_id: name for user_id, name in cursor.fetchall()}
                return [decode(row, names) for row in rows]
        except (pyodbc.Error, RuntimeError):
            raise HTTPException(503, 'No se pudieron consultar las solicitudes. Verifica las migraciones 005 y 006.')

    @app.get('/actividades-priorizadas')
    def prioritized_activities(usuario_id: int = Depends(active_user)):
        return sorted((row for row in list_requests(usuario_id) if row['status'] != 'CERRADA'), key=backlog_key)

    register_priority(app, write, locked, admin_user, local_now)

    @app.post('/solicitudes-mantenimiento/importar-santafe-haccp')
    def import_santafe_haccp(items: list[ImportedImprovement], usuario_id: int = Depends(admin_user)):
        if len(items) != 29 or len({item.source_key for item in items}) != 29:
            raise HTTPException(422, 'Se esperan las 29 hojas únicas del archivo HACCP')
        def operation(cursor):
            plant = cursor.execute("SELECT PlantId, Name FROM dbo.Plants WITH (HOLDLOCK) WHERE Name=N'Santa Fe'").fetchone()
            if not plant:
                raise HTTPException(422, 'Primero registra la planta Santa Fe')
            existing = cursor.execute("SELECT RequestData FROM dbo.MaintenanceRequests WITH (UPDLOCK,HOLDLOCK) WHERE RequestData LIKE '%SANTAFE-HACCP-2026-%'").fetchall()
            keys = {json.loads(row[0]).get('source_key') for row in existing}
            created = 0
            for item in items:
                if item.source_key in keys:
                    continue
                data = item.model_dump(mode='json')
                data.update(plant_id=plant[0], plant_name=plant[1], tower_id=None, tower_name=None,
                            machine_id=None, machine_code='N/A', machine_name=item.target_area,
                            area=item.target_area, maintenance_type='MEJORA_TECNICA',
                            detected_at=item.requested_at.isoformat(), failure=False,
                            equipment_stopped=False, benefits=[], benefit_notes='',
                            requested_parts=[], preevaluation=None)
                cursor.execute('INSERT INTO dbo.MaintenanceRequests (MachineId,RequestedBy,RequestedAt,RequestData) VALUES (NULL,?,?,?)',
                               usuario_id, item.requested_at, json.dumps(data, ensure_ascii=False))
                created += 1
            return {'created': created, 'existing': len(items)-created}
        return write(operation)

    @app.put('/solicitudes-mantenimiento/{request_id}/mejora')
    def update_improvement(request_id: int, data: ImprovementUpdate, usuario_id: int = Depends(active_user)):
        new_image = [None]
        old_image = [None]
        def operation(cursor):
            role = cursor.execute('SELECT Rol FROM dbo.Usuarios WHERE Id=? AND Activo=1', usuario_id).fetchone()
            if not role or role[0] not in ('ADMIN', 'OPERADOR'):
                raise HTTPException(403, 'Solo operadores y administradores pueden modificar solicitudes')
            row = locked(cursor, request_id)
            payload = json.loads(row[3])
            if row[2] != 'PENDIENTE' or payload.get('maintenance_type') != 'MEJORA_TECNICA':
                raise HTTPException(409, 'Solo se puede completar una mejora técnica pendiente')
            location = cursor.execute('SELECT Name FROM dbo.Plants WITH (HOLDLOCK) WHERE PlantId=?', data.plant_id).fetchone()
            if not location:
                raise HTTPException(422, 'La planta no existe')
            tower = None
            if data.tower_id is not None:
                tower = cursor.execute('SELECT Name FROM dbo.Towers WITH (HOLDLOCK) WHERE TowerId=? AND PlantId=?', data.tower_id, data.plant_id).fetchone()
                if not tower:
                    raise HTTPException(422, 'La torre no pertenece a la planta')
            machine = None
            if data.machine_id is not None:
                machine = cursor.execute('SELECT AssetCode, Name, Area FROM dbo.Machines WITH (HOLDLOCK) WHERE MachineId=? AND TowerId=?', data.machine_id, data.tower_id).fetchone()
                if not machine:
                    raise HTTPException(422, 'La máquina no pertenece a la torre')
            payload.update(data.model_dump(mode='json', exclude={'image_data'}))
            payload.update(plant_name=location[0], tower_name=tower[0] if tower else None,
                           machine_code=machine[0] if machine else 'N/A',
                           machine_name=machine[1] if machine else data.target_area,
                           area=machine[2] if machine else data.target_area)
            if data.image_data:
                new_image[0] = save_request_image(data.image_data)
                old_image[0] = payload.get('image_path')
                payload['image_path'] = new_image[0]
            cursor.execute('UPDATE dbo.MaintenanceRequests SET MachineId=?, RequestData=? WHERE RequestId=?',
                           data.machine_id, json.dumps(payload, ensure_ascii=False), request_id)
            return {'id': request_id}
        try:
            result = write(operation)
        except Exception:
            if new_image[0]:
                Path(new_image[0]).unlink(missing_ok=True)
            raise
        if old_image[0]:
            old_path = Path(old_image[0]).resolve()
            if old_path.is_relative_to(request_image_directory()):
                try:
                    old_path.unlink(missing_ok=True)
                except OSError:
                    pass
        return result

    @app.get('/solicitudes-mantenimiento/{request_id}/imagen', response_class=FileResponse)
    def request_image(request_id: int, usuario_id: int = Depends(active_user)):
        try:
            with closing(connect()) as connection:
                row = connection.cursor().execute('SELECT RequestData FROM dbo.MaintenanceRequests WHERE RequestId=?', request_id).fetchone()
        except (pyodbc.Error, RuntimeError):
            raise HTTPException(503, 'No se pudo consultar la foto')
        if not row:
            raise HTTPException(404, 'Solicitud no encontrada')
        path_value = json.loads(row[0]).get('image_path')
        if not path_value:
            raise HTTPException(404, 'La solicitud no tiene foto')
        path = Path(path_value).resolve()
        if not path.is_relative_to(request_image_directory()) or not path.is_file():
            raise HTTPException(404, 'No se encontró la foto')
        return FileResponse(path)

    @app.post('/solicitudes-mantenimiento', status_code=201)
    def create_request(data: RequestWrite, usuario_id: int = Depends(active_user)):
        new_image = [None]
        def operation(cursor):
            role = cursor.execute('SELECT Rol FROM dbo.Usuarios WHERE Id=? AND Activo=1', usuario_id).fetchone()
            if not role or role[0] not in ('ADMIN', 'OPERADOR'):
                raise HTTPException(403, 'Solo operadores y administradores pueden generar solicitudes')
            machine = cursor.execute('SELECT AssetCode, Name, Area FROM dbo.Machines WITH (HOLDLOCK) WHERE MachineId=?', data.machine_id).fetchone() if data.machine_id is not None else None
            if data.machine_id is not None and not machine:
                raise HTTPException(422, 'Maquina no encontrada')
            location = None
            if data.tower_id is not None:
                location = cursor.execute('SELECT p.Name, t.Name FROM dbo.Towers t WITH (HOLDLOCK) JOIN dbo.Plants p WITH (HOLDLOCK) ON p.PlantId=t.PlantId WHERE t.TowerId=? AND p.PlantId=?', data.tower_id, data.plant_id).fetchone()
                if not location:
                    raise HTTPException(422, 'La torre no pertenece a la planta seleccionada')
                if data.machine_id is not None and not cursor.execute('SELECT MachineId FROM dbo.Machines WITH (HOLDLOCK) WHERE MachineId=? AND TowerId=?', data.machine_id, data.tower_id).fetchone():
                    raise HTTPException(422, 'La maquina no pertenece a la torre seleccionada')
            elif data.plant_id is not None:
                location = cursor.execute('SELECT Name, NULL FROM dbo.Plants WITH (HOLDLOCK) WHERE PlantId=?', data.plant_id).fetchone()
                if not location:
                    raise HTTPException(422, 'La planta seleccionada no existe')
                if data.machine_id is not None:
                    raise HTTPException(422, 'Selecciona la torre de la máquina')
            payload = data.model_dump(mode='json', exclude={'image_data'})
            if location:
                payload.update(plant_name=location[0], tower_name=location[1])
            payload.update(machine_code=machine[0] if machine else 'N/A', machine_name=machine[1] if machine else data.target_area, area=machine[2] if machine else data.target_area)
            if data.requested_part_id:
                part, stock, _ = part_stock(cursor, data.requested_part_id)
                payload.update(requested_part_code=part[0], requested_part_name=part[1], stock_at_request=str(stock), stock_sufficient=stock >= data.requested_quantity)
            planned = data.requested_parts or ([RequestedPart(spare_part_id=data.requested_part_id, quantity=data.requested_quantity)] if data.requested_part_id else [])
            payload['requested_parts'] = []
            for item in sorted(planned, key=lambda p: p.spare_part_id):
                part, stock, _ = part_stock(cursor, item.spare_part_id)
                payload['requested_parts'].append({**item.model_dump(mode='json'), 'internal_code':part[0],
                    'description':part[1], 'unit_of_measure':part[2], 'stock_at_request':str(stock),
                    'stock_sufficient':stock >= item.quantity})
            if data.image_data:
                new_image[0] = save_request_image(data.image_data)
                payload['image_path'] = new_image[0]
            row = cursor.execute('''SET NOCOUNT ON; INSERT INTO dbo.MaintenanceRequests
                (MachineId,RequestedBy,RequestedAt,RequestData) VALUES (?,?,?,?);
                SELECT CAST(SCOPE_IDENTITY() AS int);''', data.machine_id, usuario_id, local_now(), json.dumps(payload, ensure_ascii=False)).fetchone()
            return {'id': row[0]}
        try:
            return write(operation)
        except Exception:
            if new_image[0]:
                Path(new_image[0]).unlink(missing_ok=True)
            raise

    @app.post('/solicitudes-mantenimiento/{request_id}/atender')
    def accept_request(request_id: int, usuario_id: int = Depends(admin_user)):
        def operation(cursor):
            row = locked(cursor, request_id)
            if row[2] != 'PENDIENTE':
                raise HTTPException(409, 'Esta solicitud ya fue atendida')
            require_planned(json.loads(row[3]))
            cursor.execute("UPDATE dbo.MaintenanceRequests SET Status='EN_PROCESO', AssignedTo=?, AcceptedAt=? WHERE RequestId=?", usuario_id, local_now(), request_id)
            return {'id': request_id}
        return write(operation)

    @app.post('/solicitudes-mantenimiento/{request_id}/completar')
    def complete_request(request_id: int, data: CompleteWrite, usuario_id: int = Depends(admin_user)):
        def operation(cursor):
            row = locked(cursor, request_id)
            if row[2] != 'EN_PROCESO':
                raise HTTPException(409, 'La solicitud ya fue entregada o no esta en proceso')
            original = json.loads(row[3])
            require_planned(original)
            if original['maintenance_type'] == 'MEJORA_TECNICA' and not data.improvement_result:
                raise HTTPException(422, 'Describe el resultado de la mejora tecnica')
            if data.repair_started_at < row[4].replace(second=0, microsecond=0):
                raise HTTPException(422, 'El inicio de reparacion debe ser posterior a la recepcion de la solicitud')
            if original.get('stopped_at') and data.stopped_at != datetime.fromisoformat(original['stopped_at']):
                raise HTTPException(422, 'Conserva el inicio de parada registrado por el solicitante')
            if original.get('hour_meter') is not None and (data.hour_meter is None or data.hour_meter < Decimal(original['hour_meter'])):
                raise HTTPException(422, 'El horometro final debe ser mayor o igual al inicial')
            payload = data.model_dump(mode='json')
            payload['parts'] = []
            for item in sorted(data.parts, key=lambda p: p.spare_part_id):
                part, stock, cutoff = part_stock(cursor, item.spare_part_id)
                if cutoff and data.repair_finished_at.date() <= cutoff:
                    raise HTTPException(422, 'El consumo debe ser posterior al corte del saldo inicial')
                if stock < item.quantity:
                    raise HTTPException(409, f'Stock insuficiente para {part[0]}: disponible {stock}')
                payload['parts'].append({**item.model_dump(mode='json'), 'internal_code': part[0], 'description': part[1], 'unit_of_measure': part[2], 'stock_before': str(stock)})
            event_id = cursor.execute('''SET NOCOUNT ON; INSERT INTO dbo.MaintenanceEvents
                (MachineId,PerformedOn,MaintenanceType,Description,CreatedBy) VALUES (?,?,?,?,?);
                SELECT CAST(SCOPE_IDENTITY() AS int);''', original['machine_id'], data.repair_finished_at.date(), original['maintenance_type'], f'Solicitud #{request_id}: {data.work_done}'[:500], usuario_id).fetchone()[0]
            for part in payload['parts']:
                cursor.execute('''INSERT INTO dbo.MaintenancePartsUsed
                    (MaintenanceEventId,SparePartId,Quantity,UnitOfMeasure,Position,Notes,CreatedBy)
                    VALUES (?,?,?,?,?,?,?)''', event_id, part['spare_part_id'], Decimal(part['quantity']), part['unit_of_measure'], part['position'] or None, f'Solicitud #{request_id}. Retirado: {part["removed_part"]}', usuario_id)
            cursor.execute("UPDATE dbo.MaintenanceRequests SET Status='POR_RECIBIR', CompletedAt=?, ExecutionData=?, MaintenanceEventId=? WHERE RequestId=?", local_now(), json.dumps(payload, ensure_ascii=False), event_id, request_id)
            return {'id': request_id, 'maintenance_event_id': event_id}
        return write(operation)

    @app.post('/solicitudes-mantenimiento/{request_id}/recibir')
    def receive_request(request_id: int, data: ReceiptWrite, usuario_id: int = Depends(active_user)):
        def operation(cursor):
            row = locked(cursor, request_id)
            if row[0] != usuario_id:
                role = cursor.execute('SELECT Rol FROM dbo.Usuarios WHERE Id=? AND Activo=1', usuario_id).fetchone()
                if not role or role[0] != 'ADMIN':
                    raise HTTPException(403, 'Solo el solicitante o un administrador puede confirmar la recepcion')
            if row[2] != 'POR_RECIBIR':
                raise HTTPException(409, 'La solicitud no esta pendiente de recepcion')
            cursor.execute("UPDATE dbo.MaintenanceRequests SET Status='CERRADA', ReceivedAt=?, ReceiptNotes=?, ReceivedBy=? WHERE RequestId=?", local_now(), data.notes, usuario_id, request_id)
            return {'id': request_id}
        return write(operation)
