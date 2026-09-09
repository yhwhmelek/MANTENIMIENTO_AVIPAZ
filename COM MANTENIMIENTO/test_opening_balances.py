import unittest
from datetime import date, timedelta
from unittest.mock import MagicMock

from fastapi import FastAPI, HTTPException
from pydantic import ValidationError
from parts_history import OpeningBalanceWrite, register_parts_history


class OpeningBalanceTests(unittest.TestCase):
    def setUp(self):
        self.connection = MagicMock()
        self.cursor = self.connection.cursor.return_value
        self.app = FastAPI()
        self.admin = lambda: 1
        register_parts_history(self.app, lambda: self.connection, lambda: 1, self.admin)
        self.route = next(route for route in self.app.routes if route.path == '/repuestos/{spare_part_id}/saldo-inicial' and 'POST' in route.methods)

    def test_validation(self):
        for quantity in ['-1', '1.001', '100000000', 'NaN']:
            with self.subTest(quantity=quantity), self.assertRaises(ValidationError):
                OpeningBalanceWrite(cutoff_date=date.today(), quantity=quantity)
        with self.assertRaises(ValidationError):
            OpeningBalanceWrite(cutoff_date=date.today() + timedelta(days=1), quantity=1)
        self.assertEqual(OpeningBalanceWrite(cutoff_date=date.today(), quantity=0).quantity, 0)

    def test_records_balance_unit_and_author_without_purchase(self):
        self.cursor.execute.return_value.fetchone.side_effect = [('kg',), None]
        data = OpeningBalanceWrite(cutoff_date='2026-01-01', quantity='12.50', notes='Conteo físico')
        result = self.route.endpoint(7, data, usuario_id=9)
        self.assertEqual(result['unit_of_measure'], 'kg')
        insert = self.cursor.execute.call_args.args
        self.assertIn('INSERT INTO dbo.SparePartOpeningBalances', insert[0])
        self.assertEqual(insert[1:], (7, data.cutoff_date, data.quantity, 'kg', data.notes, 9))
        self.connection.commit.assert_called_once()
        self.assertIn(self.admin, [dep.call for dep in self.route.dependant.dependencies])

    def test_missing_or_duplicate_rejected(self):
        for rows, status in [([None], 404), ([('u',), (7,)], 409)]:
            with self.subTest(status=status):
                self.cursor.execute.return_value.fetchone.side_effect = rows
                with self.assertRaises(HTTPException) as error:
                    self.route.endpoint(7, OpeningBalanceWrite(cutoff_date='2026-01-01', quantity=0), usuario_id=9)
                self.assertEqual(error.exception.status_code, status)
        self.connection.commit.assert_not_called()


if __name__ == '__main__':
    unittest.main()
