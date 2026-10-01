import unittest
from datetime import datetime
from decimal import Decimal
from unittest.mock import MagicMock
from fastapi import HTTPException
from pydantic import ValidationError
from preventive_hours import HourReading, machine_threshold, record_reading, finish_hour_work, hour_states
from preventive_maintenance import Frequency


class ThresholdTests(unittest.TestCase):
    frequency = dict(unit='HORAS',every=500,first_hours=50,advance_hours=10)

    def state(self, hours, completed=None, opened=None, plan=None):
        reading = None if hours is None else dict(hours=str(hours),counter_hours=str(hours),observed_at='2026-01-01T08:00:00')
        return machine_threshold(plan or {},self.frequency,1,reading,completed,opened)

    def test_first_service_and_advance(self):
        for value,state in ((None,'SIN_LECTURA'),(0,'AL_DIA'),(39,'AL_DIA'),(40,'PROXIMO'),(49,'PROXIMO'),(50,'VENCIDO'),(80,'VENCIDO')):
            self.assertEqual(self.state(value)['state'],state)

    def test_next_cycle_starts_at_actual_change(self):
        result = self.state(55,completed=55)
        self.assertEqual(result['target_hours'],'555')
        self.assertEqual(result['state'],'AL_DIA')
        self.assertEqual(self.state(545,completed=55)['state'],'PROXIMO')
        self.assertEqual(self.state(555,completed=55)['state'],'VENCIDO')

    def test_open_work_suppresses_duplicate_alerts(self):
        self.assertEqual(self.state(80,opened=9)['state'],'EN_TRABAJO')

    def test_existing_equipment_can_skip_initial_change(self):
        result = self.state(1000,plan={'hour_base':'1000','first_service_done':True})
        self.assertEqual(result['target_hours'],'1500')

    def test_reference_and_missing_first_interval(self):
        self.assertEqual(self.state(5,plan={'hour_base':10})['state'],'REVISAR_REFERENCIA')
        result = machine_threshold({},dict(unit='HORAS',every=500),1,None)
        self.assertEqual(result['target_hours'],'500')

    def test_invalid_advance_rejected(self):
        for hours in (-1,50,500):
            with self.assertRaises(ValidationError):
                Frequency(unit='HORAS',every=500,first_hours=50,advance_hours=hours)


class ResetTests(unittest.TestCase):
    def record(self, previous, raw, reset=False):
        cursor = MagicMock()
        cursor.execute.return_value.fetchone.side_effect = [(1,),previous]
        result = record_reading(cursor,HourReading(machine_id=1,hours=raw,counter_reset=reset,observed_at=datetime(2026,1,2)),1)
        return result,cursor

    def test_reset_preserves_usage_and_next_interval(self):
        result,_ = self.record((Decimal(55),datetime(2026,1,1),Decimal(55)),0,True)
        self.assertEqual(result['hours'],'55')
        result,_ = self.record((Decimal(55),datetime(2026,1,1),Decimal(0)),490)
        self.assertEqual(result['hours'],'545')
        threshold = machine_threshold({},dict(every=500,first_hours=50,advance_hours=10),1,result,completed=55)
        self.assertEqual(threshold['state'],'PROXIMO')
        self.assertEqual(threshold['remaining_hours'],'10')
        self.assertEqual(threshold['counter_hours'],'490')

    def test_reset_does_not_count_as_service(self):
        result,_ = self.record((Decimal(55),datetime(2026,1,1),Decimal(55)),0,True)
        threshold = machine_threshold({},dict(every=500,first_hours=50,advance_hours=10),1,result)
        self.assertEqual(threshold['state'],'VENCIDO')

    def test_drop_requires_explicit_reset(self):
        with self.assertRaises(HTTPException) as error:
            self.record((Decimal(55),datetime(2026,1,1),Decimal(55)),0)
        self.assertEqual(error.exception.status_code,409)

    def test_reset_needs_previous_reading(self):
        with self.assertRaises(HTTPException): self.record(None,0,True)

    def test_out_of_order_sample_rejected(self):
        with self.assertRaises(HTTPException): self.record((Decimal(10),datetime(2026,1,3),Decimal(10)),20)

    def test_same_sample_is_idempotent_even_for_a_reset(self):
        result,cursor = self.record((Decimal(55),datetime(2026,1,2),Decimal(0)),0,True)
        self.assertEqual(result['hours'],'55')
        self.assertFalse(any('INSERT' in call.args[0] for call in cursor.execute.call_args_list))


class HistoryTests(unittest.TestCase):
    def states(self, history, legacy=()):
        cursor = MagicMock()
        cursor.execute.return_value.fetchall.side_effect = [
            [(1,Decimal(545),datetime(2026,1,1),Decimal(490)),(2,Decimal(20),datetime(2026,1,1),Decimal(20))],
            history, legacy]
        catalog = dict(activities=[dict(id=1,active=True,name='Oil',group='MECANICO',frequency=ThresholdTests.frequency)],
                       plans=[dict(id=3,activity_id=1,active=True,scope='GENERAL',machine_ids=[1,2])])
        return hour_states(cursor,catalog)[0]['machines']

    def test_general_plan_preserves_individual_completed_baselines(self):
        machines = self.states([(3,1,Decimal(55),7,'CERRADA')])
        self.assertEqual([m['state'] for m in machines],['PROXIMO','AL_DIA'])
        self.assertEqual(machines[0]['remaining_hours'],'10')
        self.assertEqual(machines[1]['target_hours'],'50')

    def test_open_hour_or_previous_calendar_order_suppresses_duplicates(self):
        machines = self.states([(3,1,None,8,'EN_PROCESO')])
        self.assertEqual(machines[0]['state'],'EN_TRABAJO')
        machines = self.states([],[(3,9)])
        self.assertTrue(all(m['state']=='EN_TRABAJO' for m in machines))


class CompletionTests(unittest.TestCase):
    def original(self,status='REALIZADO'):
        return {'preventive':{'hour_targets':[{'machine_id':1,'current_hours':'40'}], 'items':[{'status':status}]}}

    def test_final_reading_is_recorded_with_successful_service(self):
        cursor = MagicMock()
        cursor.execute.return_value.fetchone.side_effect = [(1,),(Decimal(40),datetime(2026,1,1),Decimal(40))]
        finish_hour_work(cursor,7,self.original(),{'1':Decimal(55)},2)
        args = cursor.execute.call_args.args
        self.assertIn('CompletedHours',args[0])
        self.assertEqual(args[1:],(Decimal(55),7,1))

    def test_completion_requires_all_readings(self):
        with self.assertRaises(HTTPException): finish_hour_work(MagicMock(),7,self.original(),{},2)

    def test_unperformed_work_does_not_restart_interval(self):
        cursor=MagicMock()
        finish_hour_work(cursor,7,self.original('NO_REALIZADO'),{},2)
        cursor.execute.assert_not_called()

    def test_calendar_work_is_unchanged(self):
        cursor=MagicMock()
        finish_hour_work(cursor,7,{}, {},2)
        cursor.execute.assert_not_called()


if __name__=='__main__': unittest.main()
