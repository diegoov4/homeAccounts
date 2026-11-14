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

    def test_ids_with_source(self):
        m = {'date': dt.date(2026, 11, 12), 'amount': -203.0, 'concept': 'SEGUROS MAPFRE VIDA'}
        a = b.prepare_rows([m], 'comun', '', [], [], 'sabadell')[0]['id']
        self.assertTrue(a.startswith('bksab'))
        self.assertEqual(a, b.prepare_rows([m], 'comun', '', [], [], 'sabadell')[0]['id'])
        self.assertNotEqual(a, b.prepare_rows([m], 'comun', '', [], [], 'santander')[0]['id'])

    def test_family_rules(self):
        rows = b.prepare_rows([{'date': dt.date(2026, 10, 26), 'amount': 2231.23, 'concept': 'NOMINA AVVALE ESPANA'},
                               {'date': dt.date(2026, 10, 27), 'amount': -538.8, 'concept': 'TRANSFERENCIA A DIEGO MARTIN'}], 'comun', '', [], [])
        b.apply_family_rules(rows, [{'match': 'nomina avvale', 'tipo': 'aportacion', 'miembro': 'diego'},
                                    {'match': 'transferencia a diego martin', 'tipo': 'retirada', 'miembro': 'diego', 'revisar': True}])
        self.assertEqual((rows[0]['tipo'], rows[0]['miembro'], rows[0]['incluir']), ('aportacion', 'diego', 'si'))
        self.assertEqual((rows[1]['tipo'], rows[1]['incluir']), ('retirada', 'no'))

    def test_split_rule(self):
        rows = b.prepare_rows([{'date': dt.date(2026, 11, 2), 'amount': -185.17, 'concept': 'ADEUDO RECIBO C.P. GENERAL FANJUL, 161'},
                               {'date': dt.date(2026, 10, 1), 'amount': -154.0, 'concept': 'ADEUDO RECIBO C.P. GENERAL FANJUL, 161'}], 'comun', '', [], [], 'sabadell')
        b.apply_family_rules(rows, [{'match': 'general fanjul', 'tipo': 'gasto', 'categoria': 'comunidad', 'base': 154.0, 'resto_categoria': 'agua', 'resto_nota': 'Agua'}])
        self.assertEqual([(r['categoria'], r['importe']) for r in rows], [('comunidad', '154.00'), ('comunidad', '154.00'), ('agua', '31.17')])
        self.assertEqual(rows[2]['id'], rows[0]['id'] + 'agua')

    def test_cross_file_duplicates(self):
        rows = b.prepare_rows([{'date': dt.date(2026, 10, 2), 'amount': 1200, 'concept': 'TRANSFERENCIA DE MAMA'}],
                              'comun', '', [], [{'id': 'mama', 'name': 'Mamá'}])
        b.mark_duplicates(rows, [], [{'id': 'bkx', 'date': '2026-10-01', 'amount': 120000, 'member_id': 'mama'}])
        self.assertEqual(rows[0]['incluir'], 'no')
        self.assertIn('duplicado', rows[0]['aviso'])


if __name__ == '__main__':
    unittest.main(verbosity=1)
