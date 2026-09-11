import unittest
from datetime import date
from unittest.mock import MagicMock
import base64
import json
import pyodbc
from pydantic import ValidationError
from fastapi import FastAPI, HTTPException
from requisition_records import InvoiceWrite, ReceiptWrite, register_requisition_records
from purchase_requisitions import RequisitionWrite


class RecordsTests(unittest.TestCase):
    def setUp(self):
        self.connection = MagicMock()
        self.cursor = self.connection.cursor.return_value
        self.app = FastAPI()
        self.active, self.admin = lambda: 1, lambda: 2
        register_requisition_records(self.app, lambda: self.connection, self.active, self.admin)
        self.requisition = RequisitionWrite(department='Mantenimiento', requester='Operador',
            requested_on='2026-01-01', urgent=True,
            items=[dict(description='Rodamiento', quantity=2, unit='UN')])
        self.receipt = ReceiptWrite(supplier_id=1, purchased_on='2026-01-02', document_number='F-1',
            items=[dict(spare_part_id=3, quantity=3, unit_cost='12.50')])

    def endpoint(self, path, method='POST'):
        return next(r.endpoint for r in self.app.routes if getattr(r, 'path', '')==path and method in r.methods)

    def test_permissions(self):
        for route in self.app.routes:
            if hasattr(route, 'dependant'):
                expected = self.admin if route.path.endswith(('/recibir','/pendientes')) else self.active
                self.assertIn(expected, [d.call for d in route.dependant.dependencies])

    def test_save_preserves_payload_without_purchase(self):
        self.cursor.execute.return_value.fetchone.return_value = (7,)
        self.assertEqual(self.endpoint('/requisiciones-compra')(self.requisition, user=1)['id'],7)
        args = self.cursor.execute.call_args.args
        self.assertEqual(RequisitionWrite.model_validate_json(args[1]), self.requisition)
        self.assertNotIn('SparePartPurchases', args[0])
        self.connection.commit.assert_called_once()

    def test_receipt_records_actual_quantity_and_cost_atomically(self):
        self.cursor.execute.return_value.fetchone.side_effect = [
            (self.requisition.model_dump_json(), None, None), (1,), ('UN',), None, (42,)]
        result = self.endpoint('/requisiciones-compra/{record_id}/recibir')(7,self.receipt,user=2)
        self.assertEqual(result['purchase_ids'],[42])
        calls = self.cursor.execute.call_args_list
        self.assertIn('UPDLOCK, HOLDLOCK', calls[0].args[0])
        purchase = next(c.args for c in calls if 'INSERT INTO dbo.SparePartPurchases' in c.args[0])
        self.assertEqual(purchase[4:6], (self.receipt.items[0].quantity,self.receipt.items[0].unit_cost))
        self.assertIn('UPDATE dbo.PurchaseRequisitions',calls[-1].args[0])
        self.connection.commit.assert_called_once()

    def test_duplicate_receipt_rejected(self):
        self.cursor.execute.return_value.fetchone.return_value=(self.requisition.model_dump_json(),date.today(),'{}')
        with self.assertRaises(HTTPException) as error:
            self.endpoint('/requisiciones-compra/{record_id}/recibir')(7,self.receipt,user=2)
        self.assertEqual(error.exception.status_code,409)
        self.assertEqual(self.cursor.execute.call_count,1)
        self.connection.rollback.assert_called_once()
        self.connection.commit.assert_not_called()

    def test_cutoff_rejection_rolls_back(self):
        self.cursor.execute.return_value.fetchone.side_effect = [
            (self.requisition.model_dump_json(), None, None), (1,), ('UN',), (date(2026,1,2),)]
        with self.assertRaises(HTTPException):
            self.endpoint('/requisiciones-compra/{record_id}/recibir')(7,self.receipt,user=2)
        self.connection.rollback.assert_called_once()
        self.connection.commit.assert_not_called()

    def test_pending_count_only_unreceived(self):
        self.cursor.execute.return_value.fetchone.return_value=(3,)
        result=self.endpoint('/requisiciones-compra/pendientes','GET')(user=2)
        self.assertEqual(result,{'count':3})
        self.assertIn('ReceivedAt IS NULL',self.cursor.execute.call_args.args[0])

    def invoice(self):
        return InvoiceWrite(filename='factura.pdf',content_base64=base64.b64encode(b'%PDF-1.4\nFactura').decode())

    def test_invoice_types_and_invalid_files(self):
        self.assertEqual(self.invoice().decoded()[1],'application/pdf')
        for name,content in [('foto.jpg',b'\xff\xd8\xfftest'),('foto.png',b'\x89PNG\r\n\x1a\ntest'),('foto.webp',b'RIFF1234WEBPtest')]:
            self.assertTrue(InvoiceWrite(filename=name,content_base64=base64.b64encode(content).decode()).decoded()[1].startswith('image/'))
        for name,content in [('factura.pdf',b'<html>'),('../factura.pdf',b'%PDF-1.4'),('factura.svg',b'<svg/>'),('factura.pdf',b'%PDF-'+b'a'*(10*1024*1024))]:
            with self.subTest(name=name),self.assertRaises(ValidationError):
                InvoiceWrite(filename=name,content_base64=base64.b64encode(content).decode())
        with self.assertRaises(ValidationError):
            InvoiceWrite(filename='factura.pdf',content_base64='!!!')

    def test_receipt_with_invoice_commits_together(self):
        self.receipt.invoice=self.invoice()
        self.cursor.execute.return_value.fetchone.side_effect=[(self.requisition.model_dump_json(),None,None),(1,),('UN',),None,(42,)]
        self.endpoint('/requisiciones-compra/{record_id}/recibir')(7,self.receipt,user=2)
        calls=self.cursor.execute.call_args_list
        attachment=next(c.args for c in calls if 'INSERT INTO dbo.PurchaseRequisitionInvoices' in c.args[0])
        self.assertEqual(bytes(attachment[4]),self.invoice().decoded()[0])
        metadata=json.loads(calls[-1].args[2])
        self.assertEqual(metadata['invoice']['filename'],'factura.pdf')
        self.assertNotIn('content_base64',json.dumps(metadata))
        self.connection.commit.assert_called_once()

    def test_invoice_failure_rolls_back_purchase(self):
        self.receipt.invoice=self.invoice()
        def execute(sql,*args):
            if 'INSERT INTO dbo.PurchaseRequisitionInvoices' in sql:
                raise pyodbc.Error('failure')
            return self.cursor
        self.cursor.execute.side_effect=execute
        self.cursor.fetchone.side_effect=[(self.requisition.model_dump_json(),None,None),(1,),('UN',),None,(42,)]
        with self.assertRaises(HTTPException) as error:
            self.endpoint('/requisiciones-compra/{record_id}/recibir')(7,self.receipt,user=2)
        self.assertEqual(error.exception.status_code,503)
        self.connection.rollback.assert_called_once()
        self.connection.commit.assert_not_called()

    def test_invoice_download_and_missing(self):
        self.cursor.execute.return_value.fetchone.return_value=('factura.pdf','application/pdf',b'%PDF-test')
        response=self.endpoint('/requisiciones-compra/{record_id}/factura','GET')(7,user=1)
        self.assertEqual(response.body,b'%PDF-test')
        self.assertEqual(response.headers['cache-control'],'no-store')
        self.cursor.execute.return_value.fetchone.return_value=None
        with self.assertRaises(HTTPException) as error:
            self.endpoint('/requisiciones-compra/{record_id}/factura','GET')(7,user=1)
        self.assertEqual(error.exception.status_code,404)
