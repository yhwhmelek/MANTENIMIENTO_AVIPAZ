import unittest
from datetime import date
from unittest.mock import MagicMock

from fastapi import FastAPI, HTTPException
from pydantic import ValidationError

from parts_history import ConsumptionWrite, InterventionWrite, PurchaseWrite, VoidWrite, register_parts_history


class PartsHistoryTests(unittest.TestCase):
    def setUp(self):
        self.connection = MagicMock()
        self.cursor = self.connection.cursor.return_value
        self.connect = MagicMock(return_value=self.connection)
        self.app = FastAPI()
        self.active = lambda: 1
        self.admin = lambda: 1
        register_parts_history(self.app, self.connect, self.active, self.admin)

    def endpoint(self, path, method):
        return next(route.endpoint for route in self.app.routes if getattr(route, 'path', '') == path and method in route.methods)

    def test_write_permissions(self):
        for route in self.app.routes:
            if not hasattr(route, 'dependant'):
                continue
            expected = self.admin if 'POST' in route.methods else self.active
            self.assertIn(expected, [dependency.call for dependency in route.dependant.dependencies])

    def test_invalid_hours_and_quantities(self):
        for fields in ({'quantity': 0}, {'quantity': '1.001'}, {'quantity': 2, 'removed_installed_hour_meter': 10, 'removed_hour_meter': 20},
                       {'removed_installed_hour_meter': 20, 'removed_hour_meter': 10}, {'removed_hour_meter': 20}):
            with self.subTest(fields=fields), self.assertRaises(ValidationError):
                ConsumptionWrite(**({'maintenance_event_id': 1, 'spare_part_id': 2, 'quantity': 1} | fields))
        data = ConsumptionWrite(maintenance_event_id=1, spare_part_id=2, quantity=1, removed_installed_hour_meter=10, removed_hour_meter=20)
        self.assertEqual(data.removed_hour_meter - data.removed_installed_hour_meter, 10)

    def test_purchase_validation(self):
        base = dict(spare_part_id=1, supplier_id=2, purchased_on='2026-01-01', quantity=1, unit_cost=45, document_number='F-001')
        for fields in ({'document_number': '  '}, {'unit_cost': -1}, {'currency': 'dollars'}, {'quantity': -1}):
            with self.subTest(fields=fields), self.assertRaises(ValidationError):
                PurchaseWrite(**(base | fields))

    def test_intervention_rejects_other_machine_element(self):
        self.cursor.execute.return_value.fetchone.return_value = None
        with self.assertRaises(HTTPException) as error:
            self.endpoint('/intervenciones', 'POST')(InterventionWrite(machine_id=1, element_id=22, performed_on='2026-01-01', maintenance_type='CORRECTIVO', description='Cambio de rodamiento'), usuario_id=1)
        self.assertEqual(error.exception.status_code, 422)
        self.connection.commit.assert_not_called()

    def test_purchase_preserves_cost_and_unit_without_updating_catalog(self):
        self.cursor.execute.return_value.fetchone.side_effect = [('UN',), (2,), (7,)]
        data = PurchaseWrite(spare_part_id=1, supplier_id=2, purchased_on='2026-01-01', quantity=2, unit_cost='45.20', document_number='F-001')
        result = self.endpoint('/compras-repuestos', 'POST')(data, usuario_id=9)
        self.assertEqual(result, {'id': 7})
        insert = self.cursor.execute.call_args.args
        self.assertIn('INSERT INTO dbo.SparePartPurchases', insert[0])
        self.assertEqual(insert[5], data.unit_cost)
        self.assertIn('UN', insert)
        self.assertFalse(any('UPDATE' in call.args[0] for call in self.cursor.execute.call_args_list))
        self.connection.commit.assert_called_once()

    def test_consumption_references_intervention(self):
        self.cursor.execute.return_value.fetchone.side_effect = [('UN',), (5,)]
        data = ConsumptionWrite(maintenance_event_id=3, spare_part_id=2, quantity=1)
        self.endpoint('/consumos-repuestos', 'POST')(data, usuario_id=9)
        insert = self.cursor.execute.call_args.args
        self.assertIn('INSERT INTO dbo.MaintenancePartsUsed', insert[0])
        self.assertEqual(insert[1:3], (3, 2))
        self.connection.commit.assert_called_once()

    def test_history_filters_and_latest_order(self):
        self.cursor.description = [('id',)]
        self.cursor.fetchall.return_value = [(1,)]
        self.endpoint('/compras-repuestos', 'GET')(spare_part_id=2, start=date(2026, 1, 1), end=date(2026, 12, 31), include_voided=False, usuario_id=1)
        sql, *args = self.cursor.execute.call_args.args
        self.assertIn('p.VoidedAt IS NULL', sql)
        self.assertIn('p.PurchasedOn DESC, p.SparePartPurchaseId DESC', sql)
        self.assertEqual(args, [2, date(2026, 1, 1), date(2026, 12, 31)])

    def test_interventions_filter_machine_and_period(self):
        self.cursor.description = [('maintenance_event_id',)]
        self.cursor.fetchall.return_value = []
        self.endpoint('/intervenciones', 'GET')(machine_id=7, start=date(2026, 1, 1), end=date(2026, 12, 31), usuario_id=1)
        sql, *args = self.cursor.execute.call_args.args
        self.assertIn('e.MachineId=?', sql)
        self.assertIn('e.PerformedOn>=?', sql)
        self.assertIn('e.PerformedOn<=?', sql)
        self.assertEqual(args, [7, date(2026, 1, 1), date(2026, 12, 31)])

    def test_interventions_reject_invalid_period(self):
        with self.assertRaises(HTTPException):
            self.endpoint('/intervenciones', 'GET')(machine_id=None, start=date(2026, 12, 31), end=date(2026, 1, 1), usuario_id=1)
        self.connect.assert_not_called()

    def test_invalid_period_never_queries_database(self):
        with self.assertRaises(HTTPException):
            self.endpoint('/compras-repuestos', 'GET')(spare_part_id=None, start=date(2026, 12, 31), end=date(2026, 1, 1), include_voided=False, usuario_id=1)
        self.connect.assert_not_called()

    def test_annul_requires_reason_and_preserves_record(self):
        with self.assertRaises(ValidationError):
            VoidWrite(reason=' ')
        self.cursor.rowcount = 1
        self.endpoint('/consumos-repuestos/{record_id}/anular', 'POST')(record_id=5, data=VoidWrite(reason='Duplicado'), usuario_id=9)
        sql, *args = self.cursor.execute.call_args.args
        self.assertIn('VoidedAt IS NULL', sql)
        self.assertIn('UPDATE dbo.MaintenancePartsUsed', sql)
        self.assertEqual(args, [9, 'Duplicado', 5])
        self.connection.commit.assert_called_once()

    def test_already_annulled_is_not_modified(self):
        self.cursor.rowcount = 0
        with self.assertRaises(HTTPException) as error:
            self.endpoint('/compras-repuestos/{record_id}/anular', 'POST')(record_id=5, data=VoidWrite(reason='Duplicado'), usuario_id=9)
        self.assertEqual(error.exception.status_code, 404)
        self.connection.commit.assert_not_called()


if __name__ == '__main__':
    unittest.main()
