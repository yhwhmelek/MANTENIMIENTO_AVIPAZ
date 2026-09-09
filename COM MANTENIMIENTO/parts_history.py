"""Compras y consumos reales; independientes de las asignaciones tecnicas."""
from contextlib import closing
from datetime import date
from decimal import Decimal
from typing import Literal

import pyodbc
from fastapi import Depends, HTTPException, Query
from pydantic import BaseModel, Field, model_validator


class InterventionWrite(BaseModel):
    machine_id: int = Field(gt=0)
    element_id: int | None = Field(default=None, gt=0)
    performed_on: date
    maintenance_type: Literal['PREVENTIVO', 'CORRECTIVO']
    description: str = Field(min_length=1, max_length=500)

    @model_validator(mode='after')
    def validate_text(self):
        self.description = self.description.strip()
        if not self.description:
            raise ValueError('Describe la intervencion realizada')
        return self


class PurchaseWrite(BaseModel):
    spare_part_id: int = Field(gt=0)
    supplier_id: int = Field(gt=0)
    purchased_on: date
    quantity: Decimal = Field(gt=0, max_digits=10, decimal_places=2)
    unit_cost: Decimal = Field(ge=0, max_digits=18, decimal_places=4)
    currency: str = Field(default='USD', pattern=r'^[A-Z]{3}$')
    document_number: str = Field(min_length=1, max_length=100)
    notes: str | None = Field(default=None, max_length=500)

    @model_validator(mode='after')
    def validate_document(self):
        self.document_number = self.document_number.strip()
        if not self.document_number:
            raise ValueError('Ingresa el documento de compra')
        return self


class ConsumptionWrite(BaseModel):
    maintenance_event_id: int = Field(gt=0)
    spare_part_id: int = Field(gt=0)
    quantity: Decimal = Field(gt=0, max_digits=10, decimal_places=2)
    position: str | None = Field(default=None, max_length=150)
    removed_installed_hour_meter: Decimal | None = Field(default=None, ge=0, max_digits=12, decimal_places=2)
    removed_hour_meter: Decimal | None = Field(default=None, ge=0, max_digits=12, decimal_places=2)
    notes: str | None = Field(default=None, max_length=500)

    @model_validator(mode='after')
    def validate_hours(self):
        start, end = self.removed_installed_hour_meter, self.removed_hour_meter
        if (start is None) != (end is None):
            raise ValueError('Ingresa ambas lecturas del repuesto retirado')
        if start is not None and (end < start or self.quantity != 1):
            raise ValueError('Las lecturas requieren cantidad 1 y retiro mayor o igual a instalacion')
        return self


class VoidWrite(BaseModel):
    reason: str = Field(min_length=1, max_length=500)

    @model_validator(mode='after')
    def validate_reason(self):
        self.reason = self.reason.strip()
        if not self.reason:
            raise ValueError('Indica el motivo de anulacion')
        return self


EVENT_SELECT = """SELECT e.MaintenanceEventId AS maintenance_event_id,
    e.MachineId AS machine_id, e.ElementId AS element_id, e.PerformedOn AS performed_on,
    e.MaintenanceType AS maintenance_type, e.Description AS description,
    m.AssetCode AS machine_code, m.Name AS machine_name,
    el.ElementCode AS element_code, el.Name AS element_name
    FROM dbo.MaintenanceEvents e JOIN dbo.Machines m ON m.MachineId=e.MachineId
    LEFT JOIN dbo.MachineElements el ON el.MachineId=e.MachineId AND el.ElementId=e.ElementId"""
PURCHASE_SELECT = """SELECT p.SparePartPurchaseId AS id, p.SparePartId AS spare_part_id,
    s.InternalCode AS internal_code, s.Description AS description,
    p.SupplierId AS supplier_id, v.Name AS supplier_name, p.PurchasedOn AS occurred_on,
    p.Quantity AS quantity, p.UnitOfMeasure AS unit_of_measure, p.UnitCost AS unit_cost,
    p.Currency AS currency, p.Quantity*p.UnitCost AS total, p.DocumentNumber AS document_number,
    p.Notes AS notes, p.VoidedAt AS voided_at, p.VoidReason AS void_reason
    FROM dbo.SparePartPurchases p JOIN dbo.SpareParts s ON s.SparePartId=p.SparePartId
    JOIN dbo.Suppliers v ON v.SupplierId=p.SupplierId"""
CONSUMPTION_SELECT = """SELECT p.MaintenancePartUsedId AS id, p.SparePartId AS spare_part_id,
    s.InternalCode AS internal_code, s.Description AS description,
    p.MaintenanceEventId AS maintenance_event_id, e.PerformedOn AS occurred_on,
    e.MachineId AS machine_id, e.ElementId AS element_id, m.AssetCode AS machine_code,
    el.ElementCode AS element_code, e.MaintenanceType AS maintenance_type,
    p.Quantity AS quantity, p.UnitOfMeasure AS unit_of_measure, p.Position AS position,
    p.RemovedHourMeter-p.RemovedInstalledHourMeter AS life_hours,
    p.Notes AS notes, p.VoidedAt AS voided_at, p.VoidReason AS void_reason
    FROM dbo.MaintenancePartsUsed p JOIN dbo.SpareParts s ON s.SparePartId=p.SparePartId
    JOIN dbo.MaintenanceEvents e ON e.MaintenanceEventId=p.MaintenanceEventId
    JOIN dbo.Machines m ON m.MachineId=e.MachineId
    LEFT JOIN dbo.MachineElements el ON el.MachineId=e.MachineId AND el.ElementId=e.ElementId"""


def records(cursor):
    names = [column[0] for column in cursor.description]
    return [dict(zip(names, row)) for row in cursor.fetchall()]


def register_parts_history(app, connect, active_user, admin_user):
    def read(sql, parameters=()):
        try:
            with closing(connect()) as connection:
                cursor = connection.cursor()
                cursor.execute(sql, *parameters)
                return records(cursor)
        except (pyodbc.Error, RuntimeError):
            raise HTTPException(503, 'No se pudo consultar el historial. Verifica la migracion 003.')

    def write(operation):
        try:
            with closing(connect()) as connection:
                result = operation(connection.cursor())
                connection.commit()
                return result
        except pyodbc.IntegrityError:
            raise HTTPException(409, 'Los datos no cumplen las relaciones o validaciones del registro')
        except (pyodbc.Error, RuntimeError):
            raise HTTPException(503, 'No se pudo guardar. Verifica la migracion 003 y la conexion.')

    @app.get('/intervenciones')
    def interventions(machine_id: int | None = Query(None, gt=0), start: date | None = None,
                      end: date | None = None, usuario_id: int = Depends(active_user)):
        if start and end and start > end:
            raise HTTPException(422, 'La fecha inicial debe ser anterior o igual a la final')
        clauses, parameters = [], []
        for condition, value in (('e.MachineId=?', machine_id), ('e.PerformedOn>=?', start), ('e.PerformedOn<=?', end)):
            if value is not None:
                clauses.append(condition)
                parameters.append(value)
        return read(EVENT_SELECT + (' WHERE ' + ' AND '.join(clauses) if clauses else '')
                    + ' ORDER BY e.PerformedOn DESC, e.MaintenanceEventId DESC', parameters)

    @app.post('/intervenciones', status_code=201)
    def create_intervention(data: InterventionWrite, usuario_id: int = Depends(admin_user)):
        def operation(cursor):
            if data.element_id is not None and not cursor.execute(
                'SELECT ElementId FROM dbo.MachineElements WITH (HOLDLOCK) WHERE MachineId=? AND ElementId=?',
                data.machine_id, data.element_id,
            ).fetchone():
                raise HTTPException(422, 'El elemento no pertenece a la maquina')
            row = cursor.execute('''SET NOCOUNT ON; INSERT INTO dbo.MaintenanceEvents
                (MachineId,ElementId,PerformedOn,MaintenanceType,Description,CreatedBy)
                VALUES (?,?,?,?,?,?); SELECT CAST(SCOPE_IDENTITY() AS int);''',
                data.machine_id, data.element_id, data.performed_on, data.maintenance_type,
                data.description, usuario_id).fetchone()
            return {'id': row[0]}
        return write(operation)

    @app.post('/compras-repuestos', status_code=201)
    def create_purchase(data: PurchaseWrite, usuario_id: int = Depends(admin_user)):
        def operation(cursor):
            part = cursor.execute('SELECT UnitOfMeasure FROM dbo.SpareParts WITH (HOLDLOCK) WHERE SparePartId=? AND Active=1', data.spare_part_id).fetchone()
            supplier = cursor.execute('SELECT SupplierId FROM dbo.Suppliers WITH (HOLDLOCK) WHERE SupplierId=? AND Active=1', data.supplier_id).fetchone()
            if not part or not supplier:
                raise HTTPException(422, 'Selecciona un repuesto y un proveedor activos')
            row = cursor.execute('''SET NOCOUNT ON; INSERT INTO dbo.SparePartPurchases
                (SparePartId,SupplierId,PurchasedOn,Quantity,UnitCost,Currency,UnitOfMeasure,DocumentNumber,Notes,CreatedBy)
                VALUES (?,?,?,?,?,?,?,?,?,?); SELECT CAST(SCOPE_IDENTITY() AS int);''',
                data.spare_part_id, data.supplier_id, data.purchased_on, data.quantity,
                data.unit_cost, data.currency, part[0], data.document_number, data.notes, usuario_id).fetchone()
            return {'id': row[0]}
        return write(operation)

    @app.post('/consumos-repuestos', status_code=201)
    def create_consumption(data: ConsumptionWrite, usuario_id: int = Depends(admin_user)):
        def operation(cursor):
            part = cursor.execute('SELECT UnitOfMeasure FROM dbo.SpareParts WITH (HOLDLOCK) WHERE SparePartId=? AND Active=1', data.spare_part_id).fetchone()
            if not part:
                raise HTTPException(422, 'Selecciona un repuesto activo')
            row = cursor.execute('''SET NOCOUNT ON; INSERT INTO dbo.MaintenancePartsUsed
                (MaintenanceEventId,SparePartId,Quantity,UnitOfMeasure,Position,RemovedInstalledHourMeter,RemovedHourMeter,Notes,CreatedBy)
                VALUES (?,?,?,?,?,?,?,?,?); SELECT CAST(SCOPE_IDENTITY() AS int);''',
                data.maintenance_event_id, data.spare_part_id, data.quantity, part[0], data.position,
                data.removed_installed_hour_meter, data.removed_hour_meter, data.notes, usuario_id).fetchone()
            return {'id': row[0]}
        return write(operation)

    def history(kind, spare_part_id, machine_id, start, end, include_voided):
        if start and end and start > end:
            raise HTTPException(422, 'La fecha inicial debe ser anterior o igual a la final')
        clauses, params = [], []
        if not include_voided:
            clauses.append('p.VoidedAt IS NULL')
        if spare_part_id is not None:
            clauses.append('p.SparePartId=?'); params.append(spare_part_id)
        date_column = 'p.PurchasedOn' if kind == 'purchase' else 'e.PerformedOn'
        for operator, value in (('>=', start), ('<=', end)):
            if value is not None:
                clauses.append(date_column + operator + '?'); params.append(value)
        if machine_id is not None:
            clauses.append('e.MachineId=?'); params.append(machine_id)
        sql = PURCHASE_SELECT if kind == 'purchase' else CONSUMPTION_SELECT
        id_column = 'p.SparePartPurchaseId' if kind == 'purchase' else 'p.MaintenancePartUsedId'
        return read(sql + (' WHERE ' + ' AND '.join(clauses) if clauses else '') + ' ORDER BY ' + date_column + ' DESC, ' + id_column + ' DESC', params)

    @app.get('/compras-repuestos')
    def purchases(spare_part_id: int | None = Query(None, gt=0), start: date | None = None,
                  end: date | None = None, include_voided: bool = False, usuario_id: int = Depends(active_user)):
        return history('purchase', spare_part_id, None, start, end, include_voided)

    @app.get('/consumos-repuestos')
    def consumptions(spare_part_id: int | None = Query(None, gt=0), machine_id: int | None = Query(None, gt=0),
                     start: date | None = None, end: date | None = None,
                     include_voided: bool = False, usuario_id: int = Depends(active_user)):
        return history('consumption', spare_part_id, machine_id, start, end, include_voided)

    def void(kind, record_id, data, user):
        table, key = ('SparePartPurchases', 'SparePartPurchaseId') if kind == 'purchase' else ('MaintenancePartsUsed', 'MaintenancePartUsedId')
        def operation(cursor):
            cursor.execute(f'UPDATE dbo.{table} SET VoidedAt=SYSDATETIME(), VoidedBy=?, VoidReason=? WHERE {key}=? AND VoidedAt IS NULL', user, data.reason, record_id)
            if cursor.rowcount != 1:
                raise HTTPException(404, 'Registro inexistente o ya anulado')
            return {'id': record_id}
        return write(operation)

    @app.post('/compras-repuestos/{record_id}/anular')
    def void_purchase(record_id: int, data: VoidWrite, usuario_id: int = Depends(admin_user)):
        return void('purchase', record_id, data, usuario_id)

    @app.post('/consumos-repuestos/{record_id}/anular')
    def void_consumption(record_id: int, data: VoidWrite, usuario_id: int = Depends(admin_user)):
        return void('consumption', record_id, data, usuario_id)
