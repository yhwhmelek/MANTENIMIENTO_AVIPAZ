from io import BytesIO
from pathlib import PurePosixPath
import posixpath
import unittest
import zipfile
import xml.etree.ElementTree as E

from fastapi import FastAPI
from pydantic import ValidationError
from purchase_requisitions import NS, TEMPLATE, RequisitionWrite, generate_requisition, register_purchase_requisitions


class RequisitionTests(unittest.TestCase):
    def data(self, **changes):
        return RequisitionWrite(**(dict(department='Mantenimiento', requested_on='2026-09-09', urgent=True,
            requester='Operador de prueba', items=[dict(description='Malla 1.5 mm',quantity='2.50',unit='UNIDAD',specifications='Molino ANDRITZ')]) | changes))

    def test_generated_values_and_unused_rows(self):
        data=self.data(supplier='Proveedor ejemplo',machine_codes='MOL-01 / MOL-02',observations='Entrega en bodega')
        with zipfile.ZipFile(BytesIO(generate_requisition(data))) as z:
            sheet=E.fromstring(z.read('xl/worksheets/sheet1.xml'))
            def cell(ref):return ''.join(sheet.find(f'.//{{{NS}}}c[@r="{ref}"]').itertext())
            self.assertEqual(cell('B5'),'Mantenimiento')
            self.assertEqual(cell('E5'),'Proveedor ejemplo')
            self.assertEqual(cell('B6'),'09/09/2026')
            self.assertEqual(cell('B7'),'ASAP / Urgente')
            self.assertEqual(cell('E6'),'MOL-01 / MOL-02')
            self.assertEqual(cell('A9'),'Malla 1.5 mm')
            self.assertEqual(cell('B9'),'2.50')
            self.assertEqual(cell('D9'),'Molino ANDRITZ')
            self.assertEqual(cell('B20'),'Entrega en bodega')
            self.assertEqual(cell('B25'),'Operador de prueba')
            for row in range(10,20):self.assertEqual(cell(f'A{row}'),'')
            self.assertEqual(sheet.find(f'.//{{{NS}}}c[@r="B9"]').get('t'),'n')

    def test_template_preserves_format_but_not_old_business_data(self):
        with zipfile.ZipFile(TEMPLATE) as z:
            workbook=E.fromstring(z.read('xl/workbook.xml'))
            self.assertEqual(len(workbook.find(f'{{{NS}}}sheets')),1)
            self.assertIn('xl/media/image1.jpeg',z.namelist())
            self.assertNotIn('xl/worksheets/sheet2.xml',z.namelist())
            self.assertNotIn('xl/sharedStrings.xml',z.namelist())
            self.assertNotIn('xl/media/image2.emf',z.namelist())
            text=''.join(z.read(n).decode('utf-8') for n in z.namelist() if n.endswith('.xml'))
            for old in ['SER&amp;PRO','Cristian Channgoluisa','Caterpillar','IASA','Planta Samanga']:
                self.assertNotIn(old,text)
            self.assertIn('CO/01-01',text)
            self.assertIn('Versión: 03',text)
            sheet=E.fromstring(z.read('xl/worksheets/sheet1.xml'))
            self.assertEqual(len(sheet.find(f'{{{NS}}}mergeCells')),21)
            # Every internal relationship resolves to an existing package member.
            for name in z.namelist():
                if name.endswith('.rels'):
                    base='' if name=='_rels/.rels' else str(PurePosixPath(name).parent.parent)
                    for rel in E.fromstring(z.read(name)):
                        target=posixpath.normpath(posixpath.join(base,rel.get('Target')))
                        self.assertIn(target,z.namelist())

    def test_literal_text_and_xml_escaping(self):
        with zipfile.ZipFile(BytesIO(generate_requisition(self.data(observations='=SUM(1,2) <revisar> & confirmar')))) as z:
            root=E.fromstring(z.read('xl/worksheets/sheet1.xml'))
            cell=root.find(f'.//{{{NS}}}c[@r="B20"]')
            self.assertEqual(cell.get('t'),'inlineStr')
            self.assertEqual(''.join(cell.itertext()),'=SUM(1,2) <revisar> & confirmar')
            self.assertIsNone(cell.find(f'{{{NS}}}f'))

    def test_validation(self):
        for change in [dict(items=[]),dict(items=[dict(description='Malla',quantity=0,unit='u')]),
                       dict(urgent=False),dict(urgent=True,delivery_on='2026-09-10'),
                       dict(urgent=False,delivery_on='2026-09-08'),dict(requester=' '),
                       dict(observations='bad\x00text'),dict(items=[dict(description='Malla',quantity=1,unit='u')]*12)]:
            with self.subTest(change=change),self.assertRaises(ValidationError):self.data(**change)
        self.data(urgent=False,delivery_on='2026-09-09')

    def test_maximum_items_and_date_delivery(self):
        data=self.data(urgent=False,delivery_on='2026-09-12',items=[dict(description=f'Item {i}',quantity=i,unit='u') for i in range(1,12)])
        with zipfile.ZipFile(BytesIO(generate_requisition(data))) as z:
            root=E.fromstring(z.read('xl/worksheets/sheet1.xml'))
            self.assertEqual(''.join(root.find(f'.//{{{NS}}}c[@r="A19"]').itertext()),'Item 11')
            self.assertEqual(''.join(root.find(f'.//{{{NS}}}c[@r="B7"]').itertext()),'12/09/2026')

    def test_authenticated_download(self):
        app=FastAPI();active=lambda:1
        register_purchase_requisitions(app,active)
        route=next(r for r in app.routes if r.path=='/requisiciones-compra/archivo')
        self.assertIn(active,[d.call for d in route.dependant.dependencies])
        result=route.endpoint(self.data(),usuario_id=1)
        self.assertIn('.xlsx',result.headers['content-disposition'])
        self.assertTrue(result.body.startswith(b'PK'))


if __name__=='__main__':unittest.main()
