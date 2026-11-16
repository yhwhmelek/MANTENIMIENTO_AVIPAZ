import os
import base64
import binascii
import mimetypes
import re
import smtplib
import ssl
from contextlib import closing
from email.message import EmailMessage
from email.utils import make_msgid
from html import escape
from pathlib import Path

from fastapi import Depends, HTTPException
from pydantic import BaseModel, Field, field_validator, model_validator

from purchase_requisitions import RequisitionWrite, generate_requisition, machine_locations
from image_storage import stored_image


MAX_ATTACHMENT_BYTES = 5 * 1024 * 1024
MAX_TOTAL_ATTACHMENT_BYTES = 15 * 1024 * 1024


class MailAttachment(BaseModel):
    filename: str = Field(min_length=1, max_length=255)
    content_base64: str = Field(min_length=1, max_length=4 * ((MAX_ATTACHMENT_BYTES + 2) // 3))

    @field_validator('filename')
    @classmethod
    def valid_filename(cls, value):
        if not value.strip() or value in ('.', '..') or any(ord(c) < 32 or ord(c) == 127 or c in '/\\' for c in value):
            raise ValueError('Nombre de archivo no valido')
        return value

    def decoded(self):
        return base64.b64decode(self.content_base64, validate=True)

    @model_validator(mode='after')
    def validate_content(self):
        try:
            content = self.decoded()
        except (ValueError, binascii.Error):
            raise ValueError('El archivo adjunto no contiene datos validos')
        if not content or len(content) > MAX_ATTACHMENT_BYTES:
            raise ValueError('Cada archivo debe contener datos y pesar como maximo 5 MB')
        return self


class MailContent(BaseModel):
    to: list[str] = Field(min_length=1, max_length=30)
    cc: list[str] = Field(default_factory=list, max_length=30)
    subject: str = Field(min_length=1, max_length=200)
    body: str = Field(min_length=1, max_length=10000)

    @field_validator('to', 'cc')
    @classmethod
    def addresses(cls, values):
        result = []
        for value in values:
            value = value.strip()
            if not re.fullmatch(r"[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+", value):
                raise ValueError('Correo no valido; escribe solo la direccion, sin nombres.')
            if value.lower() not in [item.lower() for item in result]:
                result.append(value)
        return result

    @field_validator('subject', 'body')
    @classmethod
    def text(cls, value, info):
        value = value.strip()
        if not value or (info.field_name == 'subject' and ('\r' in value or '\n' in value)):
            raise ValueError('Texto vacio o asunto no valido.')
        return value


class RequisitionMail(MailContent):
    attachments: list[MailAttachment] = Field(default_factory=list, max_length=10)
    requisition: RequisitionWrite

    @model_validator(mode='after')
    def attachment_total(self):
        if sum(len(item.decoded()) for item in self.attachments) > MAX_TOTAL_ATTACHMENT_BYTES:
            raise ValueError('Los archivos adjuntos no pueden superar 15 MB en total')
        return self


def supplier_payment_details(requisition, connect):
    if connect is None:
        return []
    supplier_ids = {item.supplier_id for item in requisition.items if item.supplier_id}
    if not supplier_ids:
        return []
    placeholders = ','.join('?' for _ in supplier_ids)
    try:
        with closing(connect()) as connection:
            rows = connection.cursor().execute(
                f'''SELECT SupplierId, Name, PaymentMethod, CreditDays, PaymentMethodImagePath
                    FROM dbo.Suppliers WHERE Active=1 AND SupplierId IN ({placeholders}) ORDER BY Name''',
                *supplier_ids).fetchall()
    except Exception as error:
        raise HTTPException(503, 'No se pudo consultar la informacion de pago de los proveedores.') from error
    return rows


def send_requisition(data, connect=None, invoice=None, invoices=None):
    host = os.getenv('REQUISITION_SMTP_HOST', 'mail.avipaz.ec')
    user = os.getenv('REQUISITION_SMTP_USER', 'mantenimientosamanga@avipaz.ec')
    password = os.getenv('REQUISITION_SMTP_PASSWORD')
    if not password:
        raise HTTPException(503, 'Falta configurar la contraseña SMTP en el servidor.')
    try:
        port = int(os.getenv('REQUISITION_SMTP_PORT', '465'))
        content = generate_requisition(data.requisition, machine_locations(data.requisition, connect))
        message = EmailMessage()
        message['From'] = user
        message['To'] = ', '.join(data.to)
        if data.cc:
            message['Cc'] = ', '.join(data.cc)
        message['Subject'] = data.subject
        supplier_rows = supplier_payment_details(data.requisition, connect)
        payment_lines = []
        payment_images = []
        for supplier_id, name, payment_method, credit_days, image_path in supplier_rows:
            terms = []
            if payment_method:
                terms.append(f'Medio de pago: {payment_method}')
            if credit_days is not None:
                terms.append(f'Días de crédito: {credit_days}')
            if terms:
                payment_lines.append(f'{name}: ' + ' · '.join(terms))
            image = stored_image(image_path)
            if image:
                payment_images.append((image, name))
        body = data.body
        if payment_lines:
            body += '\n\nInformación de pago de proveedores:\n' + '\n'.join(payment_lines)
        message.set_content(body)
        signature_path = Path(__file__).parent / 'templates' / 'firma_correo.jpg'
        if not signature_path.is_file():
            raise HTTPException(503, 'Falta la imagen de firma del correo en el servidor.')
        signature = signature_path.read_bytes()
        cid = make_msgid()
        body_html = escape(body).replace('\n', '<br>')
        message.add_alternative(
            f'<html><body><div>{body_html}</div><br>'
            f'<img src="cid:{cid[1:-1]}" width="800" style="max-width:100%;height:auto" '
            'alt="Ing. Cristian Changoluisa Santacruz - Jefe de Mantenimiento - AVIPAZ">'
            '</body></html>', subtype='html')
        message.get_payload()[-1].add_related(signature, maintype='image', subtype='jpeg',
                                            cid=cid, disposition='inline', filename='firma_avipaz.jpg')
        message.add_attachment(content, maintype='application',
                               subtype='vnd.openxmlformats-officedocument.spreadsheetml.sheet',
                               filename=f'CO-01-01_Requisicion_{data.requisition.requested_on.isoformat()}.xlsx')
        recipients = list(dict.fromkeys(data.to + data.cc))
        invoice_files = invoices or ([invoice] if invoice is not None else [])
        for invoice_file in invoice_files:
            invoice_content, invoice_type = invoice_file.decoded()
            maintype, subtype = invoice_type.split('/', 1)
            message.add_attachment(invoice_content, maintype=maintype, subtype=subtype,
                                   filename=invoice_file.filename)
        for attachment in data.attachments:
            mime_type = mimetypes.guess_type(attachment.filename)[0] or 'application/octet-stream'
            maintype, subtype = mime_type.split('/', 1)
            message.add_attachment(attachment.decoded(), maintype=maintype, subtype=subtype,
                                   filename=attachment.filename)
        for image, supplier_name in payment_images:
            mime_type = mimetypes.guess_type(image.name)[0] or 'application/octet-stream'
            maintype, subtype = mime_type.split('/', 1)
            message.add_attachment(image.read_bytes(), maintype=maintype, subtype=subtype,
                                   filename=image.name)
        with smtplib.SMTP_SSL(host, port, timeout=30, context=ssl.create_default_context()) as smtp:
            smtp.login(user, password)
            refused = smtp.send_message(message, from_addr=user, to_addrs=recipients)
        if refused:
            return {'message': 'Envío parcial: el servidor rechazó estas direcciones: ' + ', '.join(refused) + '. Los demás destinatarios fueron aceptados; no reenvíes a todos.'}
        return {'message': 'El servidor de correo aceptó la requisición para los destinatarios indicados.'}
    except smtplib.SMTPAuthenticationError:
        raise HTTPException(503, 'No se pudo autenticar el correo. Revisa las credenciales SMTP del servidor.')
    except smtplib.SMTPRecipientsRefused:
        raise HTTPException(422, 'El servidor rechazó los destinatarios. Revisa sus direcciones.')
    except (OSError, smtplib.SMTPException):
        raise HTTPException(503, 'No se pudo confirmar el envío. Verifica con los destinatarios antes de reintentar para evitar duplicados.')
    except ValueError:
        raise HTTPException(503, 'Revisa la configuración SMTP y la plantilla de requisición.')


def register_requisition_mail(app, active_user, connect=None):
    @app.post('/requisiciones-compra/enviar')
    def send(data: RequisitionMail, usuario_id: int = Depends(active_user)):
        return send_requisition(data, connect)
