"""Requisiciones persistentes y recepcion transaccional en el libro de compras."""
from contextlib import closing
from datetime import date
from decimal import Decimal
import json
import base64
import binascii
from urllib.parse import quote

import pyodbc
from fastapi import Depends, HTTPException, Response
from pydantic import Field, model_validator
from purchase_requisitions import TextModel, RequisitionWrite, generate_requisition


class ReceivedItem(TextModel):
    spare_part_id: int = Field(gt=0)
    quantity: Decimal = Field(gt=0, max_digits=10, decimal_places=2)
    unit_cost: Decimal = Field(ge=0, max_digits=18, decimal_places=4)


class InvoiceWrite(TextModel):
    filename: str = Field(min_length=1, max_length=180, pattern=r'^[^/\\\x00-\x1f\x7f]+$')
    content_base64: str = Field(min_length=1, max_length=13981016)

    def decoded(self):
        try:
            content = base64.b64decode(self.content_base64, validate=True)
        except (ValueError, binascii.Error):
            raise ValueError('El archivo de factura no es valido')
        if not content or len(content) > 10 * 1024 * 1024:
            raise ValueError('La factura debe tener como maximo 10 MB')
        extension = self.filename.rsplit('.', 1)[-1].lower()
        if extension == 'pdf' and content.startswith(b'%PDF-'):
            return content, 'application/pdf'
        if extension in ('jpg', 'jpeg') and content.startswith(b'\xff\xd8\xff'):
            return content, 'image/jpeg'
        if extension == 'png' and content.startswith(b'\x89PNG\r\n\x1a\n'):
            return content, 'image/png'
        if extension == 'webp' and content.startswith(b'RIFF') and content[8:12] == b'WEBP':
            return content, 'image/webp'
        raise ValueError('Adjunta un PDF o una imagen JPG, PNG o WEBP con formato valido')

    @model_validator(mode='after')
    def validate_file(self):
        self.decoded()
        return self


class ReceiptWrite(TextModel):
    invoice: InvoiceWrite | None = None
    supplier_id: int = Field(gt=0)
    purchased_on: date
    document_number: str = Field(min_length=1, max_length=100)
    currency: str = Field(default='USD', pattern=r'^[A-Z]{3}$')
    items: list[ReceivedItem] = Field(min_length=1, max_length=11)

    @model_validator(mode='after')
    def valid_date(self):
        if self.purchased_on > date.today():
            raise ValueError('La fecha de recepcion no puede ser futura')
        return self


def register_requisition_records(app, connect, active_user, admin_user):
    def transact(operation):
        try:
            with closing(connect()) as connection:
                try:
                    result = operation(connection.cursor())
                    connection.commit()
                    return result
                except Exception:
                    connection.rollback()
                    raise
        except (pyodbc.Error, RuntimeError):
            raise HTTPException(503, 'No se pudo completar la operacion. Verifica las migraciones 008 y 009 y la conexion.')

    def get_record(cursor, record_id, lock=False):
        row = cursor.execute('SELECT Payload, ReceivedAt, Receipt FROM dbo.PurchaseRequisitions '
                             + ('WITH (UPDLOCK, HOLDLOCK) ' if lock else '')
                             + 'WHERE RequisitionId=?', record_id).fetchone()
        if not row:
            raise HTTPException(404, 'Requisicion no encontrada')
        return row

    @app.post('/requisiciones-compra', status_code=201)
    def create(data: RequisitionWrite, user: int = Depends(active_user)):
        def operation(cursor):
            row = cursor.execute('''SET NOCOUNT ON; INSERT INTO dbo.PurchaseRequisitions
                (Payload,CreatedBy) VALUES (?,?); SELECT CAST(SCOPE_IDENTITY() AS int);''',
                data.model_dump_json(), user).fetchone()
            return {'id': row[0], 'status': 'PENDIENTE'}
        return transact(operation)

    @app.get('/requisiciones-compra')
    def listing(user: int = Depends(active_user)):
        def operation(cursor):
            rows = cursor.execute('''SELECT RequisitionId,Payload,CreatedAt,ReceivedAt,ReceivedBy,Receipt
                FROM dbo.PurchaseRequisitions ORDER BY RequisitionId DESC''').fetchall()
            return [dict(id=r[0], requisition=json.loads(r[1]), created_at=r[2],
                         status='RECIBIDA' if r[3] else 'PENDIENTE', received_at=r[3], received_by=r[4],
                         receipt=json.loads(r[5]) if r[5] else None) for r in rows]
        return transact(operation)

    @app.get('/requisiciones-compra/pendientes')
    def pending(user: int = Depends(admin_user)):
        return transact(lambda cursor: {'count': cursor.execute(
            'SELECT COUNT(*) FROM dbo.PurchaseRequisitions WHERE ReceivedAt IS NULL').fetchone()[0]})

    @app.get('/requisiciones-compra/{record_id}/factura')
    def invoice_download(record_id: int, user: int = Depends(active_user)):
        def operation(cursor):
            row = cursor.execute('SELECT Filename,MediaType,Content FROM dbo.PurchaseRequisitionInvoices WHERE RequisitionId=?', record_id).fetchone()
            if not row:
                raise HTTPException(404, 'Esta requisicion no tiene una factura adjunta')
            return row
        row = transact(operation)
        return Response(bytes(row[2]), media_type=row[1], headers={
            'Content-Disposition': "attachment; filename*=UTF-8''" + quote(row[0], safe=''),
            'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff'})

    @app.get('/requisiciones-compra/{record_id}/archivo')
    def download(record_id: int, user: int = Depends(active_user)):
        payload = transact(lambda cursor: get_record(cursor, record_id)[0])
        content = generate_requisition(RequisitionWrite.model_validate_json(payload))
        return Response(content, media_type='application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
                        headers={'Content-Disposition': f'attachment; filename="Requisicion_{record_id}.xlsx"', 'Cache-Control': 'no-store'})

    @app.post('/requisiciones-compra/{record_id}/recibir')
    def receive(record_id: int, data: ReceiptWrite, user: int = Depends(admin_user)):
        def operation(cursor):
            row = get_record(cursor, record_id, lock=True)
            if row[1] is not None:
                raise HTTPException(409, 'Esta requisicion ya fue recibida; no se duplicaron las compras')
            requisition = RequisitionWrite.model_validate_json(row[0])
            if len(data.items) != len(requisition.items):
                raise HTTPException(422, 'Confirma todos los items de la requisicion')
            if data.purchased_on < requisition.requested_on:
                raise HTTPException(422, 'La recepcion no puede ser anterior al pedido')
            if not cursor.execute('SELECT SupplierId FROM dbo.Suppliers WITH (HOLDLOCK) WHERE SupplierId=? AND Active=1', data.supplier_id).fetchone():
                raise HTTPException(422, 'Selecciona un proveedor activo')
            purchases = []
            for index, item in enumerate(data.items):
                part = cursor.execute('SELECT UnitOfMeasure FROM dbo.SpareParts WITH (HOLDLOCK) WHERE SparePartId=? AND Active=1', item.spare_part_id).fetchone()
                if not part:
                    raise HTTPException(422, f'Item {index+1}: selecciona un repuesto activo; registra primero los productos nuevos en Inventario')
                if part[0].strip().casefold() != requisition.items[index].unit.strip().casefold():
                    raise HTTPException(422, f'Item {index+1}: la unidad del inventario debe coincidir con la solicitada')
                balance = cursor.execute('SELECT CutoffDate FROM dbo.SparePartOpeningBalances WITH (HOLDLOCK) WHERE SparePartId=?', item.spare_part_id).fetchone()
                if balance and data.purchased_on <= balance[0]:
                    raise HTTPException(422, 'La recepcion debe ser posterior al corte del saldo inicial para ingresar al stock')
                purchase = cursor.execute('''SET NOCOUNT ON; INSERT INTO dbo.SparePartPurchases
                    (SparePartId,SupplierId,PurchasedOn,Quantity,UnitCost,Currency,UnitOfMeasure,DocumentNumber,Notes,CreatedBy)
                    VALUES (?,?,?,?,?,?,?,?,?,?); SELECT CAST(SCOPE_IDENTITY() AS int);''',
                    item.spare_part_id, data.supplier_id, data.purchased_on, item.quantity,
                    item.unit_cost, data.currency, part[0], data.document_number,
                    f'Requisicion #{record_id}, item {index+1}', user).fetchone()
                purchases.append(purchase[0])
            receipt = data.model_dump(mode='json', exclude={'invoice'}) | {'purchase_ids': purchases}
            if data.invoice:
                content, media_type = data.invoice.decoded()
                cursor.execute('''INSERT INTO dbo.PurchaseRequisitionInvoices
                    (RequisitionId,Filename,MediaType,Content,CreatedBy) VALUES (?,?,?,?,?)''',
                    record_id, data.invoice.filename, media_type, pyodbc.Binary(content), user)
                receipt['invoice'] = {'filename': data.invoice.filename, 'media_type': media_type}
            cursor.execute('''UPDATE dbo.PurchaseRequisitions SET ReceivedAt=SYSDATETIME(),
                ReceivedBy=?,Receipt=? WHERE RequisitionId=?''', user, json.dumps(receipt), record_id)
            return {'id': record_id, 'status': 'RECIBIDA', 'purchase_ids': purchases}
        return transact(operation)
