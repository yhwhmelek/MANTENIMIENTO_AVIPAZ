import json
import unittest
from datetime import date
from unittest.mock import MagicMock

from fastapi import FastAPI, HTTPException
from pydantic import ValidationError
from preventive_maintenance import ActivityWrite, Frequency, due_cycles, next_due, register_preventive, validate_frequency_change


class FrequencyTests(unittest.TestCase):
    def test_hour_intervals_accept_large_positive_integers(self):
        for hours in (1, 250, 2500, 10000, 1000000):
            self.assertEqual(Frequency(every=hours, unit='HORAS').every, hours)
        for hours in (0, -1, 1000001, 1.5):
            with self.assertRaises(ValidationError):
                Frequency(every=hours, unit='HORAS')
        with self.assertRaises(ValidationError):
            Frequency(every=1201, unit='SEMANAS')

    def test_hour_plans_wait_for_usage_readings_even_with_overdue_dates(self):
        activity = {'frequency':{'every':250,'unit':'HORAS'}}
        for plan in ({}, {'next_due':'2000-01-01','first_due':'2000-01-01'}):
            self.assertEqual(due_cycles(plan, activity, date(2026,10,1)), [])
        with self.assertRaises(ValueError):
            next_due(date(2026,10,1), activity['frequency'], 1)

    def test_effective_override_controls_trigger(self):
        weekly = {'frequency':{'every':2,'unit':'SEMANAS'}}
        plan = {'next_due':'2026-09-28','first_due':'2026-09-28','frequency_override':{'every':500,'unit':'HORAS'}}
        self.assertEqual(due_cycles(plan, weekly, date(2026,10,1)), [])
        plan['frequency_override'] = {'every':2,'unit':'SEMANAS'}
        cycles = due_cycles(plan, {'frequency':{'every':500,'unit':'HORAS'}}, date(2026,10,1))
        self.assertEqual(len(cycles), 1)
        self.assertEqual(cycles[0]['next_due'], '2026-10-12')

    def test_legacy_frequency_can_be_kept_but_not_newly_assigned(self):
        for unit in ('DIAS','MESES'):
            old = {'every':1,'unit':unit}
            validate_frequency_change(old, old)
            for previous in (None, {'every':2,'unit':unit}, {'every':1,'unit':'SEMANAS'}):
                with self.assertRaises(HTTPException):
                    validate_frequency_change(old, previous)
            for new_unit in ('SEMANAS','HORAS'):
                validate_frequency_change({'every':1,'unit':new_unit}, old)


class FrequencyEndpointTests(unittest.TestCase):
    def setUp(self):
        self.connection = MagicMock()
        self.app = FastAPI()
        register_preventive(self.app, lambda:self.connection, lambda:1, lambda:1)
        self.data = dict(name='Engrase', procedure='Lubricar puntos indicados', group='MECANICO',
                         duration_minutes=60, factors={'n':2,'i':2,'c':2}, frequency={'every':2500,'unit':'HORAS'})

    def endpoint(self, path, method):
        return next(r.endpoint for r in self.app.routes if r.path == path and method in r.methods)

    def test_create_hours_persists_operating_unit(self):
        self.connection.cursor.return_value.execute.return_value.fetchone.return_value = (5,)
        self.assertEqual(self.endpoint('/preventivos/actividades','POST')(ActivityWrite(**self.data),usuario_id=1), {'id':5})
        args = self.connection.cursor.return_value.execute.call_args.args
        self.assertEqual(json.loads(args[1])['frequency'], {'every':2500,'unit':'HORAS','first_hours':None,'advance_hours':0})
        self.connection.commit.assert_called_once()

    def test_new_legacy_frequency_rejected_before_insert(self):
        self.data['frequency'] = {'every':1,'unit':'MESES'}
        with self.assertRaises(HTTPException) as error:
            self.endpoint('/preventivos/actividades','POST')(ActivityWrite(**self.data),usuario_id=1)
        self.assertEqual(error.exception.status_code,422)
        self.connection.cursor.return_value.execute.assert_not_called()

    def test_edit_legacy_activity_keeps_its_original_frequency(self):
        self.data['frequency'] = {'every':1,'unit':'MESES'}
        self.connection.cursor.return_value.execute.return_value.fetchone.return_value = (1,json.dumps(self.data))
        result = self.endpoint('/preventivos/actividades/{activity_id}','PUT')(5,ActivityWrite(**self.data,revision=1),usuario_id=1)
        self.assertEqual(result, {'id':5})
        self.connection.commit.assert_called_once()


if __name__ == '__main__':
    unittest.main()
