import unittest
from unittest.mock import patch
from pydantic import ValidationError
from fastapi import HTTPException
from requisition_mail import RequisitionMail, send_requisition


class MailTests(unittest.TestCase):
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
