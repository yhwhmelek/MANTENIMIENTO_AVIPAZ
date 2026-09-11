import os
import re
import smtplib
import ssl
from email.message import EmailMessage
from email.utils import make_msgid
from html import escape
from pathlib import Path

from fastapi import Depends, HTTPException
from pydantic import BaseModel, Field, field_validator

from purchase_requisitions import RequisitionWrite, generate_requisition


class RequisitionMail(BaseModel):
    requisition: RequisitionWrite
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


def send_requisition(data):
    host = os.getenv('REQUISITION_SMTP_HOST', 'mail.avipaz.ec')
    user = os.getenv('REQUISITION_SMTP_USER', 'mantenimientosamanga@avipaz.ec')
    password = os.getenv('REQUISITION_SMTP_PASSWORD')
    if not password:
        raise HTTPException(503, 'Falta configurar la contraseña SMTP en el servidor.')
    try:
        port = int(os.getenv('REQUISITION_SMTP_PORT', '465'))
        content = generate_requisition(data.requisition)
        message = EmailMessage()
        message['From'] = user
        message['To'] = ', '.join(data.to)
        if data.cc:
            message['Cc'] = ', '.join(data.cc)
        message['Subject'] = data.subject
        message.set_content(data.body)
        signature_path = Path(__file__).parent / 'templates' / 'firma_correo.jpg'
        if not signature_path.is_file():
            raise HTTPException(503, 'Falta la imagen de firma del correo en el servidor.')
        signature = signature_path.read_bytes()
        cid = make_msgid()
        body_html = escape(data.body).replace('\n', '<br>')
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


def register_requisition_mail(app, active_user):
    @app.post('/requisiciones-compra/enviar')
    def send(data: RequisitionMail, usuario_id: int = Depends(active_user)):
        return send_requisition(data)
