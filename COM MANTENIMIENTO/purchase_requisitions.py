"""Generacion de requisiciones Excel CO/01-01; no registra compras ni movimientos."""
from datetime import date
from decimal import Decimal
from io import BytesIO
from pathlib import Path
import math
import re
import zipfile
import xml.etree.ElementTree as ET

from fastapi import Depends, HTTPException, Response
from pydantic import BaseModel, ConfigDict, Field, model_validator

NS = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main'
ET.register_namespace('', NS)
ET.register_namespace('r', 'http://schemas.openxmlformats.org/officeDocument/2006/relationships')
TEMPLATE = Path(__file__).with_name('templates') / 'CO-01-01_requisicion_compra.xlsx'


class TextModel(BaseModel):
    model_config = ConfigDict(str_strip_whitespace=True, extra='forbid')

class RequisitionItem(TextModel):
    description: str = Field(min_length=1, max_length=160)
    quantity: Decimal = Field(gt=0, max_digits=10, decimal_places=2)
    unit: str = Field(min_length=1, max_length=20)
    specifications: str = Field(default='', max_length=500)

class RequisitionWrite(TextModel):
    department: str = Field(min_length=1, max_length=80)
    supplier: str = Field(default='', max_length=120)
    requested_on: date
    delivery_on: date | None = None
    urgent: bool = False
    machine_codes: str = Field(default='', max_length=100)
    observations: str = Field(default='', max_length=1000)
    requester: str = Field(min_length=1, max_length=100)
    items: list[RequisitionItem] = Field(min_length=1, max_length=11)

    @model_validator(mode='after')
    def check_delivery(self):
        if self.urgent and self.delivery_on is not None:
            raise ValueError('Selecciona entrega urgente o fecha de entrega, no ambas')
        if not self.urgent and self.delivery_on is None:
            raise ValueError('Indica la fecha de entrega o marca urgente')
        if self.delivery_on and self.delivery_on < self.requested_on:
            raise ValueError('La entrega no puede ser anterior al pedido')
        # Caracteres de control no admitidos por XML 1.0.
        text = [self.department, self.supplier, self.machine_codes, self.observations, self.requester]
        text += [v for item in self.items for v in (item.description, item.unit, item.specifications)]
        if any(re.search(r'[\x00-\x08\x0b\x0c\x0e-\x1f\ud800-\udfff\ufffe\uffff]', value) for value in text):
            raise ValueError('El texto contiene caracteres no validos')
        return self


def set_cell(root, reference, value):
    cell = root.find(f'.//{{{NS}}}c[@r="{reference}"]')
    if cell is None:
        raise ValueError(f'Falta la celda {reference} en la plantilla')
    for child in list(cell):
        cell.remove(child)
    if isinstance(value, Decimal):
        cell.set('t', 'n')
        ET.SubElement(cell, f'{{{NS}}}v').text = format(value, 'f')
    else:
        # Siempre texto literal; no se interpretan entradas como formulas.
        cell.set('t', 'inlineStr')
        inline = ET.SubElement(cell, f'{{{NS}}}is')
        element = ET.SubElement(inline, f'{{{NS}}}t')
        element.set('{http://www.w3.org/XML/1998/namespace}space', 'preserve')
        element.text = str(value)


def wrapped_lines(text, width):
    return sum(max(1, math.ceil(len(line)/width)) for line in text.split('\n'))

def generate_requisition(data: RequisitionWrite):
    output = BytesIO()
    with zipfile.ZipFile(TEMPLATE) as source, zipfile.ZipFile(output, 'w', zipfile.ZIP_DEFLATED) as result:
        root = ET.fromstring(source.read('xl/worksheets/sheet1.xml'))
        fields = {'B5': data.department, 'E5': data.supplier or 'Por definir',
                  'B6': data.requested_on.strftime('%d/%m/%Y'),
                  'E6': data.machine_codes or 'No aplica',
                  'B7': 'ASAP / Urgente' if data.urgent else data.delivery_on.strftime('%d/%m/%Y'),
                  'B20': data.observations or 'No aplica', 'B25': data.requester}
        for reference, value in fields.items():
            set_cell(root, reference, value)
        for row_number in range(9, 20):
            item = data.items[row_number-9] if row_number-9 < len(data.items) else None
            values = (item.description, item.quantity, item.unit, item.specifications) if item else ('','','','')
            for col,value in zip('ABCD', values):
                set_cell(root, f'{col}{row_number}', value)
            if item:
                lines = max(wrapped_lines(item.description, 28), wrapped_lines(item.specifications, 46), wrapped_lines(item.unit, 10))
                row = root.find(f'.//{{{NS}}}row[@r="{row_number}"]')
                row.set('ht', str(max(18, lines*14+4)))
                row.set('customHeight', '1')
        for number, text, width in [(5, max(data.department, data.supplier, key=len), 28), (6,data.machine_codes,40), (20,data.observations,75), (25,data.requester,11)]:
            row = root.find(f'.//{{{NS}}}row[@r="{number}"]')
            row.set('ht',str(max(float(row.get('ht','18')),wrapped_lines(text,width)*14+4)))
            row.set('customHeight','1')
        for entry in source.infolist():
            result.writestr(entry, ET.tostring(root,encoding='utf-8',xml_declaration=True) if entry.filename=='xl/worksheets/sheet1.xml' else source.read(entry.filename))
    return output.getvalue()


def register_purchase_requisitions(app, active_user):
    @app.post('/requisiciones-compra/archivo')
    def download_requisition(data: RequisitionWrite, usuario_id: int = Depends(active_user)):
        try:
            content = generate_requisition(data)
        except (OSError, ValueError, zipfile.BadZipFile, ET.ParseError):
            raise HTTPException(503, 'No se pudo generar el archivo. Verifica la plantilla de requisicion en el servidor.')
        return Response(content, media_type='application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
                        headers={'Content-Disposition': f'attachment; filename="CO-01-01_Requisicion_{data.requested_on.isoformat()}.xlsx"', 'Cache-Control': 'no-store'})
