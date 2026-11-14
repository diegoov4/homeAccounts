"""Pruebas del lector de extractos bancarios. Uso: npm run test:bank"""
import datetime as dt
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / 'scripts'))
import bank_import as b  # noqa: E402


class Parsing(unittest.TestCase):
    def test_amounts(self):
        cases = {'1.234,56 €': 1234.56, '-12,30': -12.3, '12,30-': -12.3, '(5,00)': -5.0, '-1.200,00': -1200.0,
                 '1,234.56': 1234.56, '1.200': 1200.0, 12.5: 12.5, '': None, None: None, 'abc': None}
        for raw, expected in cases.items():
            self.assertEqual(b.parse_amount(raw), expected, raw)

    def test_dates(self):
        d = dt.date(2026, 10, 3)
        for raw in ['03/10/2026', '03-10-2026', '03/10/26', '2026-10-03', dt.datetime(2026, 10, 3, 9, 0), 46298]:
            self.assertEqual(b.parse_date(raw), d, raw)
        self.assertIsNone(b.parse_date('hola'))

    def test_header_detection(self):
        rows = [['Extracto'], [None], ['F.VALOR', 'FECHA', 'CONCEPTO', 'IMPORTE', 'SALDO'], ['01/10/2026', '02/10/2026', 'X', '-1,00', '5']]
        h, cols = b.detect_header(rows)
        self.assertEqual(h, 2)
        self.assertEqual(cols['fecha'], 1)  # fecha de operación, no fecha valor
        rows = [['Fecha', 'Concepto', 'Cargo', 'Abono']]
        self.assertEqual(b.detect_header(rows)[1], {'fecha': 0, 'concepto': 1, 'cargo': 2, 'abono': 3})

    def test_categories(self):
        self.assertEqual(b.classify_category('COMPRA TARJ. MERCADONA MADRID'), 'super')
        self.assertEqual(b.classify_category('IBERDROLA CLIENTES SAU'), 'luz')
        self.assertEqual(b.classify_category('CANAL DE ISABEL II'), 'agua')
        self.assertEqual(b.classify_category('Farmacia López'), 'salud')
        self.assertEqual(b.classify_category('TIENDA RARA SL'), '')

    def test_personal_account_rules(self):
        movs = [{'date': dt.date(2026, 10, 1), 'amount': -1200, 'concept': 'TRANSFERENCIA A ES99 9999'},
                {'date': dt.date(2026, 10, 2), 'amount': -40, 'concept': 'MERCADONA'},
                {'date': dt.date(2026, 10, 2), 'amount': -40, 'concept': 'MERCADONA'},
                {'date': dt.date(2026, 10, 5), 'amount': 2000, 'concept': 'NOMINA'}]
        rows = b.prepare_rows(movs, 'personal', 'mama', ['ES99 9999'], [])
        self.assertEqual([r['tipo'] for r in rows], ['aportacion', 'gasto', 'gasto', 'ignorar'])
        self.assertEqual(rows[1]['miembro'], 'mama')
        self.assertNotEqual(rows[1]['id'], rows[2]['id'])  # dos compras iguales el mismo día no se pisan
        again = b.prepare_rows(movs, 'personal', 'mama', ['ES99 9999'], [])
        self.assertEqual([r['id'] for r in rows], [r['id'] for r in again])  # ids estables → reimportar no duplica

    def test_cross_file_duplicates(self):
        rows = b.prepare_rows([{'date': dt.date(2026, 10, 2), 'amount': 1200, 'concept': 'TRANSFERENCIA DE MAMA'}],
                              'comun', '', [], [{'id': 'mama', 'name': 'Mamá'}])
        b.mark_duplicates(rows, [], [{'id': 'bkx', 'date': '2026-10-01', 'amount': 120000, 'member_id': 'mama'}])
        self.assertEqual(rows[0]['incluir'], 'no')
        self.assertIn('duplicado', rows[0]['aviso'])


if __name__ == '__main__':
    unittest.main(verbosity=1)
