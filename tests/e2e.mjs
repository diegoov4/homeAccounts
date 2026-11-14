// Pruebas de extremo a extremo: arranca el Worker en local con una D1 vacía y un Google simulado,
// y recorre la app en un navegador (Playwright). Uso: npm test
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
let chromium, devices;
try { ({ chromium, devices } = require('playwright')); } catch {
  console.error('Falta Playwright: npm i -D playwright && npx playwright install chromium'); process.exit(1);
}

const PORT = 8788, U = `http://localhost:${PORT}/`, MOCK = 'http://localhost:9999';
const ROOT = new URL('..', import.meta.url).pathname;
const state = mkdtempSync(join(tmpdir(), 'gastos-casa-e2e-'));
const procs = [];
// detached: cada proceso en su propio grupo, para poder cerrar también wrangler/workerd al terminar
const run = (cmd, args, opts = {}) => { const p = spawn(cmd, args, { cwd: ROOT, stdio: opts.quiet ? 'ignore' : 'inherit', detached: true, ...opts }); procs.push(p); return p; };
const wait = (p) => new Promise((res, rej) => p.on('exit', (c) => (c === 0 ? res() : rej(new Error(`exit ${c}`)))));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let failures = 0, passed = 0;
function check(name, cond, detail = '') {
  if (cond) { passed++; console.log(`  ✅ ${name}`); } else { failures++; console.log(`  ❌ ${name} ${detail}`); }
}
function cleanup() { procs.forEach((p) => { try { process.kill(-p.pid, 'SIGTERM'); } catch {} }); rmSync(state, { recursive: true, force: true }); }

try {
  console.log('▶ Preparando D1 local y servidores…');
  await wait(run('npx', ['wrangler', 'd1', 'migrations', 'apply', 'gastos-casa', '--local', '--persist-to', state], { quiet: true }));
  run('node', ['tests/mock-google.cjs'], { quiet: true });
  run('npx', ['wrangler', 'dev', '--port', String(PORT), '--persist-to', state, '--env-file', 'tests/test.env'], { quiet: true });
  for (let i = 0; i < 60; i++) { try { if ((await fetch(U)).ok) break; } catch {} await sleep(1000); }

  const b = await chromium.launch();
  const errors = [];
  const newPage = async () => {
    const p = await (await b.newContext({ ...devices['iPhone 13'] })).newPage();
    p.on('pageerror', (e) => errors.push(e.message));
    p.on('dialog', (d) => d.accept());
    return p;
  };
  const login = async (p, email, mode = 'ok') => {
    await fetch(`${MOCK}/set?email=${encodeURIComponent(email)}&mode=${mode}`);
    await p.goto(U); await p.click('a.btn.google'); await p.waitForLoadState('networkidle'); await sleep(400);
  };
  const loginMsg = (p) => p.locator('.login-msg').textContent().catch(() => '');
  const api = (p, method, path, body) => p.evaluate(([m, path, body]) => fetch('/api' + path, { method: m, headers: { 'content-type': 'application/json' }, body: body && JSON.stringify(body) }).then(async (r) => ({ status: r.status, body: await r.json().catch(() => ({})) })), [method, path, body]);

  console.log('▶ Inicio de sesión');
  const ana = await newPage();
  await ana.goto(U); await sleep(300);
  check('muestra el botón de Google', await ana.locator('a.btn.google').count() === 1);
  check('la API exige sesión', (await fetch(U + 'api/data')).status === 401);
  await login(ana, 'ana@example.com');
  check('usuario autorizado entra', (await ana.textContent('#view-title')) === 'Resumen');
  const ck = (await ana.context().cookies()).find((c) => c.name === '__Host-gc_session');
  check('cookie segura', ck && ck.httpOnly && ck.secure && ck.sameSite === 'Lax');
  const bob = await newPage(); await login(bob, 'bob@example.com');
  check('usuario no autorizado rechazado', (await loginMsg(bob)).includes('no tiene acceso'));
  const x = await newPage(); await login(x, 'ana@example.com', 'badstate');
  check('state manipulado rechazado', (await loginMsg(x)).includes('caducado'));
  const y = await newPage(); await login(y, 'ana@example.com', 'badnonce');
  check('nonce manipulado rechazado', (await loginMsg(y)).includes('No se ha podido'));

  console.log('▶ Datos, gastos e ingresos');
  await ana.click('.tab[data-view=ajustes]'); await ana.click('[data-act=demo]'); await sleep(1200);
  const d0 = (await api(ana, 'GET', '/data')).body;
  check('datos de ejemplo cargados en D1', d0.expenses.length > 50 && d0.incomes.length > 5 && d0.members.length === 2);
  await ana.click('#fab-add'); await ana.fill('#f-amount', '80'); await ana.click('[data-pick=cenas]'); await ana.click('[data-paid=papa]'); await ana.fill('#f-note', 'Prueba e2e');
  await ana.click('button[type=submit]'); await sleep(500);
  const d1 = (await api(ana, 'GET', '/data')).body;
  check('gasto pagado por su cuenta guardado', d1.expenses.some((e) => e.note === 'Prueba e2e' && e.paid_by === 'papa' && e.amount === 8000 && !e.reimbursed));
  await ana.click('#fab-add'); await ana.click('[data-switch=income]'); await ana.click('[data-who=mama]');
  check('ingreso propone la aportación fija', (await ana.inputValue('#f-amount')) === '1200');
  await ana.fill('#f-amount', '150'); await ana.fill('#f-note', 'Ingreso e2e'); await ana.click('button[type=submit]'); await sleep(500);
  check('ingreso guardado', (await api(ana, 'GET', '/data')).body.incomes.some((i) => i.note === 'Ingreso e2e' && i.amount === 15000));

  console.log('▶ Cuenta común');
  await ana.click('.tab[data-view=cuenta]'); await sleep(300);
  check('muestra si llega o no', await ana.locator('.verdict .pill').count() === 1);
  const pend = await ana.locator('[data-reimburse=papa]').count();
  check('Papá tiene pendiente de devolver', pend === 1);
  await ana.click('[data-reimburse=papa]'); await sleep(600);
  check('devolución aplicada', !(await api(ana, 'GET', '/data')).body.expenses.some((e) => e.paid_by === 'papa' && !e.reimbursed));

  console.log('▶ Acceso de miembros');
  check('miembro con email propio', (await api(ana, 'PUT', '/members/mama', { name: 'Mamá', email: 'ana@example.com', monthly_contribution: 120000, sort: 0 })).status === 200);
  check('email duplicado rechazado', (await api(ana, 'PUT', '/members/papa', { name: 'Papá', email: 'ana@example.com', monthly_contribution: 0, sort: 1 })).status === 409);
  await api(ana, 'PUT', '/members/papa', { name: 'Papá', email: 'luis@example.com', monthly_contribution: 120000, sort: 1 });
  const luis = await newPage(); await login(luis, 'luis@example.com');
  check('miembro con email entra', (await luis.textContent('#view-title')) === 'Resumen');
  check('no puede quitarse su propio acceso', (await api(luis, 'PUT', '/members/papa', { name: 'Papá', email: '', monthly_contribution: 0, sort: 1 })).status === 400);
  check('no puede importar dejándose fuera', (await api(luis, 'POST', '/import', { members: [], categories: [{ id: 'otros', name: 'Otros', icon: '📦', color: '#78716c', grp: 'Otros' }], expenses: [], incomes: [] })).status === 400);
  await api(ana, 'PUT', '/members/papa', { name: 'Papá', email: '', monthly_contribution: 120000, sort: 1 });
  check('al quitarle el email pierde el acceso', (await api(luis, 'GET', '/data')).status === 401);

  console.log('▶ Seguridad');
  const cookieHdr = `__Host-gc_session=${encodeURIComponent(ck.value)}`;
  check('escritura desde otro origen bloqueada', (await fetch(U + 'api/settings', { method: 'PUT', headers: { cookie: cookieHdr, origin: 'https://evil.example', 'content-type': 'application/json' }, body: '{"currency":"USD"}' })).status === 403);
  check('validación de importes', (await api(ana, 'PUT', '/expenses/zz', { amount: -5, category_id: 'luz', date: '2026-01-01' })).status === 400);
  const h = (await fetch(U)).headers;
  check('cabeceras de seguridad', h.get('content-security-policy')?.includes("frame-ancestors 'none'") && h.get('x-content-type-options') === 'nosniff');
  await ana.click('.tab[data-view=ajustes]'); await ana.click('[data-act=logout]'); await sleep(500);
  check('cerrar sesión invalida la cookie', (await fetch(U + 'api/data', { headers: { cookie: cookieHdr } })).status === 401);

  console.log('▶ Diseño');
  const v = await newPage(); await login(v, 'ana@example.com');
  for (const view of ['resumen', 'movimientos', 'cuenta', 'ajustes']) {
    await v.click(`.tab[data-view=${view}]`); await sleep(200);
    check(`sin desbordamiento horizontal en ${view}`, await v.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  }
  check('sin errores de JavaScript', errors.length === 0, errors.join(' | '));
  await b.close();
} catch (err) {
  failures++; console.error('❌ Error inesperado:', err);
} finally {
  cleanup();
}
console.log(`\n${failures ? '❌' : '✅'} ${passed} correctas, ${failures} fallidas`);
process.exit(failures ? 1 : 0);
