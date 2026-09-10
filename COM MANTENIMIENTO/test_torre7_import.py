import json
from pathlib import Path
import unittest

from imports.prepare_torre7 import generate, numeric, specs, sql_text


class Torre7ImportTests(unittest.TestCase):
    def setUp(self):
        self.records = json.loads((Path(__file__).parent / 'imports/torre7_source.json').read_text(encoding='utf-8'))

    def test_document_counts_and_omissions(self):
        ready, omitted, sql = generate(self.records)
        self.assertEqual(len(self.records), 69)
        self.assertEqual(len(ready), 65)
        self.assertEqual(sum(r['motors'] for r in ready), 66)
        self.assertEqual({r['code'] for r in omitted}, {'T7RNG1', 'T7SET2'})
        self.assertNotIn("N'T7RNG1'", sql)
        self.assertNotIn("N'T7SET2'", sql)
        self.assertEqual(sql.count('INSERT INTO @Motors'), 66)

    def test_second_bin_block_and_two_motors(self):
        bin8 = next(r for r in self.records if r['sheet'] == 'BIN PRODUCTO TERMINADO 8')
        self.assertEqual(bin8['machine']['CÓDIGO'], 'T7BPT8')
        self.assertEqual(bin8['machine']['NOMBRE DEL EQUIPO'], 'BIN PRODUCTO TERMINADO 8')
        dryer = next(r for r in self.records if r['sheet'] == 'SECADORA 1')
        self.assertEqual(dryer['motors'], 2)

    def test_multiple_values_not_reduced_to_one_rating(self):
        self.assertIsNone(numeric('230 / 460 V', 'V'))
        self.assertIsNone(numeric('4.3-4.2/2.1 A', 'A'))
        self.assertIsNone(numeric('1800 - 2700 RPM', 'RPM'))
        self.assertEqual(numeric('0,8 A', 'A'), '0.8')
        result = specs({'POTENCIA': '20 Hp / 15 Kw', 'FASES': '3'})
        self.assertEqual(result[:2], ['15', '20'])
        self.assertEqual(specs({'POTENCIA': '500 W'})[0], '0.5')

    def test_burner_data_does_not_become_motor_plate_data(self):
        boiler = next(r for r in self.records if r['sheet'] == 'CALDERO 1')
        _, _, sql = generate([boiler])
        machine, motor = sql.splitlines()
        self.assertIn('BALTUR', machine)
        self.assertNotIn('BALTUR', motor)
        self.assertIn('pendiente de verificar', motor)

    def test_blank_values_and_sql_quotes(self):
        self.assertEqual(sql_text("L'equipo"), "N'L''equipo'")
        self.assertEqual(sql_text(''), 'NULL')
        blank = next(r for r in self.records if r['sheet'] == 'CHILLER')
        self.assertFalse(any(blank['motor'].values()))
        _, _, sql = generate([blank])
        self.assertIn('pendiente de verificar', sql)


if __name__ == '__main__':
    unittest.main()
