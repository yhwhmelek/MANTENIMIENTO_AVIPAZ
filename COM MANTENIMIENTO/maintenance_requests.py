"""Solicitudes, entrega y recepcion. Fechas operativas en hora local de Ecuador (UTC-5)."""
import json
from contextlib import closing
from datetime import datetime, timedelta, timezone
from decimal import Decimal
from typing import Literal

import pyodbc
from fastapi import Depends, HTTPException
from pydantic import BaseModel, Field, ConfigDict, model_validator
from parts_history import records


def local_now():
    return datetime.now(timezone(timedelta(hours=-5))).replace(tzinfo=None, microsecond=0)


class StrictModel(BaseModel):
    model_config = ConfigDict(extra='forbid', str_strip_whitespace=True)


class RequestWrite(StrictModel):
    machine_id: int = Field(gt=0)
    description: str = Field(min_length=1, max_length=1000)
    maintenance_type: Literal['PREVENTIVO', 'CORRECTIVO']
    urgency: int = Field(ge=1, le=4)
    impact: int = Field(ge=1, le=4)
    risk: int = Field(ge=1, le=4)
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
        for value in (self.detected_at, self.stopped_at, self.planned_start, self.planned_end):
            if value and value.tzinfo is not None:
                raise ValueError('Usa fechas locales de Ecuador sin zona horaria')
        if self.stopped_at and self.stopped_at > local_now():
            raise ValueError('La parada no puede ser futura')
        if self.urgency == 4 and self.stopped_at is None:
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
    notes: str = Field(min_length=1, max_length=1000)


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
    r.ReceiptNotes AS receipt_notes, u.Nombre AS requester_name, a.Nombre AS assignee_name
    FROM dbo.MaintenanceRequests r JOIN dbo.Usuarios u ON u.Id=r.RequestedBy
    LEFT JOIN dbo.Usuarios a ON a.Id=r.AssignedTo'''


def decode(row):
    row['request_data'] = json.loads(row['request_data'])
    row['execution_data'] = json.loads(row['execution_data']) if row['execution_data'] else None
    return row


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


def register_maintenance_requests(app, connect, active_user):
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
            raise HTTPException(503, 'No se pudo guardar la solicitud. Verifica la migracion 005 y la conexion.')

    def locked(cursor, request_id):
        row = cursor.execute('SELECT RequestedBy, AssignedTo, Status, RequestData, AcceptedAt FROM dbo.MaintenanceRequests WITH (UPDLOCK, HOLDLOCK) WHERE RequestId=?', request_id).fetchone()
        if row is None:
            raise HTTPException(404, 'Solicitud no encontrada')
        return row

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
            raise HTTPException(503, 'No se pudieron consultar los periodos. Verifica la migracion 005.')

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
                return [decode(row) for row in records(cursor)]
        except (pyodbc.Error, RuntimeError):
            raise HTTPException(503, 'No se pudieron consultar las solicitudes. Verifica la migracion 005.')

    @app.post('/solicitudes-mantenimiento', status_code=201)
    def create_request(data: RequestWrite, usuario_id: int = Depends(active_user)):
        def operation(cursor):
            role = cursor.execute('SELECT Rol FROM dbo.Usuarios WHERE Id=? AND Activo=1', usuario_id).fetchone()
            if not role or role[0] not in ('ADMIN', 'OPERADOR'):
                raise HTTPException(403, 'Solo operadores y administradores pueden generar solicitudes')
            machine = cursor.execute('SELECT AssetCode, Name, Area FROM dbo.Machines WITH (HOLDLOCK) WHERE MachineId=?', data.machine_id).fetchone()
            if not machine:
                raise HTTPException(422, 'Maquina no encontrada')
            payload = data.model_dump(mode='json')
            payload.update(machine_code=machine[0], machine_name=machine[1], area=machine[2])
            if data.requested_part_id:
                part, stock, _ = part_stock(cursor, data.requested_part_id)
                payload.update(requested_part_code=part[0], requested_part_name=part[1], stock_at_request=str(stock), stock_sufficient=stock >= data.requested_quantity)
            row = cursor.execute('''SET NOCOUNT ON; INSERT INTO dbo.MaintenanceRequests
                (MachineId,RequestedBy,RequestedAt,RequestData) VALUES (?,?,?,?);
                SELECT CAST(SCOPE_IDENTITY() AS int);''', data.machine_id, usuario_id, local_now(), json.dumps(payload, ensure_ascii=False)).fetchone()
            return {'id': row[0]}
        return write(operation)

    @app.post('/solicitudes-mantenimiento/{request_id}/atender')
    def accept_request(request_id: int, usuario_id: int = Depends(active_user)):
        def operation(cursor):
            row = locked(cursor, request_id)
            if row[0] == usuario_id:
                raise HTTPException(403, 'La solicitud debe atenderla otra persona')
            if row[2] != 'PENDIENTE':
                raise HTTPException(409, 'Esta solicitud ya fue atendida')
            cursor.execute("UPDATE dbo.MaintenanceRequests SET Status='EN_PROCESO', AssignedTo=?, AcceptedAt=? WHERE RequestId=?", usuario_id, local_now(), request_id)
            return {'id': request_id}
        return write(operation)

    @app.post('/solicitudes-mantenimiento/{request_id}/completar')
    def complete_request(request_id: int, data: CompleteWrite, usuario_id: int = Depends(active_user)):
        def operation(cursor):
            row = locked(cursor, request_id)
            if row[1] != usuario_id:
                raise HTTPException(403, 'Solo la persona que atiende puede entregar el trabajo')
            if row[2] != 'EN_PROCESO':
                raise HTTPException(409, 'La solicitud ya fue entregada o no esta en proceso')
            original = json.loads(row[3])
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
                raise HTTPException(403, 'Solo el solicitante puede confirmar la recepcion')
            if row[2] != 'POR_RECIBIR':
                raise HTTPException(409, 'La solicitud no esta pendiente de recepcion')
            cursor.execute("UPDATE dbo.MaintenanceRequests SET Status='CERRADA', ReceivedAt=?, ReceiptNotes=? WHERE RequestId=?", local_now(), data.notes, request_id)
            return {'id': request_id}
        return write(operation)
