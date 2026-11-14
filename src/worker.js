/* API de Gastos de Casa sobre Cloudflare Workers + D1.
 *
 * Las rutas /api/* requieren haber iniciado sesión con Google (ver src/auth.js).
 * El resto de rutas sirve la app estática.
 * Los importes viajan y se guardan en céntimos (enteros).
 */

import { getSession, handleAuth, inAllowList } from './auth.js';

const json = (body, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
  });

class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}
const bad = (msg) => { throw new HttpError(400, msg); };

// ---------------------------------------------------------------- validación
const ID_RE = /^[A-Za-z0-9_-]{1,64}$/;
const DATE_RE = /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;
const COLOR_RE = /^#[0-9a-fA-F]{6}$/;
const CURRENCY_RE = /^[A-Z]{3}$/;
const MAX_CENTS = 100_000_000_00; // 100 millones

const vId = (v, field = 'id') => (typeof v === 'string' && ID_RE.test(v) ? v : bad(`${field} no válido`));
const vOptId = (v, field) => (v === null || v === undefined || v === '' ? null : vId(v, field));
const vCents = (v, field = 'importe', { allowZero = false, allowNegative = false } = {}) => {
  const ok = Number.isInteger(v) && Math.abs(v) <= MAX_CENTS && (allowNegative || v >= 0) && (allowZero || v !== 0);
  return ok ? v : bad(`${field} no válido`);
};
const vDate = (v) => (typeof v === 'string' && DATE_RE.test(v) ? v : bad('fecha no válida'));
const vText = (v, max, field, { required = false } = {}) => {
  const s = typeof v === 'string' ? v.trim() : v == null ? '' : bad(`${field} no válido`);
  if (required && !s) bad(`${field} es obligatorio`);
  if (s.length > max) bad(`${field} es demasiado largo`);
  return s;
};
const vInt = (v, def = 0) => (Number.isInteger(v) ? v : def);

function vExpense(b, id) {
  return {
    id: vId(id ?? b.id),
    amount: vCents(b.amount),
    category_id: vId(b.category_id, 'categoría'),
    date: vDate(b.date),
    note: vText(b.note, 120, 'nota'),
    paid_by: vOptId(b.paid_by, 'pagado por'),
    reimbursed: b.paid_by && b.reimbursed ? 1 : 0,
    created_at: vInt(b.created_at, Date.now()),
  };
}
function vIncome(b, id) {
  return {
    id: vId(id ?? b.id),
    amount: vCents(b.amount),
    member_id: vOptId(b.member_id, 'miembro'),
    date: vDate(b.date),
    note: vText(b.note, 120, 'nota'),
    created_at: vInt(b.created_at, Date.now()),
  };
}
function vCategory(b, id) {
  return {
    id: vId(id ?? b.id),
    name: vText(b.name, 40, 'nombre', { required: true }),
    icon: vText(b.icon, 16, 'icono', { required: true }),
    color: typeof b.color === 'string' && COLOR_RE.test(b.color) ? b.color : bad('color no válido'),
    grp: vText(b.grp, 30, 'grupo') || 'Otros',
    budget: vCents(b.budget ?? 0, 'presupuesto', { allowZero: true }),
    sort: vInt(b.sort),
  };
}
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
function vMember(b, id) {
  const email = vText(b.email, 120, 'email').toLowerCase();
  if (email && !EMAIL_RE.test(email)) bad('email no válido');
  return {
    id: vId(id ?? b.id),
    name: vText(b.name, 30, 'nombre', { required: true }),
    email,
    monthly_contribution: vCents(b.monthly_contribution ?? 0, 'aportación', { allowZero: true }),
    sort: vInt(b.sort),
  };
}

// ---------------------------------------------------------------- SQL
const UPSERT = {
  expenses: `INSERT INTO expenses (id, amount, category_id, date, note, paid_by, reimbursed, created_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)
             ON CONFLICT(id) DO UPDATE SET amount=?2, category_id=?3, date=?4, note=?5, paid_by=?6, reimbursed=?7`,
  incomes: `INSERT INTO incomes (id, amount, member_id, date, note, created_at)
            VALUES (?1, ?2, ?3, ?4, ?5, ?6)
            ON CONFLICT(id) DO UPDATE SET amount=?2, member_id=?3, date=?4, note=?5`,
  categories: `INSERT INTO categories (id, name, icon, color, grp, budget, sort)
               VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)
               ON CONFLICT(id) DO UPDATE SET name=?2, icon=?3, color=?4, grp=?5, budget=?6, sort=?7`,
  members: `INSERT INTO members (id, name, monthly_contribution, sort, email)
            VALUES (?1, ?2, ?3, ?4, ?5)
            ON CONFLICT(id) DO UPDATE SET name=?2, monthly_contribution=?3, sort=?4, email=?5`,
};
const COLS = {
  expenses: ['id', 'amount', 'category_id', 'date', 'note', 'paid_by', 'reimbursed', 'created_at'],
  incomes: ['id', 'amount', 'member_id', 'date', 'note', 'created_at'],
  categories: ['id', 'name', 'icon', 'color', 'grp', 'budget', 'sort'],
  members: ['id', 'name', 'monthly_contribution', 'sort', 'email'],
};
const VALIDATE = { expenses: vExpense, incomes: vIncome, categories: vCategory, members: vMember };
const bindRow = (db, table, row) => db.prepare(UPSERT[table]).bind(...COLS[table].map((c) => row[c]));

async function readSettings(db) {
  const { results } = await db.prepare('SELECT key, value FROM settings').all();
  const s = Object.fromEntries(results.map((r) => [r.key, r.value]));
  return { currency: s.currency || 'EUR', initial_balance: Number(s.initial_balance) || 0 };
}

async function readAll(db) {
  const [members, categories, expenses, incomes] = await db.batch([
    db.prepare('SELECT * FROM members ORDER BY sort, name'),
    db.prepare('SELECT * FROM categories ORDER BY sort, name'),
    db.prepare('SELECT * FROM expenses ORDER BY date DESC, created_at DESC'),
    db.prepare('SELECT * FROM incomes ORDER BY date DESC, created_at DESC'),
  ]);
  return {
    settings: await readSettings(db),
    members: members.results,
    categories: categories.results,
    expenses: expenses.results,
    incomes: incomes.results,
  };
}

function writeSettingsStmts(db, b) {
  const stmts = [];
  if (b.currency !== undefined) {
    if (typeof b.currency !== 'string' || !CURRENCY_RE.test(b.currency)) bad('moneda no válida');
    stmts.push(db.prepare('INSERT INTO settings (key, value) VALUES (?1, ?2) ON CONFLICT(key) DO UPDATE SET value=?2').bind('currency', b.currency));
  }
  if (b.initial_balance !== undefined) {
    const v = vCents(b.initial_balance, 'saldo inicial', { allowZero: true, allowNegative: true });
    stmts.push(db.prepare('INSERT INTO settings (key, value) VALUES (?1, ?2) ON CONFLICT(key) DO UPDATE SET value=?2').bind('initial_balance', String(v)));
  }
  return stmts;
}

// ---------------------------------------------------------------- rutas
async function readBody(request) {
  const len = Number(request.headers.get('content-length') || 0);
  if (len > 5_000_000) throw new HttpError(413, 'Petición demasiado grande');
  try { return await request.json(); } catch { bad('JSON no válido'); }
}

async function handleApi(request, env, url) {
  const user = await getSession(request, env);
  if (!user) return json({ error: 'Inicia sesión con Google' }, 401);
  const method = request.method;
  // Protección CSRF adicional a SameSite: las escrituras deben venir de la propia app.
  const origin = request.headers.get('origin');
  if (method !== 'GET' && origin && origin !== url.origin) return json({ error: 'Origen no permitido' }, 403);
  const db = env.DB;
  const parts = url.pathname.replace(/^\/api\/?/, '').split('/').filter(Boolean);
  const [resource, id] = parts;

  // GET /api/data — todo el estado de la familia
  if (resource === 'data' && method === 'GET') return json({ ...(await readAll(db)), me: user });
  if (resource === 'me' && method === 'GET') return json(user);

  // PUT /api/settings
  if (resource === 'settings' && method === 'PUT') {
    const stmts = writeSettingsStmts(db, await readBody(request));
    if (stmts.length) await db.batch(stmts);
    return json({ settings: await readSettings(db) });
  }

  // POST /api/reimburse { member_id } — devuelve desde la cuenta común todo lo pendiente de un miembro
  if (resource === 'reimburse' && method === 'POST') {
    const b = await readBody(request);
    const memberId = vId(b.member_id, 'miembro');
    const r = await db.prepare('UPDATE expenses SET reimbursed = 1 WHERE paid_by = ?1 AND reimbursed = 0').bind(memberId).run();
    return json({ updated: r.meta.changes });
  }

  // POST /api/import — sustituye todos los datos (copia de seguridad, datos de ejemplo, borrar todo)
  if (resource === 'import' && method === 'POST') {
    const b = await readBody(request);
    for (const t of ['members', 'categories', 'expenses', 'incomes']) if (!Array.isArray(b[t])) bad(`Falta ${t}`);
    if (!b.categories.length) bad('Debe haber al menos una categoría');
    const rows = {};
    for (const t of ['members', 'categories', 'expenses', 'incomes']) rows[t] = b[t].map((r) => VALIDATE[t](r));
    if (!inAllowList(env, user.email) && !rows.members.some((m) => m.email === user.email)) {
      bad('Te quedarías sin acceso: los datos importados no tienen ningún miembro con tu email');
    }
    const stmts = [
      db.prepare('DELETE FROM expenses'),
      db.prepare('DELETE FROM incomes'),
      db.prepare('DELETE FROM categories'),
      db.prepare('DELETE FROM members'),
      ...rows.members.map((r) => bindRow(db, 'members', r)),
      ...rows.categories.map((r) => bindRow(db, 'categories', r)),
      ...rows.expenses.map((r) => bindRow(db, 'expenses', r)),
      ...rows.incomes.map((r) => bindRow(db, 'incomes', r)),
      ...writeSettingsStmts(db, b.settings || {}),
    ];
    await db.batch(stmts); // atómico: o se aplica todo o nada
    return json({ ...(await readAll(db)), me: user });
  }

  // CRUD: /api/{expenses|incomes|categories|members}/:id
  if (VALIDATE[resource] && id) {
    vId(id);
    // evita que alguien que entra gracias a su email de miembro se quede fuera
    const guardOwnAccess = async (newEmail) => {
      if (resource !== 'members' || inAllowList(env, user.email)) return;
      const cur = await db.prepare('SELECT email FROM members WHERE id = ?1').bind(id).first();
      if (cur && cur.email === user.email && newEmail !== user.email) bad('No puedes quitarte tu propio email: perderías el acceso');
    };
    if (method === 'PUT') {
      const row = VALIDATE[resource](await readBody(request), id);
      await guardOwnAccess(row.email);
      await bindRow(db, resource, row).run();
      return json(row);
    }
    if (method === 'DELETE') {
      const stmts = [];
      if (resource === 'categories') {
        // los gastos de la categoría borrada pasan a otra (por defecto "otros")
        const moveTo = vId(url.searchParams.get('move_to') || 'otros', 'categoría destino');
        if (moveTo === id) bad('La categoría destino debe ser distinta');
        const exists = await db.prepare('SELECT 1 FROM categories WHERE id = ?1').bind(moveTo).first();
        if (!exists) bad('La categoría destino no existe');
        stmts.push(db.prepare('UPDATE expenses SET category_id = ?1 WHERE category_id = ?2').bind(moveTo, id));
      }
      if (resource === 'members') {
        await guardOwnAccess(null);
        const used = await db.prepare('SELECT (SELECT COUNT(*) FROM expenses WHERE paid_by = ?1) + (SELECT COUNT(*) FROM incomes WHERE member_id = ?1) AS n').bind(id).first();
        if (used.n > 0) throw new HttpError(409, 'Este miembro tiene movimientos y no se puede borrar');
      }
      stmts.push(db.prepare(`DELETE FROM ${resource} WHERE id = ?1`).bind(id));
      await db.batch(stmts);
      return json({ ok: true });
    }
  }

  return json({ error: 'No encontrado' }, 404);
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === '/api' || url.pathname.startsWith('/api/')) {
      try {
        return await handleApi(request, env, url);
      } catch (err) {
        if (err instanceof HttpError) return json({ error: err.message }, err.status);
        const msg = String(err && err.message || err);
        if (/UNIQUE constraint failed: members/i.test(msg) || /idx_members_email/i.test(msg)) return json({ error: 'Ese email ya está asignado a otro miembro' }, 409);
        if (/FOREIGN KEY/i.test(msg)) return json({ error: 'Referencia no válida (categoría o miembro inexistente)' }, 409);
        console.error(err);
        return json({ error: 'Error interno' }, 500);
      }
    }
    if (url.pathname.startsWith('/auth/')) {
      try {
        return await handleAuth(request, env, url);
      } catch (err) {
        console.error(err);
        return new Response(String(err && err.message || 'Error'), { status: 500, headers: { 'content-type': 'text/plain; charset=utf-8' } });
      }
    }
    return env.ASSETS.fetch(request);
  },
};
