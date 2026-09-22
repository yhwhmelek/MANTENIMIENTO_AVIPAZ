import unittest
import base64
from unittest.mock import MagicMock, patch
from io import BytesIO
import zipfile
import xml.etree.ElementTree as ET
from pydantic import ValidationError
from fastapi import HTTPException
from requisition_mail import RequisitionMail, send_requisition
from purchase_requisitions import NS


class MailTests(unittest.TestCase):
    def attachment(self, filename='foto.jpg', content=b'foto de prueba'):
        return dict(filename=filename, content_base64=base64.b64encode(content).decode('ascii'))

    def test_extra_files_are_sent_intact_with_excel(self):
        files=[self.attachment('foto.jpg', b'\xff\xd8foto'), self.attachment('cotizacion.pdf', b'%PDF-documento')]
        with patch.dict('os.environ', {'REQUISITION_SMTP_PASSWORD':'test-only'}), patch('requisition_mail.smtplib.SMTP_SSL') as smtp:
            client=smtp.return_value.__enter__.return_value
            client.send_message.return_value={}
            send_requisition(self.data(attachments=files))
            attachments=list(client.send_message.call_args.args[0].iter_attachments())
        self.assertEqual(len(attachments), 3)
        self.assertTrue(attachments[0].get_filename().endswith('.xlsx'))
        for part, source, mime in zip(attachments[1:], files, ['image/jpeg', 'application/pdf']):
            self.assertEqual(part.get_filename(), source['filename'])
            self.assertEqual(part.get_payload(decode=True), base64.b64decode(source['content_base64']))
            self.assertEqual(part.get_content_type(), mime)
            self.assertEqual(part.get_content_disposition(), 'attachment')

    def test_invalid_attachments_rejected(self):
        for attachment in [dict(filename='foto.jpg', content_base64='invalid!'),
                           self.attachment('../foto.jpg'), self.attachment('foto\r\nBcc: otro'),
                           self.attachment(content=b'')]:
            with self.subTest(attachment=attachment), self.assertRaises(ValidationError):
                self.data(attachments=[attachment])
        with self.assertRaises(ValidationError):
            self.data(attachments=[self.attachment()] * 11)
        with patch('requisition_mail.MAX_ATTACHMENT_BYTES', 4), self.assertRaises(ValidationError):
            self.data(attachments=[self.attachment(content=b'12345')])
        with patch('requisition_mail.MAX_TOTAL_ATTACHMENT_BYTES', 5), self.assertRaises(ValidationError):
            self.data(attachments=[self.attachment(content=b'123')] * 2)

    def data(self, **changes):
        return RequisitionMail(**(dict(to=['compras@example.com'], cc=['copia@example.com'], subject='Pedido', body='Revisar adjunto',
            requisition=dict(department='Mantenimiento', requested_on='2026-09-09', urgent=True, requester='Prueba',
                items=[dict(description='Malla',quantity=1,unit='UNIDAD',specifications='')])) | changes))

    def test_attachment_and_envelope(self):
        with patch.dict('os.environ', {'REQUISITION_SMTP_PASSWORD':'test-only'}), patch('requisition_mail.smtplib.SMTP_SSL') as smtp:
            client=smtp.return_value.__enter__.return_value
            client.send_message.return_value={}
            send_requisition(self.data())
            call=client.send_message.call_args
            self.assertEqual(call.kwargs['to_addrs'], ['compras@example.com','copia@example.com'])
            attachment=list(call.args[0].iter_attachments())[0]
            self.assertTrue(attachment.get_filename().endswith('.xlsx'))
            self.assertTrue(attachment.get_payload(decode=True).startswith(b'PK'))
            message = call.args[0]
            html = message.get_body(preferencelist=('html',)).get_content()
            signature = next(part for part in message.walk() if part.get_content_type() == 'image/jpeg')
            self.assertIn('cid:' + signature['Content-ID'][1:-1], html)
            self.assertEqual(signature.get_content_disposition(), 'inline')
            self.assertTrue(signature.get_payload(decode=True).startswith(b'\xff\xd8'))

    def test_emailed_excel_contains_machine_location_and_observations(self):
        connection = MagicMock()
        connection.cursor.return_value.execute.return_value.fetchall.return_value = [('MOL-01', 'Samanga', 'Torre 1')]
        requisition = self.data(requisition=dict(department='Mantenimiento', requested_on='2026-09-09',
            urgent=True, requester='Prueba', machine_codes='MOL-01', observations='Entregar mañana',
            items=[dict(description='Malla',quantity=1,unit='UNIDAD',specifications='')]))
        with patch.dict('os.environ', {'REQUISITION_SMTP_PASSWORD':'test-only'}), patch('requisition_mail.smtplib.SMTP_SSL') as smtp:
            smtp.return_value.__enter__.return_value.send_message.return_value = {}
            send_requisition(requisition, lambda: connection)
            attachment = next(smtp.return_value.__enter__.return_value.send_message.call_args.args[0].iter_attachments())
        with zipfile.ZipFile(BytesIO(attachment.get_payload(decode=True))) as z:
            sheet = ET.fromstring(z.read('xl/worksheets/sheet1.xml'))
            self.assertEqual(''.join(sheet.find(f'.//{{{NS}}}c[@r="B20"]').itertext()),
                             'Planta: Samanga · Torre: Torre 1\nEntregar mañana')

    def test_body_is_escaped_in_html(self):
        with patch.dict('os.environ', {'REQUISITION_SMTP_PASSWORD':'test-only'}), patch('requisition_mail.smtplib.SMTP_SSL') as smtp:
            client = smtp.return_value.__enter__.return_value
            client.send_message.return_value = {}
            send_requisition(self.data(body='<script>example</script>\nDetalle'))
            html = client.send_message.call_args.args[0].get_body(preferencelist=('html',)).get_content()
            self.assertNotIn('<script>', html)
            self.assertIn('&lt;script&gt;', html)
            self.assertIn('<br>Detalle', html)

    def test_header_injection_rejected(self):
        for changes in [dict(subject='Pedido\r\nBcc: other@example.com'),dict(to=['a@example.com\r\nBcc: b@example.com'])]:
            with self.assertRaises(ValidationError):self.data(**changes)

    def test_missing_password_does_not_connect(self):
        with patch.dict('os.environ',{},clear=True), patch('requisition_mail.smtplib.SMTP_SSL') as smtp:
            with self.assertRaises(HTTPException):send_requisition(self.data())
            smtp.assert_not_called()

    def test_partial_delivery_reported(self):
        with patch.dict('os.environ', {'REQUISITION_SMTP_PASSWORD':'test-only'}), patch('requisition_mail.smtplib.SMTP_SSL') as smtp:
            smtp.return_value.__enter__.return_value.send_message.return_value={'copia@example.com':(550,b'rejected')}
            self.assertIn('Envío parcial',send_requisition(self.data())['message'])
