import unittest
from datetime import date
from decimal import Decimal
from unittest.mock import MagicMock

from fastapi import FastAPI, HTTPException
from pydantic import ValidationError

import calibration
from calibration import (InstrumentWrite, PlanWrite, PointWrite, RecordWrite, add_frequency, can_execute, due_cycles, evaluate_point,
                         format_code, project_occurrences, register_calibration)


class CalibrationRulesTests(unittest.TestCase):
    def test_error_and_emp_criterion(self):
        self.assertEqual(evaluate_point(Decimal('40.00'), Decimal('40.00'), Decimal('0.05')), (Decimal('0.00'), True))
        self.assertEqual(evaluate_point(Decimal('40.00'), Decimal('40.05'), Decimal('0.05')), (Decimal('0.05'), True))
        self.assertEqual(evaluate_point(Decimal('40.00'), Decimal('39.94'), Decimal('0.05')), (Decimal('-0.06'), False))

    def test_frequency_and_month_end_anchor(self):
        self.assertEqual(add_frequency(date(2026, 8, 3), 1, 'SEMANAS'), date(2026, 8, 10))
        self.assertEqual(add_frequency(date(2026, 1, 31), 1, 'MESES'), date(2026, 2, 28))
        self.assertEqual(add_frequency(date(2026, 11, 15), 3, 'MESES'), date(2027, 2, 15))
        self.assertEqual(add_frequency(date(2026, 8, 3), 15, 'DIAS'), date(2026, 8, 18))

    def test_projection_inside_range(self):
        dates = project_occurrences(date(2026, 8, 3), 1, 'SEMANAS', date(2026, 8, 5), date(2026, 8, 31))
        self.assertEqual(dates, [date(2026, 8, 10), date(2026, 8, 17), date(2026, 8, 24), date(2026, 8, 31)])

    def test_due_cycles_group_overdue_like_preventives(self):
        cycles, following = due_cycles(date(2026, 11, 2), 1, 'SEMANAS', date(2026, 11, 25), date(2026, 12, 6))
        self.assertEqual(cycles[0], dict(due=date(2026, 11, 23), scheduled=date(2026, 11, 25), skipped=3))
        self.assertEqual([c['scheduled'] for c in cycles[1:]], [date(2026, 11, 30)])
        self.assertEqual(following, date(2026, 12, 7))
        cycles, following = due_cycles(date(2027, 1, 4), 1, 'MESES', date(2026, 12, 1), date(2026, 12, 31))
        self.assertEqual((cycles, following), ([], date(2027, 1, 4)))

    def test_who_can_execute_an_order(self):
        group = dict(assignee_type='GRUPO', responsible_group='ELECTRICO', assigned_user_id=None)
        person = dict(assignee_type='USUARIO', responsible_group='MANTENIMIENTO', assigned_user_id=7)
        contractor = dict(assignee_type='CONTRATISTA', responsible_group='EXTERNO', assigned_user_id=None)
        self.assertTrue(can_execute('ELECTRICO', 3, group))
        self.assertFalse(can_execute('MECANICO', 3, group))
        self.assertTrue(can_execute('MECANICO', 7, person))
        self.assertFalse(can_execute('TECNICO', 8, person))
        self.assertFalse(can_execute('MECANICO', 3, contractor))
        self.assertTrue(can_execute('ADMIN', 1, contractor))

    def test_format_codes_follow_procedure(self):
        self.assertEqual(format_code('BALANZA', 'VERIFICACION_INTERNA'), 'MT/03-04')
        self.assertEqual(format_code('SISTEMA_PESAJE', 'CALIBRACION_INTERNA'), 'MT/03-05')
        self.assertEqual(format_code('MANOMETRO', 'CALIBRACION_EXTERNA'), 'MT/03-02')
        self.assertEqual(format_code('BASCULA_CAMIONERA', 'VERIFICACION_INTERNA'), 'MT/03-02')

    def test_instrument_range_validation(self):
        with self.assertRaises(ValidationError):
            InstrumentWrite(code='Ext-Bal1', name='Balanza', instrument_type='BALANZA', area='Producción',
                            unit='kg', emp=Decimal('0.05'), range_min=Decimal('50'), range_max=Decimal('5'))

    def test_plan_requires_named_assignee(self):
        base = dict(control_method='VERIFICACION_INTERNA', frequency_every=1, frequency_unit='SEMANAS', responsible_group='MECANICO', next_due=date(2026, 12, 1))
        with self.assertRaises(ValidationError):
            PlanWrite(**base, assignee_type='USUARIO')
        plan = PlanWrite(**base, assignee_type='GRUPO', assigned_user_id=5)
        self.assertIsNone(plan.assigned_user_id)


class CalibrationRecordTests(unittest.TestCase):
    def setUp(self):
        self.connection = MagicMock()
        self.cursor = self.connection.cursor.return_value
        app = FastAPI()
        register_calibration(app, lambda: self.connection, lambda: 1, lambda: 1)
        self.routes = {(route.path, method): route.endpoint for route in app.routes for method in route.methods}
        self.original_today = calibration.today
        calibration.today = lambda: date(2026, 8, 24)

    def tearDown(self):
        calibration.today = self.original_today

    def record(self, measured='40.00', action='NINGUNA', order_id=None):
        return RecordWrite(instrument_id=1, plan_id=7, order_id=order_id, performed_on=date(2026, 8, 24), standard_ids=[3], action_taken=action,
                           points=[PointWrite(label='1 Centro', reference_value=Decimal('40'), measured_value=Decimal(measured))])

    def prepare(self, role='MECANICO', order=None, standard_valid_until=date(2027, 1, 1)):
        self.cursor.execute.return_value.fetchone.side_effect = [
            (role,),                                                     # rol del usuario
            ('BALANZA', Decimal('0.05')),                                # instrumento
            order,                                                       # orden abierta del plan
            ('VERIFICACION_INTERNA', 1, 'SEMANAS', date(2026, 8, 24)),   # plan
            (55,),                                                       # id del registro
        ]
        self.cursor.execute.return_value.fetchall.return_value = [(3, 'PP-20-01', True, standard_valid_until)]

    def test_nonconforming_requires_action(self):
        self.prepare()
        with self.assertRaises(HTTPException) as raised:
            self.routes['/calibracion/registros', 'POST'](self.record(measured='40.10'), 1)
        self.assertEqual(raised.exception.status_code, 422)
        self.connection.commit.assert_not_called()

    def test_expired_standard_is_rejected(self):
        self.prepare(standard_valid_until=date(2026, 8, 1))
        with self.assertRaises(HTTPException) as raised:
            self.routes['/calibracion/registros', 'POST'](self.record(), 1)
        self.assertIn('PP-20-01', raised.exception.detail)

    def test_order_assigned_to_another_person_is_rejected(self):
        order = (12, 7, 1, 'VERIFICACION_INTERNA', 'PROGRAMADA', 'USUARIO', 99, 'MANTENIMIENTO', date(2026, 8, 24))
        self.prepare(order=order)
        with self.assertRaises(HTTPException) as raised:
            self.routes['/calibracion/registros', 'POST'](self.record(), 1)
        self.assertEqual(raised.exception.status_code, 403)

    def test_closed_order_is_rejected(self):
        self.cursor.execute.return_value.fetchone.side_effect = [
            ('ADMIN',), ('BALANZA', Decimal('0.05')), (12, 7, 1, 'VERIFICACION_INTERNA', 'REALIZADA', 'GRUPO', None, 'MECANICO', date(2026, 8, 24))]
        with self.assertRaises(HTTPException) as raised:
            self.routes['/calibracion/registros', 'POST'](self.record(order_id=12), 1)
        self.assertEqual(raised.exception.status_code, 409)

    def test_future_date_is_rejected(self):
        self.cursor.execute.return_value.fetchone.side_effect = [('ADMIN',)]
        data = self.record()
        data.performed_on = date(2026, 9, 1)
        with self.assertRaises(HTTPException) as raised:
            self.routes['/calibracion/registros', 'POST'](data, 1)
        self.assertEqual(raised.exception.status_code, 422)

    def test_operator_cannot_use_module(self):
        self.cursor.execute.return_value.fetchone.side_effect = [('OPERADOR',)]
        with self.assertRaises(HTTPException) as raised:
            self.routes['/calibracion/instrumentos', 'GET'](1)
        self.assertEqual(raised.exception.status_code, 403)


if __name__ == '__main__':
    unittest.main()
