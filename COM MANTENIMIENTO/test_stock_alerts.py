import sqlite3
import unittest
from contextlib import nullcontext
from unittest.mock import patch

from fastapi import FastAPI, HTTPException
from parts_history import register_parts_history


class StockAlertsTests(unittest.TestCase):
    def test_balances_thresholds_and_voids(self):
        connection = sqlite3.connect(':memory:')
        connection.execute("ATTACH DATABASE ':memory:' AS dbo")
        connection.executescript('''
            CREATE TABLE dbo.SpareParts (SparePartId INT, InternalCode TEXT,
                Description TEXT, UnitOfMeasure TEXT, StorageLocation TEXT,
                MinimumStock NUMERIC, Active INT);
            CREATE TABLE dbo.SparePartPurchases (SparePartId INT, Quantity NUMERIC, VoidedAt TEXT);
            CREATE TABLE dbo.MaintenancePartsUsed (SparePartId INT, Quantity NUMERIC, VoidedAt TEXT);
            INSERT INTO dbo.SpareParts VALUES
                (1,'LOW','Bajo','u',NULL,5,1), (2,'OK','Suficiente','u',NULL,5,1),
                (3,'EMPTY','Sin movimientos','u',NULL,2,1), (4,'OFF','Inactivo','u',NULL,5,0),
                (5,'ZERO','Sin mínimo','u',NULL,0,1), (6,'NEG','Negativo','u',NULL,1,1);
            INSERT INTO dbo.SparePartPurchases VALUES
                (1,4,NULL), (1,6,NULL), (1,100,'anulado'), (2,6,NULL);
            INSERT INTO dbo.MaintenancePartsUsed VALUES
                (1,2,NULL), (1,3,NULL), (2,10,'anulado'), (6,1.5,NULL);
            CREATE TABLE dbo.SparePartOpeningBalances (SparePartId INT, CutoffDate TEXT, Quantity NUMERIC);
            CREATE TABLE dbo.MaintenanceEvents (MaintenanceEventId INT, PerformedOn TEXT);
            INSERT INTO dbo.MaintenanceEvents VALUES (1,'2026-01-01'), (2,'2026-01-02'), (3,'2025-12-31');
            ALTER TABLE dbo.MaintenancePartsUsed ADD COLUMN MaintenanceEventId INT DEFAULT 1;
            ALTER TABLE dbo.SparePartPurchases ADD COLUMN PurchasedOn TEXT DEFAULT '2026-01-01';
            INSERT INTO dbo.SpareParts VALUES
                (7,'CUT','Con corte','u',NULL,5,1), (8,'INITIAL','Solo saldo','u',NULL,5,1),
                (9,'ENOUGH','Saldo suficiente','u',NULL,5,1);
            INSERT INTO dbo.SparePartOpeningBalances VALUES
                (7,'2026-01-01',10), (8,'2026-01-01',2), (9,'2026-01-01',20);
            INSERT INTO dbo.SparePartPurchases VALUES
                (7,100,NULL,'2025-12-31'), (7,100,NULL,'2026-01-01'),
                (7,3,NULL,'2026-01-02'), (7,50,'anulado','2026-01-02');
            INSERT INTO dbo.MaintenancePartsUsed VALUES
                (7,90,NULL,3), (7,90,NULL,1), (7,8,NULL,2), (7,50,'anulado',2);
        ''')
        app = FastAPI()
        register_parts_history(app, lambda: connection, lambda: 1, lambda: 1)
        stock_endpoint = next(route.endpoint for route in app.routes if route.path == '/stock-repuestos')
        with patch('parts_history.closing', side_effect=nullcontext):
            all_stock = stock_endpoint(usuario_id=1)
        balances = {row['internal_code']: row['current_stock'] for row in all_stock}
        self.assertEqual(len(balances), 9)
        self.assertEqual(balances['OK'], 6)
        self.assertEqual(balances['ENOUGH'], 20)
        self.assertEqual(balances['ZERO'], 0)
        self.assertEqual(balances['OFF'], 0)
        self.assertEqual(balances['CUT'], 5)
        endpoint = next(route.endpoint for route in app.routes if route.path == '/alertas-stock')
        result = endpoint(usuario_id=1)
        self.assertEqual([(row['internal_code'], row['current_stock']) for row in result],
                         [('NEG', -1.5), ('EMPTY', 0), ('INITIAL', 2), ('CUT', 5), ('LOW', 5)])

    def test_connection_failure_is_not_an_empty_alert_list(self):
        def unavailable():
            raise RuntimeError('offline')
        app = FastAPI()
        register_parts_history(app, unavailable, lambda: 1, lambda: 1)
        endpoint = next(route.endpoint for route in app.routes if route.path == '/alertas-stock')
        with self.assertRaises(HTTPException) as error:
            endpoint(usuario_id=1)
        self.assertEqual(error.exception.status_code, 503)


if __name__ == '__main__':
    unittest.main()
