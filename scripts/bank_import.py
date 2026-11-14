#!/usr/bin/env python3
"""Importa extractos del banco (Excel/CSV) a Gastos de Casa.

Flujo en tres pasos, siempre con revisión antes de tocar la base de datos:

  1) inspect  – muestra qué hay en el archivo (hojas, cabecera detectada, fechas, totales).
       python3 -I scripts/bank_import.py inspect extracto.xlsx

  2) prepare  – clasifica cada movimiento y genera un CSV de revisión (se abre con Excel).
       python3 -I scripts/bank_import.py prepare extracto.xlsx --member mama --account personal \\
               --common-hint "ES12 3456" --out revision-mama.csv

     --account personal  → cuenta de una persona: las transferencias a la cuenta común son
                           APORTACIONES suyas; el resto de cargos son gastos pagados POR SU CUENTA.
     --account comun     → la cuenta común: los abonos son INGRESOS (se intenta saber de quién)
                           y los cargos son gastos pagados desde la cuenta común.

  3) apply    – inserta en D1 las filas con incluir=si. Es idempotente: cada movimiento tiene un id
                fijo, así que reimportar el mismo extracto no duplica nada.
       python3 -I scripts/bank_import.py apply revision-mama.csv --remote      (o --local)

Las reglas de clasificación están en scripts/bank_rules.json.
"""
import argparse
import csv
import datetime as dt
import hashlib
import io
import json
import os
import re
import subprocess
import sys
import tempfile
import unicodedata
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
RULES = json.loads((ROOT / 'scripts' / 'bank_rules.json').read_text(encoding='utf-8'))
DB = 'gastos-casa'

REVIEW_COLS = ['incluir', 'tipo', 'fecha', 'importe', 'categoria', 'miembro', 'devuelto', 'nota', 'concepto_banco', 'aviso', 'id']
TIPOS = {'gasto', 'aportacion', 'ingreso', 'retirada', 'ignorar'}  # retirada = dinero personal que sale de la cuenta común


# ---------------------------------------------------------------- utilidades
def norm(s):
    s = unicodedata.normalize('NFKD', str(s or '')).encode('ascii', 'ignore').decode().lower()
    return re.sub(r'\s+', ' ', s).strip()


def parse_amount(v):
    """'1.234,56 €' · '-12,30' · '12,30-' · 12.3 · '(5,00)' → float o None."""
    if v is None:
        return None
    if isinstance(v, (int, float)):
        return None if v != v else float(v)  # NaN
    s = str(v).strip().replace(' ', '').replace('€', '').replace('EUR', '').replace(' ', '')
    if not s or s in {'-', 'nan'}:
        return None
    neg = s.startswith('-') or s.endswith('-') or (s.startswith('(') and s.endswith(')'))
    s = s.strip('-+()')
    if ',' in s and '.' in s:
        s = s.replace('.', '').replace(',', '.') if s.rfind(',') > s.rfind('.') else s.replace(',', '')
    elif ',' in s:
        s = s.replace(',', '.')
    elif re.fullmatch(r'\d{1,3}(\.\d{3})+', s):
        s = s.replace('.', '')
    try:
        n = float(s)
    except ValueError:
        return None
    return -n if neg else n


def parse_date(v):
    if v is None or (isinstance(v, float) and v != v):
        return None
    if isinstance(v, dt.datetime):
        return v.date()
    if isinstance(v, dt.date):
        return v
    if isinstance(v, (int, float)) and 20000 < v < 80000:  # fecha serial de Excel
        return (dt.datetime(1899, 12, 30) + dt.timedelta(days=float(v))).date()
    s = str(v).strip().split(' ')[0]
    for fmt in ('%d/%m/%Y', '%d-%m-%Y', '%d.%m.%Y', '%d/%m/%y', '%d-%m-%y', '%Y-%m-%d', '%Y/%m/%d'):
        try:
            return dt.datetime.strptime(s, fmt).date()
        except ValueError:
            pass
    return None


# ---------------------------------------------------------------- lectura
def read_tables(path):
    """Devuelve [(nombre_hoja, filas)] con todas las celdas como valores Python."""
    import pandas as pd
    p = Path(path)
    head = p.read_bytes()[:2048].lstrip().lower()
    ext = p.suffix.lower()
    if head.startswith(b'<') or b'<table' in head or b'<html' in head:  # .xls que en realidad es HTML
        # se lee como texto: pandas convertiría '-60,00' en -6000
        import lxml.html
        doc = lxml.html.fromstring(p.read_bytes())
        tables = []
        for i, t in enumerate(doc.iter('table')):
            rows = [[' '.join(td.text_content().split()) or None for td in tr.iter('td', 'th')] for tr in t.iter('tr')]
            if rows:
                tables.append((f'tabla{i + 1}', rows))
        return tables
    if ext in ('.csv', '.txt'):
        raw = p.read_bytes()
        text = next((raw.decode(enc) for enc in ('utf-8-sig', 'cp1252', 'latin-1') if _decodes(raw, enc)), raw.decode('latin-1'))
        dialect = csv.Sniffer().sniff(text[:5000], delimiters=';,\t|')
        return [('csv', list(csv.reader(io.StringIO(text), dialect)))]
    engine = 'xlrd' if ext == '.xls' else 'openpyxl'
    sheets = pd.read_excel(p, sheet_name=None, header=None, engine=engine)
    return [(name, df.where(df.notna(), None).values.tolist()) for name, df in sheets.items()]


def _decodes(raw, enc):
    try:
        raw.decode(enc)
        return True
    except UnicodeDecodeError:
        return False


HEADERS = {
    'fecha': ['fecha operacion', 'fecha de operacion', 'f. operacion', 'f. operativa', 'fecha operativa', 'f.operativa', 'fecha', 'f.operacion', 'date'],
    'fecha_valor': ['fecha valor', 'f. valor', 'f.valor'],
    'concepto': ['concepto', 'descripcion', 'detalle', 'movimiento', 'observaciones', 'operacion', 'description'],
    'concepto2': ['mas datos', 'informacion adicional', 'referencia', 'beneficiario', 'ordenante', 'comercio'],
    'importe': ['importe', 'cantidad', 'amount', 'importe (eur)', 'importe eur'],
    'cargo': ['cargo', 'debe', 'gastos', 'salida', 'cargos'],
    'abono': ['abono', 'haber', 'ingresos', 'entrada', 'abonos'],
    'saldo': ['saldo', 'balance', 'saldo disponible'],
}


def detect_header(rows):
    """Busca la fila de cabecera en las 40 primeras filas. Devuelve (índice, {campo: columna})."""
    best = (None, {})
    for i, row in enumerate(rows[:40]):
        cols = {}
        cells = [norm(c) for c in row]
        for field, names in HEADERS.items():
            for j, c in enumerate(cells):
                if c and j not in cols.values() and any(c == n or c.startswith(n) for n in names):
                    if field == 'fecha' and any(c.startswith(n) for n in HEADERS['fecha_valor']):
                        continue
                    cols[field] = j
                    break
        if 'fecha' not in cols and 'fecha_valor' in cols:
            cols['fecha'] = cols.pop('fecha_valor')
        score = ('fecha' in cols) + ('concepto' in cols) + (('importe' in cols) or ('cargo' in cols and 'abono' in cols)) * 1
        if score >= 3 and len(cols) > len(best[1]):
            best = (i, cols)
    return best


def load_movements(path):
    for sheet, rows in read_tables(path):
        h, cols = detect_header(rows)
        if h is None:
            continue
        out = []
        for r in rows[h + 1:]:
            get = lambda k: r[cols[k]] if k in cols and cols[k] < len(r) else None
            date = parse_date(get('fecha'))
            if not date:
                continue
            if 'importe' in cols:
                amount = parse_amount(get('importe'))
            else:
                cargo, abono = parse_amount(get('cargo')) or 0, parse_amount(get('abono')) or 0
                amount = abono - abs(cargo)
            if amount is None or amount == 0:
                continue
            concept = ' · '.join(str(x).strip() for x in (get('concepto'), get('concepto2')) if x not in (None, '') and str(x).strip())
            out.append({'date': date, 'amount': round(amount, 2), 'concept': concept[:200], 'saldo': parse_amount(get('saldo'))})
        if out:
            return sheet, rows[h], cols, out
    raise SystemExit('❌ No he encontrado una tabla de movimientos (fecha + concepto + importe) en el archivo.')


# ---------------------------------------------------------------- D1
def wrangler(args, capture=True):
    env = {**os.environ, 'WRANGLER_SEND_METRICS': 'false', 'CI': 'true'}
    env.setdefault('CLOUDFLARE_API_TOKEN', 'proxy-injected')
    res = subprocess.run(['npx', 'wrangler', *args], cwd=ROOT, env=env, capture_output=capture, text=True)
    if res.returncode != 0:
        raise SystemExit('❌ wrangler falló:\n' + (res.stderr or res.stdout)[-2000:])
    return res.stdout


def d1_query(sql, target):
    out = wrangler(['d1', 'execute', DB, *target, '--json', '--command', sql])
    return json.loads(out[out.index('['):])[0]['results']


def target_args(a):
    if a.remote:
        return ['--remote']
    return ['--local'] + (['--persist-to', a.persist_to] if a.persist_to else [])


# ---------------------------------------------------------------- clasificación
def classify_category(concept):
    c = norm(concept)
    for rule in RULES['categories']:
        if any(norm(k) in c for k in rule['match']):
            return rule['category']
    return ''


def stable_id(account, member, m, n, source=''):
    """Id fijo por movimiento: reimportar el mismo extracto no duplica. `source` (sabadell, santander…)
    distingue extractos de bancos distintos."""
    key = f"{account}|{member}|{m['date']}|{m['amount']:.2f}|{norm(m['concept'])}|{n}"
    return 'bk' + norm(source)[:3] + hashlib.sha1(key.encode()).hexdigest()[:20]


def load_family_rules(target):
    """Reglas propias de la familia (nombres, nóminas, planes de ahorro…), guardadas en D1 y no en el repositorio.
    Formato: [{"match": "texto", "tipo": "aportacion|retirada|gasto|ingreso|ignorar", "miembro": "id",
               "categoria": "id", "nota": "...", "devuelto": "si", "revisar": true}]"""
    rows = d1_query("SELECT value FROM settings WHERE key = 'import_rules'", target)
    return json.loads(rows[0]['value']) if rows else []


def apply_family_rules(rows, rules):
    for r in rows:
        c = norm(r['concepto_banco'])
        rule = next((x for x in rules if norm(x['match']) in c), None)
        if not rule:
            continue
        r.update(tipo=rule['tipo'], miembro=rule.get('miembro', ''), incluir='si', aviso='', devuelto=rule.get('devuelto', 'no'))
        if rule.get('categoria'):
            r['categoria'] = rule['categoria']
        elif rule['tipo'] == 'gasto':
            r['categoria'] = classify_category(r['concepto_banco']) or 'otros'
        else:
            r['categoria'] = ''
        if rule.get('nota'):
            r['nota'] = rule['nota']
        if rule.get('revisar'):
            r.update(incluir='no', aviso=f"revisar: {rule.get('nota') or rule['match']}")


def prepare_rows(movs, account, member, common_hints, members, source=''):
    seen, rows = {}, []
    hints = [norm(h) for h in common_hints if h.strip()]
    for m in movs:
        c = norm(m['concept'])
        k = (m['date'], m['amount'], c)
        seen[k] = seen.get(k, 0) + 1
        row = {'incluir': 'si', 'tipo': '', 'fecha': m['date'].isoformat(), 'importe': f"{abs(m['amount']):.2f}",
               'categoria': '', 'miembro': '', 'devuelto': 'no', 'nota': m['concept'][:120], 'concepto_banco': m['concept'],
               'aviso': '', 'id': stable_id(account, member, m, seen[k], source)}
        is_transfer = any(norm(t) in c for t in RULES['transfer_keywords'])
        to_common = bool(hints) and any(h in c for h in hints)
        if any(norm(t) in c for t in RULES['ignore_keywords']):
            row.update(tipo='ignorar', incluir='no', aviso='liquidación de tarjeta (sus compras ya salen aparte)')
        elif account == 'personal':
            if m['amount'] < 0 and to_common:
                row.update(tipo='aportacion', miembro=member, nota='Aportación a la cuenta común')
            elif m['amount'] < 0:
                cat = classify_category(m['concept'])
                row.update(tipo='gasto', miembro=member, categoria=cat or 'otros')
                if is_transfer:
                    row.update(incluir='no', aviso='transferencia: ¿es un gasto de la familia?')
                elif not cat:
                    row.update(incluir='no', aviso='sin categoría: ¿es un gasto de la familia?')
            else:
                row.update(tipo='ignorar', incluir='no', aviso='ingreso en su cuenta personal (nómina, etc.)')
        else:  # cuenta común
            if m['amount'] > 0:
                who = next((mm['id'] for mm in members if norm(mm['name']) and norm(mm['name']) in c), '')
                row.update(tipo='aportacion' if who else 'ingreso', miembro=who, nota=m['concept'][:120])
                if not who:
                    row['aviso'] = '¿de quién es este ingreso? pon su id en "miembro" y tipo=aportacion'
            else:
                cat = classify_category(m['concept'])
                row.update(tipo='gasto', categoria=cat or 'otros')
                if not cat:
                    row['aviso'] = 'sin categoría (va a "otros")'
        rows.append(row)
    return rows


def mark_duplicates(rows, existing_exp, existing_inc, days=3):
    """Marca como posible duplicado lo que ya está en la app:
    - el mismo movimiento importado antes (mismo id) → se salta;
    - un gasto/ingreso con el mismo importe (y miembro, si lo hay) a ±3 días, apuntado a mano
      o importado desde OTRO extracto (p. ej. la transferencia de Mamá a la cuenta común
      aparece en su extracto y en el de la cuenta común)."""
    ids = {e['id'] for e in existing_exp} | {i['id'] for i in existing_inc}
    pool = {'gasto': [(parse_date(e['date']), e['amount'], e.get('paid_by') or '') for e in existing_exp],
            'ingreso': [(parse_date(i['date']), i['amount'], i.get('member_id') or '') for i in existing_inc]}
    for r in rows:
        if r['id'] in ids:
            r.update(aviso='ya importado antes', incluir='no')
            continue
        if r['incluir'] != 'si' or r['tipo'] == 'ignorar':
            continue
        kind = 'gasto' if r['tipo'] == 'gasto' else 'ingreso'  # aportaciones, ingresos y retiradas están en incomes
        d, cents, who = parse_date(r['fecha']), round(float(r['importe']) * 100), r['miembro']
        match = next((x for x in pool[kind] if x[1] == cents and abs((x[0] - d).days) <= days and (kind == 'gasto' or not who or not x[2] or x[2] == who)), None)
        if match:
            r.update(incluir='no', aviso=f'posible duplicado: ya hay uno igual el {match[0]}')


# ---------------------------------------------------------------- comandos
def cmd_inspect(a):
    sheet, header, cols, movs = load_movements(a.file)
    print(f'📄 {a.file}  ·  hoja: {sheet}')
    print('Cabecera detectada:', [str(c) for c in header if c is not None])
    print('Columnas usadas   :', {k: str(header[v]) for k, v in cols.items()})
    dates = [m['date'] for m in movs]
    print(f'Movimientos       : {len(movs)}  ·  del {min(dates)} al {max(dates)}')
    print(f'Cargos            : {sum(m["amount"] for m in movs if m["amount"] < 0):.2f}  ·  Abonos: {sum(m["amount"] for m in movs if m["amount"] > 0):.2f}')
    print('Ejemplos:')
    for m in movs[:8]:
        print(f'  {m["date"]}  {m["amount"]:>10.2f}  {m["concept"][:70]}')


def cmd_prepare(a):
    _, _, _, movs = load_movements(a.file)
    target = target_args(a)
    members = d1_query('SELECT id, name, email FROM members', target)
    cats = {c['id'] for c in d1_query('SELECT id FROM categories', target)}
    if a.member and a.member not in {m['id'] for m in members}:
        raise SystemExit(f"❌ El miembro '{a.member}' no existe. Miembros: " + ', '.join(f"{m['id']} ({m['name']})" for m in members))
    if a.account == 'personal' and not a.member:
        raise SystemExit('❌ Para una cuenta personal indica de quién es con --member')
    rows = prepare_rows(movs, a.account, a.member or '', a.common_hint or [], members, a.source or '')
    family_rules = load_family_rules(target)
    apply_family_rules(rows, family_rules)
    if family_rules:
        print(f'(aplicadas {len(family_rules)} reglas de la familia)')
    for r in rows:
        if r['categoria'] and r['categoria'] not in cats:
            r['categoria'] = 'otros'
    lo, hi = min(r['fecha'] for r in rows), max(r['fecha'] for r in rows)
    lo = (parse_date(lo) - dt.timedelta(days=5)).isoformat()
    hi = (parse_date(hi) + dt.timedelta(days=5)).isoformat()
    mark_duplicates(rows,
                    d1_query(f"SELECT id, date, amount, paid_by FROM expenses WHERE date BETWEEN '{lo}' AND '{hi}'", target),
                    d1_query(f"SELECT id, date, amount, member_id FROM incomes WHERE date BETWEEN '{lo}' AND '{hi}'", target))
    out = Path(a.out or Path(a.file).with_suffix('.revision.csv').name)
    with out.open('w', newline='', encoding='utf-8-sig') as f:
        w = csv.DictWriter(f, fieldnames=REVIEW_COLS, delimiter=';')
        w.writeheader()
        w.writerows(rows)
    summarize(rows)
    print(f'\n📝 Revisión guardada en {out}  (cambia incluir/tipo/categoria/miembro donde haga falta y luego: apply)')


def summarize(rows):
    inc = [r for r in rows if r['incluir'] == 'si']
    print(f'Movimientos: {len(rows)}  ·  se incluirán: {len(inc)}  ·  a revisar/excluidos: {len(rows) - len(inc)}')
    by = {}
    for r in inc:
        k = (r['tipo'], r['categoria'] or r['miembro'] or '-')
        by[k] = by.get(k, 0) + float(r['importe'])
    for (t, c), v in sorted(by.items(), key=lambda x: -x[1]):
        print(f'  {t:<11} {c:<16} {v:>10.2f}')
    avisos = {}
    for r in rows:
        if r['aviso']:
            avisos[r['aviso']] = avisos.get(r['aviso'], 0) + 1
    if avisos:
        print('Avisos:')
        for k, v in avisos.items():
            print(f'  {v:>4} × {k}')


def sql_str(s):
    return "'" + str(s).replace("'", "''") + "'"


def cmd_apply(a):
    with open(a.review, newline='', encoding='utf-8-sig') as f:
        rows = [r for r in csv.DictReader(f, delimiter=';') if norm(r.get('incluir')) in ('si', 'sí', 's', 'x', '1')]
    target = target_args(a)
    members = {m['id'] for m in d1_query('SELECT id FROM members', target)}
    cats = {c['id'] for c in d1_query('SELECT id FROM categories', target)}
    stmts, errors, now = [], [], int(dt.datetime.now().timestamp() * 1000)
    for n, r in enumerate(rows, 2):
        tipo = norm(r['tipo'])
        date = parse_date(r['fecha'])
        amount = parse_amount(r['importe'])
        member = (r.get('miembro') or '').strip()
        if tipo not in TIPOS or not date or not amount:
            errors.append(f'fila {n}: tipo/fecha/importe no válidos')
            continue
        if tipo == 'ignorar':
            continue
        cents = round(abs(amount) * 100)
        if member and member not in members:
            errors.append(f"fila {n}: el miembro '{member}' no existe")
            continue
        note = (r.get('nota') or '')[:120]
        if tipo == 'gasto':
            cat = (r.get('categoria') or 'otros').strip()
            if cat not in cats:
                errors.append(f"fila {n}: la categoría '{cat}' no existe")
                continue
            reimb = 1 if member and norm(r.get('devuelto')) in ('si', 'sí', 's', '1') else 0
            stmts.append(f"INSERT OR IGNORE INTO expenses (id, amount, category_id, date, note, paid_by, reimbursed, created_at) VALUES "
                         f"({sql_str(r['id'])}, {cents}, {sql_str(cat)}, '{date}', {sql_str(note)}, {sql_str(member) if member else 'NULL'}, {reimb}, {now + n})")
        else:
            if tipo in ('aportacion', 'retirada') and not member:
                errors.append(f'fila {n}: una {tipo} necesita miembro')
                continue
            kind = 'withdrawal' if tipo == 'retirada' else 'income'
            stmts.append(f"INSERT OR IGNORE INTO incomes (id, amount, member_id, date, note, created_at, kind) VALUES "
                         f"({sql_str(r['id'])}, {cents}, {sql_str(member) if member else 'NULL'}, '{date}', {sql_str(note)}, {now + n}, '{kind}')")
    if errors:
        print('❌ Hay errores; no se ha importado nada:\n  ' + '\n  '.join(errors))
        sys.exit(1)
    if not stmts:
        print('Nada que importar.')
        return
    if a.dry_run:
        print(f'(simulación) se insertarían {len(stmts)} movimientos')
        return
    with tempfile.NamedTemporaryFile('w', suffix='.sql', delete=False, encoding='utf-8') as f:
        f.write(';\n'.join(stmts) + ';\n')
        sql_file = f.name
    try:
        wrangler(['d1', 'execute', DB, *target, '--file', sql_file, '--yes'])
    finally:
        os.unlink(sql_file)
    print(f'✅ Importados {len(stmts)} movimientos (los ya existentes se han saltado).')


def cmd_rules(a):
    target = target_args(a)
    if a.set:
        rules = json.loads(Path(a.set).read_text(encoding='utf-8'))
        for x in rules:
            if not x.get('match') or x.get('tipo') not in TIPOS:
                raise SystemExit(f'❌ Regla no válida: {x}')
        value = json.dumps(rules, ensure_ascii=False).replace("'", "''")
        wrangler(['d1', 'execute', DB, *target, '--command',
                  f"INSERT INTO settings (key, value) VALUES ('import_rules', '{value}') ON CONFLICT(key) DO UPDATE SET value = excluded.value"])
        print(f'✅ Guardadas {len(rules)} reglas de la familia')
    for x in load_family_rules(target):
        print(f"  «{x['match']}» → {x['tipo']}" + (f" ({x['miembro']})" if x.get('miembro') else '') + (f" · {x['nota']}" if x.get('nota') else '') + (' · revisar' if x.get('revisar') else ''))


def main():
    ap = argparse.ArgumentParser(description='Importa extractos del banco a Gastos de Casa')
    sub = ap.add_subparsers(dest='cmd', required=True)
    p = sub.add_parser('inspect'); p.add_argument('file')
    p = sub.add_parser('rules', help='ver o guardar las reglas propias de la familia (en D1)')
    p.add_argument('--set', help='archivo JSON con las reglas')
    g = p.add_mutually_exclusive_group(required=True)
    g.add_argument('--remote', action='store_true'); g.add_argument('--local', action='store_true')
    p.add_argument('--persist-to')
    for name in ('prepare', 'apply'):
        p = sub.add_parser(name)
        if name == 'prepare':
            p.add_argument('file')
            p.add_argument('--account', choices=['personal', 'comun'], required=True)
            p.add_argument('--member', help='id del miembro (mama, papa…) dueño de la cuenta personal')
            p.add_argument('--common-hint', action='append', help='texto que identifica la cuenta común en el concepto (IBAN, nombre…)')
            p.add_argument('--out')
            p.add_argument('--source', help='nombre corto del extracto (sabadell, santander, begona…) para sus ids')
        else:
            p.add_argument('review')
            p.add_argument('--dry-run', action='store_true')
        g = p.add_mutually_exclusive_group(required=True)
        g.add_argument('--remote', action='store_true', help='base de datos real (Cloudflare)')
        g.add_argument('--local', action='store_true', help='base de datos local de pruebas')
        p.add_argument('--persist-to', help='carpeta de la D1 local')
    a = ap.parse_args()
    {'inspect': cmd_inspect, 'prepare': cmd_prepare, 'apply': cmd_apply, 'rules': cmd_rules}[a.cmd](a)


if __name__ == '__main__':
    main()
