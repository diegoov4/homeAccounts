/* Gastos de Casa — gestor de gastos familiares.
 * Los datos viven en Cloudflare D1 a través de la API /api (ver src/worker.js).
 * En el dispositivo se guarda una copia en caché para arrancar rápido y verlos sin conexión.
 */
(() => {
  'use strict';

  // ---------------------------------------------------------------- utilidades
  const LS = 'homeaccounts';
  const LEGACY_KEY = 'homeaccounts.v1'; // datos de la primera versión (solo en el navegador)
  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  const pad = (n) => String(n).padStart(2, '0');
  const toISO = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const todayISO = () => toISO(new Date());
  const parseISO = (s) => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); };
  const round2 = (n) => Math.round(n * 100) / 100;
  const toCents = (n) => Math.round(n * 100);
  const lsGet = (k) => { try { return localStorage.getItem(k); } catch (_) { return null; } };
  const lsSet = (k, v) => { try { localStorage.setItem(k, v); } catch (_) {} };
  const lsDel = (k) => { try { localStorage.removeItem(k); } catch (_) {} };
  const parseAmount = (s) => round2(parseFloat(String(s).replace(/\s/g, '').replace(/\.(?=\d{3}(\D|$))/g, '').replace(',', '.')));

  const MONTHS = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
  const MONTHS_SHORT = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];

  const DEFAULT_CATEGORIES = [
    ['hipoteca', 'Casa / Hipoteca', '🏠', '#64748b', 'Hogar'], ['luz', 'Luz', '💡', '#eab308', 'Hogar'],
    ['agua', 'Agua', '💧', '#0ea5e9', 'Hogar'], ['gas', 'Gas / Calefacción', '🔥', '#f97316', 'Hogar'],
    ['internet', 'Internet y móvil', '📶', '#8b5cf6', 'Hogar'], ['seguros', 'Seguros', '🛡️', '#0f766e', 'Hogar'],
    ['super', 'Supermercado', '🛒', '#16a34a', 'Alimentación'], ['cenas', 'Cenas fuera', '🍽️', '#e11d48', 'Alimentación'],
    ['colegio', 'Colegio', '🎒', '#2563eb', 'Niños'], ['ninos', 'Gastos niños', '🧸', '#f59e0b', 'Niños'],
    ['extraescolares', 'Extraescolares', '⚽', '#65a30d', 'Niños'], ['transporte', 'Coche y transporte', '🚗', '#14b8a6', 'Transporte'],
    ['salud', 'Salud', '💊', '#ec4899', 'Personal'], ['ropa', 'Ropa', '👕', '#c026d3', 'Personal'],
    ['ocio', 'Ocio y viajes', '🎬', '#7c3aed', 'Personal'], ['mascotas', 'Mascotas', '🐾', '#a16207', 'Otros'],
    ['otros', 'Otros', '📦', '#78716c', 'Otros'],
  ].map(([id, name, icon, color, group], i) => ({ id, name, icon, color, group, budget: 0, sort: i + 1 }));

  const EMOJIS = ('🏠 💡 💧 🔥 📶 📱 🛡️ 🛒 🍽️ 🍕 ☕ 🥖 🍷 🎒 📚 ✏️ 🧸 👶 🍼 ⚽ 🎨 🎹 🩰 🚗 ⛽ 🚌 🚆 🅿️ ✈️ 💊 🦷 👓 🏥 👕 👟 💇 🎬 🎮 🎁 🎉 🏖️ 🏕️ 🐾 🐶 🐱 🧹 🧺 🔧 🛋️ 🌱 💻 📺 🎵 💳 🏦 💶 🧾 📦 ❤️ ⭐').split(' ');
  const COLORS = ['#2563eb', '#0ea5e9', '#14b8a6', '#16a34a', '#65a30d', '#eab308', '#f59e0b', '#f97316', '#e11d48', '#ec4899', '#c026d3', '#7c3aed', '#8b5cf6', '#0f766e', '#64748b', '#a16207', '#78716c'];
  const CURRENCIES = [['EUR', 'Euro (€)'], ['USD', 'Dólar ($)'], ['GBP', 'Libra (£)'], ['MXN', 'Peso mexicano'], ['ARS', 'Peso argentino'], ['COP', 'Peso colombiano'], ['CLP', 'Peso chileno']];
  const INCOME_COLOR = '#16a34a';
  const WITHDRAWAL_COLOR = '#d97706';

  // ---------------------------------------------------------------- modelo (euros en el cliente, céntimos en la API)
  const emptyData = () => ({ me: null, settings: { currency: 'EUR', initialBalance: 0, contributionPct: 0 }, members: [], categories: DEFAULT_CATEGORIES.map((c) => ({ ...c })), expenses: [], incomes: [] });

  function fromApi(d) {
    return {
      me: d.me || null,
      settings: { currency: d.settings?.currency || 'EUR', initialBalance: (d.settings?.initial_balance || 0) / 100, contributionPct: (d.settings?.contribution_pct || 0) / 100 },
      members: (d.members || []).map((m) => ({ id: m.id, name: m.name, email: m.email || '', monthly: m.monthly_contribution / 100, income: (m.monthly_income || 0) / 100, sort: m.sort })),
      categories: (d.categories || []).map((c) => ({ id: c.id, name: c.name, icon: c.icon, color: c.color, group: c.grp, budget: c.budget / 100, sort: c.sort })),
      expenses: (d.expenses || []).map((e) => ({ id: e.id, amount: e.amount / 100, categoryId: e.category_id, date: e.date, note: e.note, paidBy: e.paid_by || '', reimbursed: Boolean(e.reimbursed), createdAt: e.created_at })),
      incomes: (d.incomes || []).map((i) => ({ id: i.id, kind: i.kind === 'withdrawal' ? 'withdrawal' : 'income', amount: i.amount / 100, memberId: i.member_id || '', date: i.date, note: i.note, createdAt: i.created_at })),
    };
  }
  const apiMember = (m) => ({ id: m.id, name: m.name, email: m.email || '', monthly_contribution: toCents(m.monthly || 0), monthly_income: toCents(m.income || 0), sort: m.sort || 0 });
  const apiCategory = (c) => ({ id: c.id, name: c.name, icon: c.icon, color: c.color, grp: c.group, budget: toCents(c.budget || 0), sort: c.sort || 0 });
  const apiExpense = (e) => ({ id: e.id, amount: toCents(e.amount), category_id: e.categoryId, date: e.date, note: e.note, paid_by: e.paidBy || null, reimbursed: e.reimbursed ? 1 : 0, created_at: e.createdAt });
  const apiIncome = (i) => ({ id: i.id, kind: i.kind || 'income', amount: toCents(i.amount), member_id: i.memberId || null, date: i.date, note: i.note, created_at: i.createdAt });
  const toApi = (d) => ({
    app: 'gastos-casa', version: 2,
    settings: { currency: d.settings.currency, initial_balance: toCents(d.settings.initialBalance || 0), contribution_pct: Math.round((d.settings.contributionPct || 0) * 100) },
    members: d.members.map(apiMember), categories: d.categories.map(apiCategory),
    expenses: d.expenses.map(apiExpense), incomes: d.incomes.map(apiIncome),
  });

  // Convierte los datos de la primera versión (solo navegador) al formato de la API.
  function legacyToApi(old) {
    const members = (old.members || []).map((name, i) => ({ id: 'm' + (i + 1), name, monthly_contribution: 0, sort: i }));
    const categories = (old.categories || DEFAULT_CATEGORIES).map((c, i) => ({ id: c.id, name: c.name, icon: c.icon, color: c.color, grp: c.group || 'Otros', budget: toCents(c.budget || 0), sort: i + 1 }));
    const catIds = new Set(categories.map((c) => c.id));
    if (!catIds.has('otros')) categories.push({ id: 'otros', name: 'Otros', icon: '📦', color: '#78716c', grp: 'Otros', budget: 0, sort: 99 });
    return {
      settings: { currency: old.currency || 'EUR', initial_balance: 0 },
      members, categories, incomes: [],
      expenses: (old.expenses || []).map((e) => ({ id: e.id, amount: toCents(e.amount), category_id: catIds.has(e.categoryId) ? e.categoryId : 'otros', date: e.date, note: [e.note, e.member].filter(Boolean).join(' · '), paid_by: null, reimbursed: 0, created_at: e.createdAt || Date.now() })),
    };
  }

  let data = emptyData();
  try { const c = lsGet(LS + ':cache'); if (c) data = JSON.parse(c); } catch (_) {}
  const cache = () => lsSet(LS + ':cache', JSON.stringify(data));

  // ---------------------------------------------------------------- API
  // signedIn: este dispositivo tenía sesión (para mostrar la caché mientras se comprueba).
  let signedIn = lsGet(LS + ':signedIn') === '1';
  let checking = true;
  let loginMessage = '';

  class AuthError extends Error {}
  async function api(method, path, body) {
    let res;
    try {
      res = await fetch('/api' + path, {
        method,
        headers: { 'content-type': 'application/json' },
        credentials: 'same-origin',
        body: body === undefined ? undefined : JSON.stringify(body),
      });
    } catch (_) { throw new Error('Sin conexión con el servidor'); }
    const out = await res.json().catch(() => ({}));
    if (res.status === 401) throw new AuthError(out.error || 'Clave incorrecta');
    if (!res.ok) throw new Error(out.error || `Error ${res.status}`);
    return out;
  }

  // Aplica el cambio en pantalla al momento y lo guarda en D1; si falla, lo deshace.
  async function persist(localChange, request) {
    const backup = JSON.stringify(data);
    localChange(); cache(); render();
    try {
      await request();
      return true;
    } catch (err) {
      data = JSON.parse(backup); cache(); render();
      if (err instanceof AuthError) signedOut('Tu sesión ha caducado. Vuelve a entrar.');
      else toast('⚠️ No se ha guardado: ' + err.message);
      return false;
    }
  }

  async function refresh({ quiet = false } = {}) {
    try {
      data = fromApi(await api('GET', '/data'));
      checking = false;
      if (!signedIn) { signedIn = true; lsSet(LS + ':signedIn', '1'); }
      cache(); render();
      offerLegacyImport();
    } catch (err) {
      checking = false;
      if (err instanceof AuthError) return signedOut(signedIn ? 'Tu sesión ha caducado. Vuelve a entrar.' : loginMessage);
      if (!signedIn) return renderLogin(err.message);
      if (!quiet) toast('📴 ' + err.message + '. Mostrando los últimos datos guardados.');
    }
  }

  async function replaceAll(payload, okMsg) {
    try {
      data = fromApi(await api('POST', '/import', payload));
      cache(); toast(okMsg); goto('resumen');
      return true;
    } catch (err) {
      if (err instanceof AuthError) signedOut('Tu sesión ha caducado. Vuelve a entrar.'); else toast('⚠️ ' + err.message);
      return false;
    }
  }

  // Borra los datos locales y muestra la pantalla de inicio de sesión.
  function signedOut(msg = '') {
    signedIn = false; lsDel(LS + ':signedIn'); lsDel(LS + ':cache'); data = emptyData();
    closeSheet();
    renderLogin(msg);
  }
  async function logout() {
    try { await fetch('/auth/logout', { method: 'POST', credentials: 'same-origin' }); } catch (_) {}
    signedOut('Has cerrado la sesión.');
  }

  function offerLegacyImport() {
    const raw = lsGet(LEGACY_KEY);
    if (!raw || data.expenses.length) return;
    try {
      const old = JSON.parse(raw);
      if (!old.expenses || !old.expenses.length) return;
      if (confirm(`Hemos encontrado ${old.expenses.length} gastos guardados solo en este dispositivo. ¿Quieres subirlos a la base de datos?`)) {
        replaceAll(legacyToApi(old), '✅ Gastos subidos').then((ok) => ok && lsDel(LEGACY_KEY));
      } else lsDel(LEGACY_KEY);
    } catch (_) {}
  }

  // ---------------------------------------------------------------- estado de la interfaz
  const now = new Date();
  const ui = { view: lsGet(LS + ':view') || 'resumen', mode: 'month', year: now.getFullYear(), month: now.getMonth(), filterCat: '', filterType: 'all', search: '' };
  if (!['resumen', 'movimientos', 'cuenta', 'ajustes', 'categorias'].includes(ui.view)) ui.view = 'resumen';

  const catById = (id) => data.categories.find((c) => c.id === id) || { id, name: 'Sin categoría', icon: '❔', color: '#78716c', group: 'Otros', budget: 0 };
  const memberById = (id) => data.members.find((m) => m.id === id);
  const memberName = (id) => (memberById(id) || { name: '¿?' }).name;
  const isMe = (m) => Boolean(m && m.email && data.me && m.email === String(data.me.email).toLowerCase());

  function money(n, opts = {}) {
    const cur = data.settings.currency;
    try {
      const s = new Intl.NumberFormat('es-ES', { style: 'currency', currency: cur, maximumFractionDigits: opts.noCents ? 0 : 2, minimumFractionDigits: opts.noCents ? 0 : 2 }).format(n);
      return opts.sign && n > 0 ? '+' + s : s;
    } catch (_) { return n.toFixed(2) + ' ' + cur; }
  }
  const compact = (n) => (n >= 10000 ? Math.round(n / 1000) + 'k' : n >= 1000 ? (n / 1000).toFixed(1).replace('.', ',') + 'k' : String(Math.round(n)));
  function currencySymbol() {
    try {
      const p = new Intl.NumberFormat('es-ES', { style: 'currency', currency: data.settings.currency }).formatToParts(0);
      return (p.find((x) => x.type === 'currency') || {}).value || data.settings.currency;
    } catch (_) { return data.settings.currency; }
  }

  // ---------------------------------------------------------------- periodos y cálculos
  const periodKey = (mode = ui.mode, y = ui.year, m = ui.month) => (mode === 'month' ? `${y}-${pad(m + 1)}` : `${y}`);
  const inPeriod = (list, key) => list.filter((e) => e.date.startsWith(key));
  const sum = (list) => round2(list.reduce((a, e) => a + e.amount, 0));
  const periodLabel = () => (ui.mode === 'month' ? `${MONTHS[ui.month]} ${ui.year}` : `Año ${ui.year}`);
  const periodNoun = () => (ui.mode === 'month' ? 'este mes' : 'este año');
  function prevPeriodKey() {
    if (ui.mode === 'year') return `${ui.year - 1}`;
    const d = new Date(ui.year, ui.month - 1, 1);
    return periodKey('month', d.getFullYear(), d.getMonth());
  }
  function isCurrentPeriod() {
    const n = new Date();
    return ui.mode === 'month' ? ui.year === n.getFullYear() && ui.month === n.getMonth() : ui.year === n.getFullYear();
  }
  function shiftPeriod(delta) {
    if (ui.mode === 'year') ui.year += delta;
    else { const d = new Date(ui.year, ui.month + delta, 1); ui.year = d.getFullYear(); ui.month = d.getMonth(); }
    render();
  }
  const isFromCommon = (e) => !e.paidBy || e.reimbursed;
  // Retirada personal: dinero que sale de la cuenta común para un miembro. Resta de lo aportado.
  const isWithdrawal = (i) => i.kind === 'withdrawal';
  const signed = (i) => (isWithdrawal(i) ? -i.amount : i.amount);
  const netSum = (list) => round2(list.reduce((a, i) => a + signed(i), 0));

  // Resumen de la cuenta común en un periodo.
  function accountStats(key) {
    const inc = inPeriod(data.incomes, key);
    const exp = inPeriod(data.expenses, key);
    const contributed = netSum(inc); // neto: ingresos − retiradas personales
    const withdrawn = sum(inc.filter(isWithdrawal));
    const familyTotal = sum(exp);
    const members = data.members.map((m) => {
      const mine = inc.filter((i) => i.memberId === m.id);
      const gross = sum(mine.filter((i) => !isWithdrawal(i)));
      const out = sum(mine.filter(isWithdrawal));
      const contrib = round2(gross - out);
      const personal = sum(exp.filter((e) => e.paidBy === m.id && !e.reimbursed));
      return { m, gross, out, contrib, personal, total: round2(contrib + personal) };
    });
    return {
      contributed, withdrawn, familyTotal,
      diff: round2(contributed - familyTotal),
      fromCommon: sum(exp.filter(isFromCommon)),
      paidPersonally: sum(exp.filter((e) => e.paidBy)),
      otherIncome: sum(inc.filter((i) => !i.memberId && !isWithdrawal(i))),
      members,
    };
  }
  const commonBalance = () => round2((data.settings.initialBalance || 0) + netSum(data.incomes) - sum(data.expenses.filter(isFromCommon)));
  const pendingByMember = () => data.members
    .map((m) => { const list = data.expenses.filter((e) => e.paidBy === m.id && !e.reimbursed); return { m, total: sum(list), count: list.length }; })
    .filter((p) => p.total > 0);
  const monthlyFixed = () => round2(data.members.reduce((a, m) => a + (m.monthly || 0), 0));

  // Media de gastos de los últimos N meses completos (sin contar el actual) que tengan datos.
  function avgMonthlyExpenses(n = 3) {
    const totals = [];
    const keys = [];
    for (let i = 1; i <= 12 && totals.length < n; i++) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      const list = inPeriod(data.expenses, periodKey('month', d.getFullYear(), d.getMonth()));
      if (list.length) { totals.push(sum(list)); keys.push(periodKey('month', d.getFullYear(), d.getMonth())); }
    }
    return totals.length ? { avg: round2(totals.reduce((a, b) => a + b, 0) / totals.length), months: totals.length, keys } : null;
  }

  // ---------------------------------------------------------------- vistas
  const TITLES = { resumen: 'Resumen', movimientos: 'Movimientos', cuenta: 'Cuenta común', ajustes: 'Ajustes', categorias: 'Categorías' };
  const main = $('#main');

  function render() {
    if (!signedIn) return renderLogin(checking ? null : loginMessage);
    document.body.classList.remove('locked');
    $('#view-title').textContent = TITLES[ui.view];
    const tab = ui.view === 'categorias' ? 'ajustes' : ui.view;
    $$('.tab').forEach((t) => t.classList.toggle('on', t.dataset.view === tab));
    ({ resumen: renderSummary, movimientos: renderMovements, cuenta: renderAccount, ajustes: renderSettings, categorias: renderCategories })[ui.view]();
  }
  function goto(view) {
    ui.view = view; lsSet(LS + ':view', view);
    render(); window.scrollTo({ top: 0 });
  }

  function periodSelector() {
    return `
      <div class="period">
        <div class="seg">
          <button data-mode="month" class="${ui.mode === 'month' ? 'on' : ''}">Mes</button>
          <button data-mode="year" class="${ui.mode === 'year' ? 'on' : ''}">Año</button>
        </div>
        <div class="period-nav">
          <button class="icon-btn" data-shift="-1" aria-label="Periodo anterior"><svg viewBox="0 0 24 24"><path d="M15 18l-6-6 6-6"/></svg></button>
          <span class="label">${esc(periodLabel())}</span>
          <button class="icon-btn" data-shift="1" aria-label="Periodo siguiente" ${isCurrentPeriod() ? 'disabled' : ''}><svg viewBox="0 0 24 24"><path d="M9 18l6-6-6-6"/></svg></button>
        </div>
      </div>`;
  }
  function bindCommon(root) {
    $$('[data-mode]', root).forEach((b) => b.addEventListener('click', () => { ui.mode = b.dataset.mode; render(); }));
    $$('[data-shift]', root).forEach((b) => b.addEventListener('click', () => shiftPeriod(Number(b.dataset.shift))));
    $$('[data-goto]', root).forEach((b) => b.addEventListener('click', () => { ui.filterCat = ''; ui.filterType = 'all'; goto(b.dataset.goto); }));
    $$('[data-exp]', root).forEach((b) => b.addEventListener('click', () => { const e = data.expenses.find((x) => x.id === b.dataset.exp); if (e) openExpenseForm(e); }));
    $$('[data-inc]', root).forEach((b) => b.addEventListener('click', () => { const i = data.incomes.find((x) => x.id === b.dataset.inc); if (i) openIncomeForm(i); }));
  }

  function verdictPill(diff) {
    return diff >= 0
      ? `<span class="pill good">✅ Llega · sobran ${money(diff, { noCents: true })}</span>`
      : `<span class="pill bad">⚠️ No llega · faltan ${money(-diff, { noCents: true })}</span>`;
  }

  // ---------- Login
  const GOOGLE_G = '<svg viewBox="0 0 48 48" width="20" height="20" aria-hidden="true"><path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.4-.4-3.5z"/><path fill="#FF3D00" d="M6.3 14.7l6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z"/><path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-7.9l-6.5 5C9.5 39.6 16.2 44 24 44z"/><path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C37 39.2 44 34 44 24c0-1.3-.1-2.4-.4-3.5z"/></svg>';

  // msg === null → todavía comprobando la sesión
  function renderLogin(msg = '') {
    document.body.classList.add('locked');
    $('#view-title').textContent = 'Bienvenidos';
    main.innerHTML = msg === null ? `
      <div class="card empty"><div class="big">🏡</div><p>Cargando…</p></div>` : `
      <div class="card empty login">
        <div class="big">🏡</div>
        <h3>Gastos de Casa</h3>
        <p>Entra con tu cuenta de Google para ver y apuntar los gastos de la familia.</p>
        <a class="btn google" href="/auth/login">${GOOGLE_G} Entrar con Google</a>
        ${msg ? `<p class="login-msg">${esc(msg)}</p>` : ''}
        <p class="faint" style="font-size:12px;margin:16px 0 0">Solo pueden entrar las cuentas autorizadas de la familia.</p>
      </div>`;
  }

  // ---------- Resumen
  function renderSummary() {
    const key = periodKey();
    const list = inPeriod(data.expenses, key);
    const total = sum(list);
    const prevTotal = sum(inPeriod(data.expenses, prevPeriodKey()));
    const months = ui.mode === 'year' ? 12 : 1;

    if (!data.expenses.length && !data.incomes.length) {
      main.innerHTML = `
        <div class="card empty">
          <div class="big">👋</div>
          <h3>¡Bienvenidos!</h3>
          <p>Apunta los gastos y lo que ingresáis en la cuenta común con el botón <b>+</b>.<br>Aquí veréis cuánto gastáis, en qué y si os llega.</p>
          <div class="btn-row">
            <button class="btn primary" data-act="add">➕ Añadir primer gasto</button>
            <button class="btn" data-act="demo">✨ Ver con datos de ejemplo</button>
          </div>
        </div>`;
      $('[data-act=add]', main).onclick = () => openExpenseForm();
      $('[data-act=demo]', main).onclick = loadDemo;
      return;
    }

    const byCat = new Map();
    list.forEach((e) => byCat.set(e.categoryId, (byCat.get(e.categoryId) || 0) + e.amount));
    const catRows = data.categories
      .map((c) => ({ c, total: round2(byCat.get(c.id) || 0), budget: (c.budget || 0) * months }))
      .filter((r) => r.total > 0 || r.budget > 0)
      .sort((a, b) => b.total - a.total);

    const byGroup = new Map();
    catRows.forEach((r) => {
      const g = byGroup.get(r.c.group) || { name: r.c.group, total: 0, icons: [] };
      g.total += r.total; if (r.total > 0) g.icons.push(r.c.icon);
      byGroup.set(r.c.group, g);
    });
    const groups = [...byGroup.values()].filter((g) => g.total > 0).sort((a, b) => b.total - a.total);

    const totalBudget = data.categories.reduce((a, c) => a + (c.budget || 0), 0) * months;
    const delta = prevTotal > 0 ? ((total - prevTotal) / prevTotal) * 100 : null;
    let days;
    if (ui.mode === 'month') days = isCurrentPeriod() ? now.getDate() : new Date(ui.year, ui.month + 1, 0).getDate();
    else days = Math.round(((isCurrentPeriod() ? new Date() : new Date(ui.year, 11, 31)) - new Date(ui.year, 0, 1)) / 864e5) + 1;
    const acc = accountStats(key);
    const segs = donutData(catRows.filter((r) => r.total > 0), total);
    const recent = [...list.map((e) => ({ t: 'e', x: e })), ...inPeriod(data.incomes, key).map((i) => ({ t: 'i', x: i }))].sort((a, b) => sortByDate(a.x, b.x)).slice(0, 5);

    main.innerHTML = `
      ${periodSelector()}
      <section class="hero">
        <div class="label">Gastos de la familia · ${esc(periodLabel())}</div>
        <div class="total">${money(total)}</div>
        <div class="hero-stats">
          <div><b>${list.length}</b><span>gastos</span></div>
          <div><b>${money(total / Math.max(1, days), { noCents: total / days >= 100 })}</b><span>media al día</span></div>
          <div><b>${delta === null ? '—' : `${delta > 0 ? '▲' : '▼'} ${Math.abs(delta).toFixed(0)}%`}</b><span>vs ${ui.mode === 'month' ? 'mes' : 'año'} anterior</span></div>
        </div>
        ${totalBudget > 0 ? `
          <div class="budget-bar">
            <div class="track"><div class="fill ${total > totalBudget ? 'over' : ''}" style="width:${Math.min(100, (total / totalBudget) * 100)}%"></div></div>
            <div class="meta"><span>Presupuesto ${money(totalBudget, { noCents: true })}</span><span>${total > totalBudget ? `Te pasas ${money(total - totalBudget, { noCents: true })}` : `Quedan ${money(totalBudget - total, { noCents: true })}`}</span></div>
          </div>` : ''}
      </section>

      ${data.members.length ? `
      <button class="card account-mini" data-goto="cuenta">
        <span class="cat-icon" style="--c:${INCOME_COLOR}">🏦</span>
        <span class="row-main">
          <span class="row-top"><span class="row-title">Cuenta común</span>${verdictPill(acc.diff)}</span>
          <span class="row-sub">Aportado ${money(acc.contributed, { noCents: true })} · Gastos ${money(acc.familyTotal, { noCents: true })}${acc.paidPersonally ? ` · ${money(acc.paidPersonally, { noCents: true })} pagado por su cuenta` : ''}</span>
        </span>
      </button>` : ''}

      ${groups.length ? `<div class="groups">${groups.map((g) => `
        <div class="group-card">
          <div class="g-name">${esc(g.name)}</div>
          <div class="g-total">${money(g.total, { noCents: true })}</div>
          <div class="g-icons">${g.icons.slice(0, 5).join('')}</div>
        </div>`).join('')}</div>` : ''}

      ${total > 0 ? `
      <section class="card">
        <h2>¿En qué se va el dinero?</h2>
        <div class="donut-wrap">
          <div class="donut">
            <svg viewBox="0 0 42 42" aria-hidden="true">
              <circle cx="21" cy="21" r="15.915" stroke="var(--surface-2)"></circle>
              ${segs.map((s) => `<circle cx="21" cy="21" r="15.915" stroke="${s.color}" stroke-dasharray="${s.len} ${100 - s.len}" stroke-dashoffset="${-s.offset}"><title>${esc(s.name)}: ${money(s.total)}</title></circle>`).join('')}
            </svg>
            <div class="donut-center"><span>Total</span><b>${money(total, { noCents: true })}</b></div>
          </div>
          <ul class="legend">${segs.map((s) => `<li><span class="dot" style="background:${s.color}"></span><span>${s.icon} ${esc(s.name)}</span><span class="pct">${s.pct.toFixed(0)}%</span></li>`).join('')}</ul>
        </div>
      </section>` : ''}

      <section class="card">
        <h2>Por categoría <span class="muted">${catRows.filter((r) => r.total > 0).length} con gastos</span></h2>
        ${catRows.length ? `<div class="rows">${catRows.map((r) => categoryRow(r, total)).join('')}</div>` : '<p class="muted">No hay gastos en este periodo.</p>'}
      </section>

      <section class="card">
        <h2>Evolución <span class="muted">${ui.mode === 'month' ? 'últimos 6 meses' : `meses de ${ui.year}`}</span></h2>
        ${trendChart()}
      </section>

      <section class="card">
        <h2>Últimos movimientos <button class="link-btn" data-goto="movimientos">Ver todos</button></h2>
        ${recent.length ? `<div class="rows">${recent.map((r) => (r.t === 'e' ? expenseRow(r.x) : incomeRow(r.x))).join('')}</div>` : '<p class="muted">Todavía no hay movimientos en este periodo.</p>'}
      </section>`;

    bindCommon(main);
    $$('[data-cat]', main).forEach((b) => b.addEventListener('click', () => { ui.filterCat = b.dataset.cat; ui.filterType = 'expense'; goto('movimientos'); }));
  }

  function donutData(rows, total) {
    const MAX = 6;
    let items = rows.map((r) => ({ name: r.c.name, icon: r.c.icon, color: r.c.color, total: r.total }));
    if (items.length > MAX) {
      const rest = items.slice(MAX - 1);
      items = items.slice(0, MAX - 1).concat([{ name: 'Resto', icon: '➕', color: '#a8a29e', total: rest.reduce((a, r) => a + r.total, 0) }]);
    }
    const gap = items.length > 1 ? 0.8 : 0;
    let offset = 0;
    return items.map((it) => {
      const pct = (it.total / total) * 100;
      const seg = { ...it, pct, offset, len: Math.max(0.1, pct - gap) };
      offset += pct;
      return seg;
    });
  }

  function categoryRow(r, total) {
    const pct = total > 0 ? (r.total / total) * 100 : 0;
    const over = r.budget > 0 && r.total > r.budget;
    const fill = r.budget > 0 ? Math.min(100, (r.total / r.budget) * 100) : pct;
    return `
      <button class="row" data-cat="${esc(r.c.id)}" style="--c:${r.c.color}">
        <span class="cat-icon">${r.c.icon}</span>
        <span class="row-main">
          <span class="row-top"><span class="row-title">${esc(r.c.name)}</span><span class="amount">${money(r.total)}</span></span>
          <span class="bar ${r.budget > 0 ? 'budget' : ''}"><i class="${over ? 'over' : ''}" style="width:${fill}%"></i></span>
          <span class="row-meta">
            <span>${pct.toFixed(1).replace('.', ',')}% del total</span>
            ${r.budget > 0 ? `<span class="${over ? 'over-txt' : ''}">${over ? '⚠️ ' : ''}de ${money(r.budget, { noCents: true })}</span>` : ''}
          </span>
        </span>
      </button>`;
  }

  function trendCols() {
    const cols = [];
    if (ui.mode === 'month') {
      for (let i = 5; i >= 0; i--) {
        const d = new Date(ui.year, ui.month - i, 1);
        cols.push({ key: periodKey('month', d.getFullYear(), d.getMonth()), label: MONTHS_SHORT[d.getMonth()], on: i === 0, y: d.getFullYear(), m: d.getMonth() });
      }
    } else {
      for (let m = 0; m < 12; m++) cols.push({ key: periodKey('month', ui.year, m), label: MONTHS_SHORT[m].slice(0, 1), on: false, y: ui.year, m });
    }
    return cols;
  }
  function trendChart() {
    const cols = trendCols();
    cols.forEach((c) => { c.total = sum(inPeriod(data.expenses, c.key)); });
    const max = Math.max(1, ...cols.map((c) => c.total));
    return `<div class="trend">${cols.map((c) => `
      <div class="col ${c.on ? 'on' : ''}" title="${MONTHS[c.m]} ${c.y}: ${money(c.total)}">
        <span class="val">${c.total ? compact(c.total) : ''}</span>
        <span class="b" style="height:${(c.total / max) * 100}%"></span>
        <span class="m">${c.label}</span>
      </div>`).join('')}</div>`;
  }
  function flowChart() {
    const cols = trendCols();
    cols.forEach((c) => { c.inc = netSum(inPeriod(data.incomes, c.key)); c.exp = sum(inPeriod(data.expenses, c.key)); });
    const max = Math.max(1, ...cols.map((c) => Math.max(c.inc, c.exp)));
    return `
      <div class="trend flow ${cols.length > 6 ? 'many' : ''}">${cols.map((c) => `
        <div class="col ${c.on ? 'on' : ''}" title="${MONTHS[c.m]} ${c.y}: aportado ${money(c.inc)} · gastos ${money(c.exp)}">
          <span class="val ${c.inc && c.exp ? (c.inc >= c.exp ? 'good-txt' : 'over-txt') : ''}">${c.inc || c.exp ? (c.inc >= c.exp ? '+' : '−') + compact(Math.abs(c.inc - c.exp)) : ''}</span>
          <span class="pair"><span class="b inc" style="height:${(c.inc / max) * 100}%"></span><span class="b exp" style="height:${(c.exp / max) * 100}%"></span></span>
          <span class="m">${c.label}</span>
        </div>`).join('')}</div>
      <div class="flow-legend"><span><i class="inc"></i>Aportado</span><span><i class="exp"></i>Gastos</span><span class="faint">${cols.length > 6 ? 'cifras en la vista por mes' : 'arriba: lo que sobra o falta'}</span></div>`;
  }

  // ---------- Cuenta común
  function renderAccount() {
    if (!data.members.length) {
      main.innerHTML = `
        <div class="card empty">
          <div class="big">🏦</div>
          <h3>Configura la cuenta común</h3>
          <p>Añade a los miembros de la familia y cuánto aporta cada uno al mes. Así la app calculará si lo que ponéis en la cuenta común es suficiente.</p>
          <button class="btn primary" data-goto="ajustes">👨‍👩‍👧 Añadir miembros</button>
        </div>`;
      return bindCommon(main);
    }
    const key = periodKey();
    const s = accountStats(key);
    const balance = commonBalance();
    const pending = pendingByMember();
    const fixed = monthlyFixed();
    const avg = avgMonthlyExpenses(3);
    const monthKey = periodKey('month', now.getFullYear(), now.getMonth());
    const missing = ui.mode === 'month' && isCurrentPeriod()
      ? data.members.filter((m) => m.monthly > 0 && !data.incomes.some((i) => !isWithdrawal(i) && i.memberId === m.id && i.date.startsWith(monthKey)))
      : [];

    // previsión del mes en curso
    let forecast = '';
    if (ui.mode === 'month' && isCurrentPeriod() && avg) {
      const expected = Math.max(avg.avg, s.familyTotal);
      const income = Math.max(s.contributed, fixed);
      const d = round2(income - expected);
      forecast = `<p class="forecast">📈 Previsión del mes: unos <b>${money(expected, { noCents: true })}</b> de gastos (media de los últimos ${avg.months} meses). Con ${money(income, { noCents: true })} de aportaciones, ${d >= 0 ? `<span class="good-txt">sobrarían ${money(d, { noCents: true })}</span>` : `<span class="over-txt">faltarían ${money(-d, { noCents: true })}</span>`}.</p>`;
    }

    // aportación recomendada
    let recommend = '';
    if (avg && !((data.settings.contributionPct || 0) > 0 && data.members.every((m) => m.income > 0))) {
      const need = avg.avg;
      // reparto: aportaciones fijas si las hay; si no, la proporción real (neta) de los últimos meses
      const real = data.members.map((m) => avg.keys.reduce((a, k) => a + netSum(inPeriod(data.incomes, k).filter((i) => i.memberId === m.id)), 0));
      const realTotal = real.reduce((a, v) => a + Math.max(0, v), 0);
      const incomeTotal = data.members.reduce((a, m) => a + (m.income || 0), 0);
      const byIncome = data.members.every((m) => m.income > 0);
      const mode = byIncome ? 'income' : fixed > 0 ? 'fixed' : realTotal > 0 ? 'real' : 'equal';
      const base = mode === 'income' ? data.members.map((m) => m.income / incomeTotal)
        : mode === 'fixed' ? data.members.map((m) => m.monthly / fixed)
        : mode === 'real' ? real.map((v) => Math.max(0, v) / realTotal) : data.members.map(() => 1 / data.members.length);
      const current = data.members.map((m, i) => (mode === 'fixed' ? m.monthly : real[i] / avg.months));
      const pctNeed = mode === 'income' ? need / incomeTotal : 0;
      const currentTotal = mode === 'fixed' ? fixed : round2(current.reduce((a, v) => a + v, 0));
      const ok = currentTotal >= need;
      recommend = `
        <section class="card">
          <h2>💡 ¿Cuánto deberíamos aportar?</h2>
          <p class="muted" style="margin:-4px 0 12px">Gasto medio de la familia: <b>${money(need, { noCents: true })}/mes</b> (últimos ${avg.months} meses). ${mode === 'fixed' ? 'Aportación fija actual' : 'Aportación media real'}: <b>${money(currentTotal, { noCents: true })}/mes</b>.</p>
          ${mode === 'income'
            ? `<div class="notice ${ok ? 'good' : 'bad'}">${ok ? `✅ Lo que aportáis cubre el gasto medio (margen de ${money(currentTotal - need, { noCents: true })} al mes).` : `⚠️ Faltan unos <b>${money(need - currentTotal, { noCents: true })} al mes</b>.`} Para cubrir el gasto medio aportando los dos el mismo porcentaje, cada uno debería poner el <b>${Math.round(pctNeed * 100)} % de sus ingresos</b>:</div>
               <div class="rows" style="margin-top:8px">${data.members.map((m, i) => `
                 <div class="row static"><span class="avatar">${esc(m.name.slice(0, 1).toUpperCase())}</span><span class="row-main"><span class="row-top"><span class="row-title">${esc(m.name)}</span><span class="amount">${money(Math.ceil((need * base[i]) / 10) * 10, { noCents: true })}/mes</span></span><span class="row-sub">${Math.round(pctNeed * 100)} % de ${money(m.income, { noCents: true })} · ahora ${money(current[i], { noCents: true })}/mes (${Math.round((current[i] / m.income) * 100)} %)</span></span></div>`).join('')}</div>`
            : ok
            ? `<div class="notice good">✅ Lo que aportáis cubre el gasto medio con un margen de ${money(currentTotal - need, { noCents: true })} al mes.</div>`
            : `<div class="notice bad">⚠️ Faltan unos <b>${money(need - currentTotal, { noCents: true })} al mes</b>. Para cubrir el gasto medio, ${mode === 'equal' ? 'a partes iguales' : 'manteniendo la proporción actual'} (${data.members.map((m, i) => `${esc(m.name)} ${Math.round(base[i] * 100)} %`).join(' · ')}):</div>
               <div class="rows" style="margin-top:8px">${data.members.map((m, i) => `
                 <div class="row static"><span class="avatar">${esc(m.name.slice(0, 1).toUpperCase())}</span><span class="row-main"><span class="row-top"><span class="row-title">${esc(m.name)}</span><span class="amount">${money(Math.ceil((need * base[i]) / 10) * 10, { noCents: true })}/mes</span></span><span class="row-sub">ahora ${money(current[i], { noCents: true })}/mes${mode === 'real' ? ' de media' : ''}</span></span></div>`).join('')}</div>`}
        </section>`;
    }

    // ¿Aportáis el mismo % de vuestros ingresos? (ingresos mensuales × meses del periodo)
    let fairCard = '';
    const pctDeal = (data.settings.contributionPct || 0) / 100;
    if (pctDeal > 0 && data.members.length && data.members.every((m) => m.income > 0)) {
      // media de los últimos 3 meses terminados: evita el desfase de las aportaciones hechas a principios del mes siguiente
      const keys = [1, 2, 3].map((i) => { const d = new Date(now.getFullYear(), now.getMonth() - i, 1); return periodKey('month', d.getFullYear(), d.getMonth()); });
      const label = `${MONTHS[parseInt(keys[2].slice(5), 10) - 1]} a ${MONTHS[parseInt(keys[0].slice(5), 10) - 1]}`;
      const rows = data.members.map((m) => {
        const real = keys.reduce((a, k) => a + netSum(inPeriod(data.incomes, k).filter((i) => i.memberId === m.id))
          + sum(inPeriod(data.expenses, k).filter((e) => e.paidBy === m.id && !e.reimbursed)), 0) / keys.length;
        const target = m.income * pctDeal;
        return { m, real: round2(real), target: round2(target), gap: round2(real - target), pct: real / m.income };
      });
      const totTarget = rows.reduce((a, r) => a + r.target, 0);
      const avgExp = keys.reduce((a, k) => a + sum(inPeriod(data.expenses, k)), 0) / keys.length;
      const incomeTotal = data.members.reduce((a, m) => a + m.income, 0);
      const pctFmt = (v) => (Math.round(v * 10000) / 100).toLocaleString('es-ES') + ' %';
      fairCard = `
      <section class="card">
        <h2>⚖️ Aportación acordada <span class="muted">${pctFmt(pctDeal)} de la nómina</span></h2>
        <p class="muted" style="margin:-4px 0 12px">Lo que le toca a cada uno según el acuerdo frente a lo que aporta de verdad (cuenta común, neto, más lo pagado de su bolsillo para la casa). Media mensual de ${label}.</p>
        <div class="rows">${rows.map((r) => `
          <div class="row static">
            <span class="avatar">${esc(r.m.name.slice(0, 1).toUpperCase())}</span>
            <span class="row-main">
              <span class="row-top"><span class="row-title">${esc(r.m.name)}</span><span class="amount">${money(r.real, { noCents: true })}<span class="faint" style="font-weight:500"> / ${money(r.target, { noCents: true })}</span></span></span>
              <span class="pct-bar"><i style="width:${Math.min(100, (Math.max(0, r.real) / Math.max(r.target, r.real, 1)) * 100)}%"></i><b style="left:${(r.target / Math.max(r.target, r.real, 1)) * 100}%"></b></span>
              <span class="row-meta"><span>${pctFmt(r.pct)} de ${money(r.m.income, { noCents: true })}</span><span class="${Math.abs(r.gap) < 5 ? 'good-txt' : r.gap > 0 ? 'good-txt' : 'warn-txt'}">${Math.abs(r.gap) < 5 ? '✓ lo acordado' : r.gap > 0 ? `+${money(r.gap, { noCents: true })}/mes de más` : `${money(-r.gap, { noCents: true })}/mes de menos`}</span></span>
            </span>
          </div>`).join('')}</div>
        <div class="notice ${totTarget >= avgExp ? 'good' : 'bad'}" style="margin-top:10px">${totTarget >= avgExp
          ? `✅ Con el ${pctFmt(pctDeal)} acordado aportaríais ${money(totTarget, { noCents: true })}/mes, que cubre el gasto medio (${money(avgExp, { noCents: true })}/mes).`
          : `⚠️ Con el ${pctFmt(pctDeal)} acordado aportaríais ${money(totTarget, { noCents: true })}/mes, pero el gasto medio es de ${money(avgExp, { noCents: true })}/mes. Para cubrirlo, el % debería ser del <b>${pctFmt(avgExp / incomeTotal)}</b>.`}</div>
        <div class="flow-legend"><span><i class="inc"></i>Lo que aporta</span><span><i class="mark"></i>Lo que le toca según el acuerdo</span></div>
      </section>`;
    } else if (data.members.length > 1 && data.members.every((m) => m.income > 0)) {
      // en el año en curso solo se cuentan los meses ya terminados (el actual aún no ha cobrado todo el mundo)
      const partialYear = ui.mode === 'year' && ui.year === now.getFullYear() && now.getMonth() > 0;
      const months = ui.mode === 'month' ? 1 : partialYear ? now.getMonth() : 12;
      const upTo = partialYear ? periodKey('month', now.getFullYear(), now.getMonth()) : null;
      const incs = inPeriod(data.incomes, periodKey()).filter((i) => !upTo || i.date < upTo);
      // lo que paga cada uno de su bolsillo para la casa (sin devolver) también es aportación suya
      const exps = inPeriod(data.expenses, periodKey()).filter((e) => (!upTo || e.date < upTo) && e.paidBy && !e.reimbursed);
      const rows = s.members.map((x) => ({ m: x.m, contrib: round2(netSum(incs.filter((i) => i.memberId === x.m.id)) + sum(exps.filter((e) => e.paidBy === x.m.id))), inc: x.m.income * months }));
      const totInc = rows.reduce((a, r) => a + r.inc, 0);
      const totContrib = rows.reduce((a, r) => a + r.contrib, 0);
      const p = totInc ? totContrib / totInc : 0;
      rows.forEach((r) => { r.pct = r.inc ? r.contrib / r.inc : 0; r.fair = p * r.inc; r.gap = round2(r.contrib - r.fair); });
      const spread = Math.max(...rows.map((r) => r.pct)) - Math.min(...rows.map((r) => r.pct));
      const maxPct = Math.max(0.01, ...rows.map((r) => r.pct), p);
      fairCard = `
      <section class="card">
        <h2>⚖️ ¿Aportáis el mismo %? <span class="muted">${esc(periodLabel())}</span></h2>
        <p class="muted" style="margin:-4px 0 12px">Lo que pone cada uno (en la cuenta común, neto, más lo que paga de su bolsillo para la casa) respecto a sus ingresos${partialYear ? ` de enero a ${MONTHS[now.getMonth() - 1]}` : months > 1 ? ` de ${months} meses` : ''}. Entre los dos aportáis el <b>${Math.round(p * 100)} %</b>.</p>
        <div class="rows">${rows.map((r) => `
          <div class="row static">
            <span class="avatar">${esc(r.m.name.slice(0, 1).toUpperCase())}</span>
            <span class="row-main">
              <span class="row-top"><span class="row-title">${esc(r.m.name)}</span><span class="amount">${Math.round(r.pct * 100)} %</span></span>
              <span class="pct-bar"><i style="width:${(Math.max(0, r.pct) / maxPct) * 100}%"></i><b style="left:${(p / maxPct) * 100}%"></b></span>
              <span class="row-meta"><span>${money(r.contrib, { noCents: true })} de ${money(r.inc, { noCents: true })}</span><span class="${Math.abs(r.gap) < 1 ? '' : r.gap > 0 ? 'good-txt' : 'warn-txt'}">${Math.abs(r.gap) < 1 ? 'justo' : r.gap > 0 ? `+${money(r.gap, { noCents: true })} de más` : `${money(-r.gap, { noCents: true })} de menos`}</span></span>
            </span>
          </div>`).join('')}</div>
        <div class="notice ${spread <= 0.03 ? 'good' : 'bad'}" style="margin-top:10px">${spread <= 0.03 ? '✅ Estáis aportando prácticamente el mismo % de vuestros ingresos.' : `Para aportar el mismo % (${Math.round(p * 100)} %) con el mismo total, ${rows.filter((r) => r.gap < 0).map((r) => `${esc(r.m.name)} debería poner ${money(-r.gap, { noCents: true })} más`).join(' y ')}${rows.some((r) => r.gap > 0) ? ` y ${rows.filter((r) => r.gap > 0).map((r) => `${esc(r.m.name)} ${money(r.gap, { noCents: true })} menos`).join(' y ')}` : ''}.`}</div>
        <div class="flow-legend"><span><i class="inc"></i>% de sus ingresos que aporta</span><span><i class="mark"></i>% común (objetivo)</span></div>
        ${ui.mode === 'month' ? '<p class="faint" style="font-size:12px;margin:8px 0 0">En un solo mes, una aportación hecha a principios del mes siguiente desplaza el resultado. Para una visión fiel, mira el año.</p>' : ''}
      </section>`;
    }

    const maxMember = Math.max(1, ...s.members.map((x) => Math.max(0, x.contrib) + x.personal));
    const totalMembers = s.members.reduce((a, x) => a + Math.max(0, x.total), 0);

    main.innerHTML = `
      ${periodSelector()}

      ${missing.length ? `
      <section class="card notice-card">
        <div><b>💶 Aportaciones de ${MONTHS[now.getMonth()]}</b><div class="row-sub">${missing.map((m) => `${esc(m.name)} ${money(m.monthly, { noCents: true })}`).join(' · ')}</div></div>
        <button class="btn primary" data-act="register-monthly">Registrar</button>
      </section>` : ''}

      <section class="card verdict ${s.diff >= 0 ? 'ok' : 'ko'}">
        <h2>¿Llega con lo que aportamos? <span class="muted">${esc(periodLabel())}</span></h2>
        <div class="vs">
          <div><span class="faint">Aportado a la cuenta</span><b class="good-txt">${money(s.contributed)}</b></div>
          <div><span class="faint">Gastos de la familia</span><b>${money(s.familyTotal)}</b></div>
        </div>
        <div class="vs-bar"><i style="width:${s.contributed || s.familyTotal ? Math.min(100, (s.familyTotal / Math.max(s.contributed, s.familyTotal)) * 100) : 0}%" class="${s.diff < 0 ? 'over' : ''}"></i></div>
        <div class="verdict-line">${s.contributed || s.familyTotal ? verdictPill(s.diff) : '<span class="faint">Sin movimientos en este periodo</span>'}</div>
        ${s.withdrawn ? `<p class="faint" style="margin:10px 0 0;font-size:13px">Aportado neto: ${money(round2(s.contributed + s.withdrawn))} ingresado − ${money(s.withdrawn)} de retiradas personales.</p>` : ''}
        ${s.paidPersonally ? `<p class="faint" style="margin:10px 0 0;font-size:13px">Incluye ${money(s.paidPersonally)} que alguien pagó por su cuenta.</p>` : ''}
        ${forecast}
      </section>

      <section class="card">
        <h2>🏦 Saldo de la cuenta común</h2>
        <div class="balance ${balance < 0 ? 'over-txt' : ''}">${money(balance)}</div>
        <div class="flow-rows">
          <div><span>Entradas ${periodNoun()}</span><b class="good-txt">${money(s.contributed, { sign: true })}</b></div>
          <div><span>Pagado desde la cuenta</span><b>${money(-s.fromCommon)}</b></div>
          <div><span>Resultado ${periodNoun()}</span><b class="${s.contributed - s.fromCommon >= 0 ? 'good-txt' : 'over-txt'}">${money(round2(s.contributed - s.fromCommon), { sign: true })}</b></div>
        </div>
        ${pending.length ? `<p class="faint" style="margin:10px 0 0;font-size:13px">Si devolvéis lo pendiente, el saldo quedaría en ${money(round2(balance - pending.reduce((a, p) => a + p.total, 0)))}.</p>` : ''}
      </section>

      ${pending.length ? `
      <section class="card">
        <h2>🧾 Pendiente de devolver</h2>
        <p class="muted" style="margin:-4px 0 10px">Gastos de la familia que alguien pagó con su dinero y aún no se le han devuelto desde la cuenta común.</p>
        <div class="rows">${pending.map((p) => `
          <div class="row static">
            <span class="avatar">${esc(p.m.name.slice(0, 1).toUpperCase())}</span>
            <span class="row-main"><span class="row-top"><span class="row-title">${esc(p.m.name)}</span><span class="amount">${money(p.total)}</span></span><span class="row-sub">${p.count} gasto${p.count > 1 ? 's' : ''}</span></span>
            <button class="btn small" data-reimburse="${esc(p.m.id)}">Devolver</button>
          </div>`).join('')}</div>
      </section>` : ''}

      <section class="card">
        <h2>👨‍👩‍👧 ¿Quién pone qué? <span class="muted">${esc(periodLabel())}</span></h2>
        <div class="rows">${s.members.map((x) => `
          <div class="row static">
            <span class="avatar">${esc(x.m.name.slice(0, 1).toUpperCase())}</span>
            <span class="row-main">
              <span class="row-top"><span class="row-title">${esc(x.m.name)}</span><span class="amount">${money(x.total)}</span></span>
              <span class="stack"><i class="inc" style="width:${(Math.max(0, x.contrib) / maxMember) * 100}%"></i><i class="per" style="width:${(x.personal / maxMember) * 100}%"></i></span>
              <span class="row-meta"><span>Cuenta ${money(x.contrib, { noCents: true })}${x.out ? ` (${money(x.gross, { noCents: true })} − ${money(x.out, { noCents: true })} personal)` : ''}${x.personal ? ` · Por su cuenta ${money(x.personal, { noCents: true })}` : ''}</span><span>${totalMembers > 0 ? Math.round((Math.max(0, x.total) / totalMembers) * 100) : 0}%</span></span>
            </span>
          </div>`).join('')}</div>
        ${s.otherIncome ? `<p class="faint" style="margin:8px 0 0;font-size:13px">Otros ingresos: ${money(s.otherIncome)}</p>` : ''}
        <div class="flow-legend"><span><i class="inc"></i>Aportado a la cuenta (neto de retiradas)</span><span><i class="per"></i>Pagado por su cuenta (sin devolver)</span></div>
      </section>

      ${fairCard}
      ${recommend}

      <section class="card">
        <h2>Aportado vs gastos <span class="muted">${ui.mode === 'month' ? 'últimos 6 meses' : `meses de ${ui.year}`}</span></h2>
        ${flowChart()}
      </section>`;

    bindCommon(main);
    const reg = $('[data-act=register-monthly]', main);
    if (reg) reg.onclick = () => {
      const date = periodKey('month', now.getFullYear(), now.getMonth()) + '-01';
      const items = missing.map((m) => ({ id: uid(), amount: m.monthly, memberId: m.id, date, note: 'Aportación mensual', createdAt: Date.now() }));
      persist(() => data.incomes.push(...items), () => Promise.all(items.map((i) => api('PUT', '/incomes/' + i.id, apiIncome(i)))))
        .then((ok) => ok && toast('💶 Aportaciones registradas'));
    };
    $$('[data-reimburse]', main).forEach((b) => b.addEventListener('click', () => {
      const p = pending.find((x) => x.m.id === b.dataset.reimburse);
      if (!confirm(`¿Devolver ${money(p.total)} a ${p.m.name} desde la cuenta común? Los ${p.count} gastos quedarán marcados como devueltos.`)) return;
      persist(() => data.expenses.forEach((e) => { if (e.paidBy === p.m.id) e.reimbursed = true; }), () => api('POST', '/reimburse', { member_id: p.m.id }))
        .then((ok) => ok && toast(`✅ Devuelto a ${p.m.name}`));
    }));
  }

  // ---------- Movimientos
  const sortByDate = (a, b) => (a.date === b.date ? b.createdAt - a.createdAt : a.date < b.date ? 1 : -1);

  function expenseRow(e) {
    const c = catById(e.categoryId);
    const who = e.paidBy ? `👤 Pagó ${memberName(e.paidBy)}${e.reimbursed ? ' · devuelto' : ''}` : '';
    const sub = [e.note, who].filter(Boolean).join(' · ') || c.group;
    return `
      <button class="row" data-exp="${esc(e.id)}" style="--c:${c.color}">
        <span class="cat-icon sm">${c.icon}</span>
        <span class="row-main">
          <span class="row-top"><span class="row-title">${esc(c.name)}</span><span class="amount">${money(e.amount)}</span></span>
          <span class="row-sub">${e.paidBy && !e.reimbursed ? '<span class="tag">Por devolver</span> ' : ''}${esc(sub)}</span>
        </span>
      </button>`;
  }
  function incomeRow(i) {
    if (isWithdrawal(i)) {
      return `
      <button class="row" data-inc="${esc(i.id)}" style="--c:${WITHDRAWAL_COLOR}">
        <span class="cat-icon sm">👛</span>
        <span class="row-main">
          <span class="row-top"><span class="row-title">Retirada personal de ${esc(memberName(i.memberId))}</span><span class="amount warn-txt">${money(-i.amount)}</span></span>
          <span class="row-sub">${esc(i.note || 'Sale de la cuenta común para uso personal')}</span>
        </span>
      </button>`;
    }
    return `
      <button class="row" data-inc="${esc(i.id)}" style="--c:${INCOME_COLOR}">
        <span class="cat-icon sm">💶</span>
        <span class="row-main">
          <span class="row-top"><span class="row-title">${i.memberId ? `Aportación de ${esc(memberName(i.memberId))}` : 'Otro ingreso'}</span><span class="amount good-txt">${money(i.amount, { sign: true })}</span></span>
          <span class="row-sub">${esc(i.note || 'Cuenta común')}</span>
        </span>
      </button>`;
  }

  function renderMovements() {
    const key = periodKey();
    const q = ui.search.trim().toLowerCase();
    let exps = inPeriod(data.expenses, key);
    let incs = inPeriod(data.incomes, key);
    const usedCats = new Set(exps.map((e) => e.categoryId));
    if (ui.filterType === 'income') exps = [];
    if (ui.filterType === 'expense' || ui.filterType === 'personal' || ui.filterCat) incs = [];
    if (ui.filterType === 'personal') exps = exps.filter((e) => e.paidBy);
    if (ui.filterCat) exps = exps.filter((e) => e.categoryId === ui.filterCat);
    if (q) {
      exps = exps.filter((e) => { const c = catById(e.categoryId); return [e.note, e.paidBy && memberName(e.paidBy), c.name, c.group, String(e.amount).replace('.', ',')].join(' ').toLowerCase().includes(q); });
      incs = incs.filter((i) => [i.note, i.memberId ? memberName(i.memberId) : 'otro ingreso', isWithdrawal(i) ? 'retirada personal' : 'aportación ingreso', String(i.amount).replace('.', ',')].join(' ').toLowerCase().includes(q));
    }
    const all = [...exps.map((x) => ({ t: 'e', x, date: x.date, createdAt: x.createdAt })), ...incs.map((x) => ({ t: 'i', x, date: x.date, createdAt: x.createdAt }))].sort(sortByDate);
    const days = new Map();
    all.forEach((r) => { if (!days.has(r.date)) days.set(r.date, []); days.get(r.date).push(r); });

    const chipCats = data.categories.filter((c) => usedCats.has(c.id) || c.id === ui.filterCat);
    const filterCat = ui.filterCat ? catById(ui.filterCat) : null;
    const filtered = ui.filterCat || q || ui.filterType !== 'all';
    const dayTotals = (items) => {
      const e = sum(items.filter((r) => r.t === 'e').map((r) => r.x));
      const i = netSum(items.filter((r) => r.t === 'i').map((r) => r.x));
      return [i ? `<span class="${i > 0 ? 'good-txt' : 'warn-txt'}">${money(i, { sign: true })}</span>` : '', e ? money(-e) : ''].filter(Boolean).join(' · ');
    };

    main.innerHTML = `
      ${periodSelector()}
      <div class="toolbar">
        <div class="seg wide">
          ${[['all', 'Todo'], ['expense', 'Gastos'], ['income', 'Ingresos'], ['personal', 'Por su cuenta']].map(([k, l]) => `<button data-type="${k}" class="${ui.filterType === k ? 'on' : ''}">${l}</button>`).join('')}
        </div>
        <input class="search" type="search" placeholder="Buscar por nota, persona, categoría…" value="${esc(ui.search)}" aria-label="Buscar">
        ${ui.filterType !== 'income' && chipCats.length ? `<div class="chips">
          <button class="chip ${!ui.filterCat ? 'on' : ''}" data-filter="">Todas</button>
          ${chipCats.map((c) => `<button class="chip ${ui.filterCat === c.id ? 'on' : ''}" data-filter="${esc(c.id)}">${c.icon} ${esc(c.name)}</button>`).join('')}
        </div>` : ''}
      </div>
      ${filtered && all.length ? `<div class="filter-total"><span>${filterCat ? `${filterCat.icon} ${esc(filterCat.name)}` : 'Total'} · ${all.length}</span><span>${incs.length ? money(netSum(incs), { sign: true }) : ''}${incs.length && exps.length ? ' · ' : ''}${exps.length ? money(-sum(exps)) : ''}</span></div>` : ''}
      ${all.length ? [...days.entries()].map(([date, items]) => `
        <div class="day-head"><span>${esc(dayLabel(date))}</span><span>${dayTotals(items)}</span></div>
        <div class="card list-card"><div class="rows">${items.map((r) => (r.t === 'e' ? expenseRow(r.x) : incomeRow(r.x))).join('')}</div></div>
      `).join('') : `
        <div class="card empty">
          <div class="big">🧾</div>
          <h3>Sin movimientos</h3>
          <p>${filtered ? 'No hay resultados con estos filtros.' : 'No hay movimientos en este periodo.'}</p>
          <button class="btn primary" data-act="add">➕ Añadir</button>
        </div>`}`;

    bindCommon(main);
    const search = $('.search', main);
    search.addEventListener('input', () => {
      ui.search = search.value;
      const pos = search.selectionStart;
      renderMovements();
      const s = $('.search', main); s.focus(); try { s.setSelectionRange(pos, pos); } catch (_) {}
    });
    $$('[data-type]', main).forEach((b) => b.addEventListener('click', () => { ui.filterType = b.dataset.type; if (ui.filterType === 'income') ui.filterCat = ''; renderMovements(); }));
    $$('[data-filter]', main).forEach((b) => b.addEventListener('click', () => { ui.filterCat = b.dataset.filter; renderMovements(); }));
    const add = $('[data-act=add]', main);
    if (add) add.onclick = () => (ui.filterType === 'income' ? openIncomeForm() : openExpenseForm(null, ui.filterCat));
  }

  function dayLabel(iso) {
    const d = parseISO(iso);
    const t = new Date(); t.setHours(0, 0, 0, 0);
    const diff = Math.round((t - d) / 864e5);
    if (diff === 0) return 'Hoy';
    if (diff === 1) return 'Ayer';
    return d.toLocaleDateString('es-ES', { weekday: 'long', day: 'numeric', month: 'long' });
  }

  // ---------- Categorías
  function renderCategories() {
    const monthList = inPeriod(data.expenses, periodKey('month', now.getFullYear(), now.getMonth()));
    const groups = new Map();
    data.categories.forEach((c) => { if (!groups.has(c.group)) groups.set(c.group, []); groups.get(c.group).push(c); });
    main.innerHTML = `
      <button class="link-btn back" data-goto="ajustes">‹ Ajustes</button>
      <p class="muted" style="margin:0 0 14px">Organiza las categorías en grupos, elige su icono y color, y ponles un presupuesto mensual si queréis controlar cuánto gastáis.</p>
      ${[...groups.entries()].map(([g, cats]) => `
        <div class="day-head"><span>${esc(g)}</span><span>${money(sum(monthList.filter((e) => cats.some((c) => c.id === e.categoryId))), { noCents: true })} este mes</span></div>
        <div class="card list-card"><div class="rows">
          ${cats.map((c) => `
            <button class="row" data-edit-cat="${esc(c.id)}" style="--c:${c.color}">
              <span class="cat-icon">${c.icon}</span>
              <span class="row-main">
                <span class="row-top"><span class="row-title">${esc(c.name)}</span><span class="amount">${money(sum(monthList.filter((e) => e.categoryId === c.id)))}</span></span>
                <span class="row-sub">${c.budget ? `Presupuesto: ${money(c.budget, { noCents: true })}/mes` : 'Sin presupuesto'}</span>
              </span>
            </button>`).join('')}
        </div></div>`).join('')}
      <button class="btn primary block" data-act="new-cat">➕ Nueva categoría</button>`;
    bindCommon(main);
    $$('[data-edit-cat]', main).forEach((b) => b.addEventListener('click', () => openCategoryForm(data.categories.find((c) => c.id === b.dataset.editCat))));
    $('[data-act=new-cat]', main).onclick = () => openCategoryForm();
  }

  // ---------- Ajustes
  function renderSettings() {
    main.innerHTML = `
      <section class="card">
        <h2>👨‍👩‍👧‍👦 Familia y aportaciones</h2>
        <p class="muted" style="margin-top:-6px">Quién aporta a la cuenta común y cuánto al mes. Si le pones su email de Google, esa persona podrá entrar en la app.</p>
        <div class="rows">
          ${data.members.map((m) => `
            <button class="row" data-member="${esc(m.id)}">
              <span class="avatar">${esc(m.name.slice(0, 1).toUpperCase())}</span>
              <span class="row-main"><span class="row-top"><span class="row-title">${esc(m.name)}${isMe(m) ? ' <span class="tag me-tag">Tú</span>' : ''}</span><span class="amount">${m.monthly ? money(m.monthly, { noCents: true }) + '/mes' : '<span class="faint">sin aportación fija</span>'}</span></span><span class="row-sub">${m.income ? `Ingresos ${money(m.income, { noCents: true })}/mes · ` : ''}${m.email ? '🔑 ' + esc(m.email) : 'Sin acceso a la app'}</span></span>
            </button>`).join('') || '<p class="faint">Aún no hay miembros.</p>'}
        </div>
        <button class="btn block" data-act="new-member" style="margin-top:8px">➕ Añadir miembro</button>
      </section>

      <section class="card">
        <h2>🏦 Cuenta común</h2>
        <div class="setting">
          <div><div class="s-title">Saldo inicial</div><div class="s-sub">Lo que había en la cuenta antes de empezar a apuntar</div></div>
          <input class="input" id="initial-balance" inputmode="decimal" style="width:130px;text-align:right" value="${data.settings.initialBalance ? String(data.settings.initialBalance).replace('.', ',') : ''}" placeholder="0,00">
        </div>
        <div class="setting">
          <div><div class="s-title">% de aportación acordado</div><div class="s-sub">Lo que pone cada uno de su nómina (el mismo % para todos)</div></div>
          <input class="input" id="contribution-pct" inputmode="decimal" style="width:100px;text-align:right" value="${data.settings.contributionPct ? String(data.settings.contributionPct).replace('.', ',') : ''}" placeholder="Ej.: 55,16">
        </div>
        <div class="setting">
          <div><div class="s-title">Moneda</div></div>
          <select class="input" id="currency" style="width:auto">${CURRENCIES.map(([c, n]) => `<option value="${c}" ${data.settings.currency === c ? 'selected' : ''}>${n}</option>`).join('')}</select>
        </div>
      </section>

      <section class="card">
        <button class="row" data-goto="categorias">
          <span class="cat-icon" style="--c:var(--accent)">🗂️</span>
          <span class="row-main"><span class="row-title">Categorías y presupuestos</span><span class="row-sub">${data.categories.length} categorías</span></span>
          <span class="faint">›</span>
        </button>
      </section>

      <section class="card">
        <h2>💾 Datos</h2>
        <p class="muted" style="margin-top:-6px">Los datos se guardan en la base de datos de la familia (Cloudflare D1) y se ven en todos vuestros dispositivos.</p>
        <div class="setting">
          <div><div class="s-title">Copia de seguridad</div><div class="s-sub">${data.expenses.length} gastos · ${data.incomes.length} ingresos</div></div>
          <button class="btn" data-act="export">⬇️ Exportar</button>
        </div>
        <div class="setting">
          <div><div class="s-title">Restaurar copia</div><div class="s-sub">Sustituye todos los datos</div></div>
          <label class="btn">⬆️ Importar<input type="file" accept="application/json,.json" id="import-file" hidden></label>
        </div>
        <div class="setting">
          <div><div class="s-title">Exportar a Excel</div><div class="s-sub">CSV con gastos e ingresos</div></div>
          <button class="btn" data-act="csv">📊 CSV</button>
        </div>
        <div class="setting">
          <div><div class="s-title">Datos de ejemplo</div><div class="s-sub">Para probar (borra los actuales)</div></div>
          <button class="btn" data-act="demo">✨ Cargar</button>
        </div>
        <div class="setting">
          <div><div class="s-title">Borrar todo</div><div class="s-sub">Empezar de cero</div></div>
          <button class="btn danger" data-act="reset">🗑️ Borrar</button>
        </div>
      </section>

      <section class="card">
        <div class="setting">
          <div class="me">
            ${data.me && data.me.picture ? `<img src="${esc(data.me.picture)}" alt="" referrerpolicy="no-referrer" width="38" height="38">` : `<span class="avatar">${esc(((data.me && (data.me.name || data.me.email)) || '?').slice(0, 1).toUpperCase())}</span>`}
            <div><div class="s-title">${esc((data.me && data.me.name) || 'Sesión iniciada')}</div><div class="s-sub">${esc((data.me && data.me.email) || '')}</div></div>
          </div>
          <button class="btn" data-act="logout">🚪 Salir</button>
        </div>
      </section>
      <p class="faint" style="text-align:center;font-size:12px">Gastos de Casa</p>`;

    bindCommon(main);
    $$('[data-member]', main).forEach((b) => b.addEventListener('click', () => openMemberForm(memberById(b.dataset.member))));
    $('[data-act=new-member]', main).onclick = () => openMemberForm();
    $('#currency').addEventListener('change', (ev) => {
      const v = ev.target.value;
      persist(() => { data.settings.currency = v; }, () => api('PUT', '/settings', { currency: v })).then((ok) => ok && toast('Moneda actualizada'));
    });
    $('#initial-balance').addEventListener('change', (ev) => {
      const v = ev.target.value.trim() === '' ? 0 : parseAmount(ev.target.value.replace(/^(-?)/, '$1'));
      if (Number.isNaN(v)) return toast('Importe no válido');
      persist(() => { data.settings.initialBalance = v; }, () => api('PUT', '/settings', { initial_balance: toCents(v) })).then((ok) => ok && toast('Saldo inicial guardado'));
    });
    $('#contribution-pct').addEventListener('change', (ev) => {
      const v = ev.target.value.trim() === '' ? 0 : parseFloat(ev.target.value.replace('%', '').replace(',', '.'));
      if (Number.isNaN(v) || v < 0 || v > 100) return toast('Porcentaje no válido');
      persist(() => { data.settings.contributionPct = round2(v); }, () => api('PUT', '/settings', { contribution_pct: Math.round(v * 100) })).then((ok) => ok && toast('% acordado guardado'));
    });
    $('[data-act=export]', main).onclick = exportJSON;
    $('[data-act=csv]', main).onclick = exportCSV;
    $('#import-file').addEventListener('change', importJSON);
    $('[data-act=demo]', main).onclick = () => {
      if ((data.expenses.length || data.incomes.length) && !confirm('Se borrarán todos los datos actuales (de toda la familia) y se cargarán datos de ejemplo. ¿Continuar?')) return;
      loadDemo();
    };
    $('[data-act=reset]', main).onclick = () => {
      if (!confirm('¿Seguro que queréis borrar TODOS los gastos, ingresos, miembros y categorías? Esta acción no se puede deshacer.')) return;
      replaceAll(toApi(emptyData()), 'Datos borrados');
    };
    $('[data-act=logout]', main).onclick = () => { if (confirm('¿Cerrar sesión en este dispositivo?')) logout(); };
  }

  // ---------------------------------------------------------------- hoja inferior (formularios)
  const sheetRoot = $('#sheet-root');
  const sheetBody = $('#sheet-body');
  let lastFocus = null;

  function openSheet(html, onMount) {
    if (sheetRoot.hidden) lastFocus = document.activeElement;
    sheetBody.innerHTML = html;
    sheetRoot.hidden = false;
    document.body.style.overflow = 'hidden';
    onMount && onMount(sheetBody);
  }
  function closeSheet() {
    if (sheetRoot.hidden) return;
    sheetRoot.hidden = true;
    sheetBody.innerHTML = '';
    document.body.style.overflow = '';
    if (lastFocus && lastFocus.focus) lastFocus.focus();
  }
  sheetRoot.addEventListener('click', (e) => { if (e.target.closest('[data-close]')) closeSheet(); });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !sheetRoot.hidden) closeSheet(); });

  const typeSwitch = (active) => `
    <div class="seg wide" style="margin-bottom:6px">
      <button type="button" data-switch="expense" class="${active === 'expense' ? 'on' : ''}">💸 Gasto</button>
      <button type="button" data-switch="income" class="${active === 'income' ? 'on' : ''}">💶 Ingreso</button>
      ${data.members.length ? `<button type="button" data-switch="withdrawal" class="${active === 'withdrawal' ? 'on' : ''}">👛 Retirada</button>` : ''}
    </div>`;
  function bindTypeSwitch(root) {
    $$('[data-switch]', root).forEach((b) => b.addEventListener('click', () => {
      const amount = $('#f-amount', root).value;
      if (b.dataset.switch === 'income' || b.dataset.switch === 'withdrawal') openIncomeForm(null, amount, b.dataset.switch); else openExpenseForm(null, '', amount);
    }));
  }
  const amountField = (value) => `
    <div class="amount-input">
      <input id="f-amount" inputmode="decimal" placeholder="0,00" value="${esc(value)}" aria-label="Importe" required>
      <span class="cur">${esc(currencySymbol())}</span>
    </div>`;
  function bindAmount(root) {
    const amount = $('#f-amount', root);
    if (matchMedia('(pointer: fine)').matches || !amount.value) setTimeout(() => amount.focus(), 60);
    amount.addEventListener('input', () => { amount.value = amount.value.replace(/[^\d.,]/g, ''); });
    return amount;
  }

  function openExpenseForm(exp = null, presetCat = '', presetAmount = '') {
    const editing = Boolean(exp);
    let catId = exp ? exp.categoryId : presetCat || '';
    let paidBy = exp ? exp.paidBy : '';
    let reimbursed = exp ? exp.reimbursed : false;
    const lastCat = [...data.expenses].sort((a, b) => b.createdAt - a.createdAt)[0];

    openSheet(`
      ${editing ? '<h2 id="sheet-title">Editar gasto</h2>' : typeSwitch('expense')}
      <form id="exp-form" autocomplete="off">
        ${amountField(exp ? String(exp.amount).replace('.', ',') : presetAmount)}
        <div class="field">
          <span class="field-label">Categoría</span>
          <div class="cat-grid">
            ${data.categories.map((c) => `
              <button type="button" class="cat-pick ${catId === c.id ? 'on' : ''}" data-pick="${esc(c.id)}" style="--c:${c.color}${!catId && lastCat && lastCat.categoryId === c.id ? ';order:-1' : ''}">
                <span class="cat-icon">${c.icon}</span><span>${esc(c.name)}</span>
              </button>`).join('')}
          </div>
        </div>
        ${data.members.length ? `
        <div class="field">
          <span class="field-label">¿Cómo se ha pagado?</span>
          <div class="chips wrap">
            <button type="button" class="chip ${!paidBy ? 'on' : ''}" data-paid="">🏦 Cuenta común</button>
            ${data.members.map((m) => `<button type="button" class="chip ${paidBy === m.id ? 'on' : ''}" data-paid="${esc(m.id)}">👤 ${esc(m.name)} (por su cuenta)</button>`).join('')}
          </div>
          <label class="check" id="reimb-wrap" ${paidBy ? '' : 'hidden'}><input type="checkbox" id="f-reimbursed" ${reimbursed ? 'checked' : ''}> Ya se le ha devuelto desde la cuenta común</label>
        </div>` : ''}
        <div class="two">
          <div class="field"><label for="f-date">Fecha</label><input class="input" type="date" id="f-date" value="${exp ? exp.date : todayISO()}" required></div>
          <div class="field"><label for="f-note">Nota</label><input class="input" id="f-note" placeholder="Opcional" maxlength="120" value="${esc(exp ? exp.note : '')}"></div>
        </div>
        <div class="btn-row" style="margin-top:6px">
          ${editing ? '<button type="button" class="btn danger" data-act="delete">🗑️ Borrar</button>' : '<button type="button" class="btn" data-close>Cancelar</button>'}
          <button type="submit" class="btn primary">${editing ? 'Guardar cambios' : 'Añadir gasto'}</button>
        </div>
      </form>`, (root) => {
      const amount = bindAmount(root);
      bindTypeSwitch(root);
      $$('[data-pick]', root).forEach((b) => b.addEventListener('click', () => {
        catId = b.dataset.pick;
        $$('[data-pick]', root).forEach((x) => x.classList.toggle('on', x === b));
      }));
      $$('[data-paid]', root).forEach((b) => b.addEventListener('click', () => {
        paidBy = b.dataset.paid;
        $$('[data-paid]', root).forEach((x) => x.classList.toggle('on', x === b));
        $('#reimb-wrap', root).hidden = !paidBy;
      }));
      const del = $('[data-act=delete]', root);
      if (del) del.onclick = () => {
        const removed = { ...exp };
        closeSheet();
        persist(() => { data.expenses = data.expenses.filter((x) => x.id !== exp.id); }, () => api('DELETE', '/expenses/' + exp.id))
          .then((ok) => ok && toast('Gasto borrado', 'Deshacer', () => persist(() => data.expenses.push(removed), () => api('PUT', '/expenses/' + removed.id, apiExpense(removed)))));
      };
      $('#exp-form', root).addEventListener('submit', (ev) => {
        ev.preventDefault();
        const value = parseAmount(amount.value);
        if (!(value > 0)) { amount.focus(); return toast('Escribe un importe'); }
        if (!catId) return toast('Elige una categoría');
        const r = $('#f-reimbursed', root);
        const item = {
          id: exp ? exp.id : uid(), amount: value, categoryId: catId, date: $('#f-date', root).value || todayISO(),
          note: $('#f-note', root).value.trim(), paidBy, reimbursed: Boolean(paidBy && r && r.checked), createdAt: exp ? exp.createdAt : Date.now(),
        };
        closeSheet();
        if (!editing) { const d = parseISO(item.date); ui.year = d.getFullYear(); ui.month = d.getMonth(); }
        persist(() => { if (editing) Object.assign(exp, item); else data.expenses.push(item); }, () => api('PUT', '/expenses/' + item.id, apiExpense(item)))
          .then((ok) => { const c = catById(catId); ok && toast(`${c.icon} ${editing ? 'Gasto actualizado' : `${money(value)} en ${c.name}`}${paidBy && !item.reimbursed ? ` · ${memberName(paidBy)} lo ha pagado` : ''}`); });
      });
    });
  }

  // kind: 'income' (ingreso/aportación) o 'withdrawal' (retirada personal)
  function openIncomeForm(inc = null, presetAmount = '', kind = 'income') {
    const editing = Boolean(inc);
    if (inc) kind = inc.kind || 'income';
    const out = kind === 'withdrawal';
    const mine = data.members.find(isMe);
    let memberId = inc ? inc.memberId : (data.members.length ? ((mine && mine.id) || lsGet(LS + ':lastIncomeMember') || data.members[0].id) : '');
    if (memberId && !memberById(memberId)) memberId = data.members[0] ? data.members[0].id : '';
    const fill = !inc && !presetAmount && !out && memberId ? (memberById(memberId).monthly || '') : '';

    openSheet(`
      ${editing ? `<h2 id="sheet-title">${out ? 'Editar retirada personal' : 'Editar ingreso'}</h2>` : typeSwitch(kind)}
      <form id="inc-form" autocomplete="off">
        ${amountField(inc ? String(inc.amount).replace('.', ',') : presetAmount || (fill ? String(fill).replace('.', ',') : ''))}
        ${out ? '<p class="faint" style="font-size:13px;margin:-6px 0 12px;text-align:center">Dinero que sale de la cuenta común para uso personal (su parte de la nómina, ahorro propio…). No cuenta como gasto de la familia: resta de lo que aporta.</p>' : ''}
        <div class="field">
          <span class="field-label">${out ? '¿Para quién?' : '¿Quién ingresa en la cuenta común?'}</span>
          <div class="chips wrap">
            ${data.members.map((m) => `<button type="button" class="chip ${memberId === m.id ? 'on' : ''}" data-who="${esc(m.id)}">👤 ${esc(m.name)}</button>`).join('')}
            ${out ? '' : `<button type="button" class="chip ${!memberId ? 'on' : ''}" data-who="">➕ Otro ingreso</button>`}
          </div>
          ${!data.members.length ? '<p class="faint" style="font-size:13px">Consejo: añade a los miembros de la familia en Ajustes.</p>' : ''}
        </div>
        <div class="two">
          <div class="field"><label for="f-date">Fecha</label><input class="input" type="date" id="f-date" value="${inc ? inc.date : todayISO()}" required></div>
          <div class="field"><label for="f-note">Nota</label><input class="input" id="f-note" placeholder="${out ? 'Ej.: parte personal de la nómina' : 'Ej.: aportación mensual'}" maxlength="120" value="${esc(inc ? inc.note : '')}"></div>
        </div>
        <div class="btn-row" style="margin-top:6px">
          ${editing ? '<button type="button" class="btn danger" data-act="delete">🗑️ Borrar</button>' : '<button type="button" class="btn" data-close>Cancelar</button>'}
          <button type="submit" class="btn primary">${editing ? 'Guardar cambios' : out ? 'Añadir retirada' : 'Añadir ingreso'}</button>
        </div>
      </form>`, (root) => {
      const amount = bindAmount(root);
      bindTypeSwitch(root);
      let autoFilled = Boolean(fill);
      amount.addEventListener('input', () => { autoFilled = false; });
      $$('[data-who]', root).forEach((b) => b.addEventListener('click', () => {
        memberId = b.dataset.who;
        $$('[data-who]', root).forEach((x) => x.classList.toggle('on', x === b));
        const m = memberById(memberId);
        if (!editing && !out && (autoFilled || !amount.value)) { amount.value = m && m.monthly ? String(m.monthly).replace('.', ',') : ''; autoFilled = Boolean(amount.value); }
      }));
      const del = $('[data-act=delete]', root);
      if (del) del.onclick = () => {
        const removed = { ...inc };
        closeSheet();
        persist(() => { data.incomes = data.incomes.filter((x) => x.id !== inc.id); }, () => api('DELETE', '/incomes/' + inc.id))
          .then((ok) => ok && toast(out ? 'Retirada borrada' : 'Ingreso borrado', 'Deshacer', () => persist(() => data.incomes.push(removed), () => api('PUT', '/incomes/' + removed.id, apiIncome(removed)))));
      };
      $('#inc-form', root).addEventListener('submit', (ev) => {
        ev.preventDefault();
        const value = parseAmount(amount.value);
        if (!(value > 0)) { amount.focus(); return toast('Escribe un importe'); }
        if (out && !memberId) return toast('Elige para quién es');
        const item = { id: inc ? inc.id : uid(), kind, amount: value, memberId, date: $('#f-date', root).value || todayISO(), note: $('#f-note', root).value.trim(), createdAt: inc ? inc.createdAt : Date.now() };
        if (memberId) lsSet(LS + ':lastIncomeMember', memberId);
        closeSheet();
        if (!editing) { const d = parseISO(item.date); ui.year = d.getFullYear(); ui.month = d.getMonth(); }
        persist(() => { if (editing) Object.assign(inc, item); else data.incomes.push(item); }, () => api('PUT', '/incomes/' + item.id, apiIncome(item)))
          .then((ok) => ok && toast(out ? `👛 ${editing ? 'Retirada actualizada' : `${money(-value)} para ${memberName(memberId)}`}` : `💶 ${editing ? 'Ingreso actualizado' : `${money(value, { sign: true })} en la cuenta común`}`));
      });
    });
  }

  function openMemberForm(member = null) {
    const editing = Boolean(member);
    openSheet(`
      <h2 id="sheet-title">${editing ? 'Editar miembro' : 'Nuevo miembro'}</h2>
      <form id="mem-form" autocomplete="off">
        <div class="field"><label for="m-name">Nombre</label><input class="input" id="m-name" maxlength="30" required value="${esc(member ? member.name : '')}" placeholder="Ej.: Mamá, Papá, Lucía…"></div>
        <div class="field">
          <label for="m-email">Email de Google</label>
          <input class="input" id="m-email" type="email" maxlength="120" autocomplete="off" placeholder="nombre@gmail.com (opcional)" value="${esc(member ? member.email || '' : '')}">
          <p class="faint" style="font-size:13px;margin:6px 0 0">Con su email podrá entrar en la app con su cuenta de Google.</p>
        </div>
        <div class="field">
          <label for="m-income">Ingresos netos al mes</label>
          <input class="input" id="m-income" inputmode="decimal" placeholder="Ej.: nómina neta (opcional)" value="${member && member.income ? String(member.income).replace('.', ',') : ''}">
          <p class="faint" style="font-size:13px;margin:6px 0 0">Para comprobar que aportáis el mismo % de lo que cobra cada uno. Si hay pagas extra, pon la media mensual.</p>
        </div>
        <div class="field">
          <label for="m-monthly">Aportación fija mensual a la cuenta común</label>
          <input class="input" id="m-monthly" inputmode="decimal" placeholder="0,00 (opcional)" value="${member && member.monthly ? String(member.monthly).replace('.', ',') : ''}">
          <p class="faint" style="font-size:13px;margin:6px 0 0">Se usa para registrar las aportaciones del mes con un toque y para calcular si es suficiente.</p>
        </div>
        <div class="btn-row" style="margin-top:6px">
          ${editing ? '<button type="button" class="btn danger" data-act="delete">🗑️ Borrar</button>' : '<button type="button" class="btn" data-close>Cancelar</button>'}
          <button type="submit" class="btn primary">${editing ? 'Guardar' : 'Añadir'}</button>
        </div>
      </form>`, (root) => {
      setTimeout(() => $('#m-name', root).focus(), 60);
      const del = $('[data-act=delete]', root);
      if (del) del.onclick = () => {
        const used = data.expenses.some((e) => e.paidBy === member.id) || data.incomes.some((i) => i.memberId === member.id);
        if (used) return toast(`${member.name} tiene movimientos y no se puede borrar`);
        if (!confirm(`¿Borrar a ${member.name}?`)) return;
        closeSheet();
        persist(() => { data.members = data.members.filter((m) => m.id !== member.id); }, () => api('DELETE', '/members/' + member.id));
      };
      $('#mem-form', root).addEventListener('submit', (ev) => {
        ev.preventDefault();
        const name = $('#m-name', root).value.trim();
        if (!name) return;
        if (data.members.some((m) => m.name.toLowerCase() === name.toLowerCase() && m.id !== (member && member.id))) return toast('Ya existe ese nombre');
        const raw = $('#m-monthly', root).value.trim();
        const monthly = raw ? parseAmount(raw) : 0;
        if (Number.isNaN(monthly) || monthly < 0) return toast('Aportación no válida');
        const email = $('#m-email', root).value.trim().toLowerCase();
        if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return toast('Email no válido');
        if (email && data.members.some((m) => m.email === email && m.id !== (member && member.id))) return toast('Ese email ya es de otro miembro');
        if (member && isMe(member) && member.email && email !== member.email && !confirm('Vas a cambiar tu propio email. Si no estás en la lista de emails autorizados del servidor, perderás el acceso. ¿Continuar?')) return;
        const rawInc = $('#m-income', root).value.trim();
        const income = rawInc ? parseAmount(rawInc) : 0;
        if (Number.isNaN(income) || income < 0) return toast('Ingresos no válidos');
        const item = { id: member ? member.id : uid(), name, email, monthly, income, sort: member ? member.sort : data.members.length };
        closeSheet();
        persist(() => { if (editing) Object.assign(member, item); else data.members.push(item); }, () => api('PUT', '/members/' + item.id, apiMember(item)))
          .then((ok) => ok && toast(editing ? 'Guardado' : `👤 ${name} añadido`));
      });
    });
  }

  function openCategoryForm(cat = null) {
    const editing = Boolean(cat);
    const state = cat ? { ...cat } : { id: uid(), name: '', icon: '📦', color: COLORS[0], group: 'Otros', budget: 0, sort: data.categories.length + 1 };
    const groups = [...new Set(data.categories.map((c) => c.group))];
    const count = editing ? data.expenses.filter((e) => e.categoryId === cat.id).length : 0;

    openSheet(`
      <h2 id="sheet-title">${editing ? 'Editar categoría' : 'Nueva categoría'}</h2>
      <form id="cat-form" autocomplete="off">
        <div class="cat-preview" style="--c:${state.color}">
          <span class="cat-icon" id="pv-icon">${state.icon}</span>
          <div><b id="pv-name">${esc(state.name || 'Nombre de la categoría')}</b><div class="row-sub" id="pv-group">${esc(state.group)}</div></div>
        </div>
        <div class="field"><label for="c-name">Nombre</label><input class="input" id="c-name" maxlength="40" required value="${esc(state.name)}" placeholder="Ej.: Comedor escolar"></div>
        <div class="two">
          <div class="field">
            <label for="c-group">Grupo</label>
            <input class="input" id="c-group" list="group-list" maxlength="30" value="${esc(state.group)}">
            <datalist id="group-list">${groups.map((g) => `<option value="${esc(g)}">`).join('')}</datalist>
          </div>
          <div class="field"><label for="c-budget">Presupuesto / mes</label><input class="input" id="c-budget" inputmode="decimal" placeholder="Sin límite" value="${state.budget ? String(state.budget).replace('.', ',') : ''}"></div>
        </div>
        <div class="field"><span class="field-label">Icono</span><div class="emoji-grid">${EMOJIS.map((e) => `<button type="button" data-emoji="${e}" class="${e === state.icon ? 'on' : ''}">${e}</button>`).join('')}</div></div>
        <div class="field"><span class="field-label">Color</span><div class="swatches">${COLORS.map((c) => `<button type="button" data-color="${c}" class="${c === state.color ? 'on' : ''}" style="--c:${c}" aria-label="Color ${c}"></button>`).join('')}</div></div>
        <div class="btn-row" style="margin-top:6px">
          ${editing ? '<button type="button" class="btn danger" data-act="delete">🗑️ Borrar</button>' : '<button type="button" class="btn" data-close>Cancelar</button>'}
          <button type="submit" class="btn primary">${editing ? 'Guardar' : 'Crear categoría'}</button>
        </div>
      </form>`, (root) => {
      const preview = $('.cat-preview', root);
      $('#c-name', root).addEventListener('input', (e) => { $('#pv-name', root).textContent = e.target.value || 'Nombre de la categoría'; });
      $('#c-group', root).addEventListener('input', (e) => { $('#pv-group', root).textContent = e.target.value; });
      $$('[data-emoji]', root).forEach((b) => b.addEventListener('click', () => {
        state.icon = b.dataset.emoji; $('#pv-icon', root).textContent = state.icon;
        $$('[data-emoji]', root).forEach((x) => x.classList.toggle('on', x === b));
      }));
      $$('[data-color]', root).forEach((b) => b.addEventListener('click', () => {
        state.color = b.dataset.color; preview.style.setProperty('--c', state.color);
        $$('[data-color]', root).forEach((x) => x.classList.toggle('on', x === b));
      }));
      const del = $('[data-act=delete]', root);
      if (del) del.onclick = () => {
        if (data.categories.length <= 1) return toast('Debe quedar al menos una categoría');
        const fallback = data.categories.find((c) => c.id === 'otros' && c.id !== cat.id) || data.categories.find((c) => c.id !== cat.id);
        if (!confirm(count ? `"${cat.name}" tiene ${count} gasto(s), que pasarán a "${fallback.name}". ¿Borrar la categoría?` : `¿Borrar la categoría "${cat.name}"?`)) return;
        closeSheet();
        if (ui.filterCat === cat.id) ui.filterCat = '';
        persist(() => {
          data.expenses.forEach((e) => { if (e.categoryId === cat.id) e.categoryId = fallback.id; });
          data.categories = data.categories.filter((c) => c.id !== cat.id);
        }, () => api('DELETE', `/categories/${cat.id}?move_to=${encodeURIComponent(fallback.id)}`)).then((ok) => ok && toast('Categoría borrada'));
      };
      $('#cat-form', root).addEventListener('submit', (ev) => {
        ev.preventDefault();
        state.name = $('#c-name', root).value.trim();
        if (!state.name) return toast('Ponle un nombre');
        state.group = $('#c-group', root).value.trim() || 'Otros';
        const b = parseAmount($('#c-budget', root).value);
        state.budget = b > 0 ? b : 0;
        closeSheet();
        persist(() => { if (editing) Object.assign(cat, state); else data.categories.push(state); }, () => api('PUT', '/categories/' + state.id, apiCategory(state)))
          .then((ok) => ok && toast(`${state.icon} ${editing ? 'Categoría guardada' : 'Categoría creada'}`));
      });
    });
  }

  // ---------------------------------------------------------------- import / export
  function download(name, content, type) {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([content], { type }));
    a.download = name;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }
  function exportJSON() {
    download(`gastos-casa-${todayISO()}.json`, JSON.stringify(toApi(data), null, 2), 'application/json');
    toast('Copia descargada');
  }
  function exportCSV() {
    const q = (s) => `"${String(s ?? '').replace(/"/g, '""')}"`;
    const n = (v) => v.toFixed(2).replace('.', ',');
    const rows = [['Tipo', 'Fecha', 'Categoría', 'Grupo', 'Importe', 'Nota', 'Pagado / ingresado por', 'Devuelto'].map(q).join(';')];
    const all = [
      ...data.expenses.map((e) => { const c = catById(e.categoryId); return [e.date, ['Gasto', e.date, c.name, c.group, n(-e.amount), e.note, e.paidBy ? memberName(e.paidBy) : 'Cuenta común', e.paidBy ? (e.reimbursed ? 'Sí' : 'No') : '']]; }),
      ...data.incomes.map((i) => [i.date, [isWithdrawal(i) ? 'Retirada personal' : 'Ingreso', i.date, '', '', n(signed(i)), i.note, i.memberId ? memberName(i.memberId) : 'Otro ingreso', '']]),
    ].sort((a, b) => (a[0] < b[0] ? -1 : 1));
    all.forEach(([, r]) => rows.push(r.map(q).join(';')));
    download(`gastos-casa-${todayISO()}.csv`, '﻿' + rows.join('\r\n'), 'text/csv;charset=utf-8');
    toast('CSV descargado');
  }
  function importJSON(ev) {
    const file = ev.target.files && ev.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        let payload = JSON.parse(reader.result);
        if (!payload || !Array.isArray(payload.expenses)) throw new Error();
        if (payload.expenses.some((e) => 'categoryId' in e) || (payload.members || []).some((m) => typeof m === 'string')) payload = legacyToApi(payload);
        if (!confirm(`Se importarán ${payload.expenses.length} gastos y ${(payload.incomes || []).length} ingresos, sustituyendo TODOS los datos actuales. ¿Continuar?`)) return;
        payload.incomes = payload.incomes || [];
        payload.members = payload.members || [];
        replaceAll(payload, '✅ Datos importados');
      } catch (_) { toast('⚠️ El archivo no es una copia válida'); }
    };
    reader.readAsText(file);
    ev.target.value = '';
  }

  // ---------------------------------------------------------------- datos de ejemplo
  function loadDemo() {
    const d = emptyData();
    d.settings.initialBalance = 1500;
    d.members = [{ id: 'mama', name: 'Mamá', monthly: 1200, sort: 0 }, { id: 'papa', name: 'Papá', monthly: 1200, sort: 1 }];
    const budgets = { super: 550, cenas: 150, ninos: 120, ocio: 150, transporte: 220 };
    d.categories.forEach((c) => { c.budget = budgets[c.id] || 0; });
    let seed = 7;
    const rnd = () => { seed = (seed * 16807) % 2147483647; return (seed - 1) / 2147483646; };
    const between = (a, b) => round2(a + rnd() * (b - a));
    const pick = (arr) => arr[Math.floor(rnd() * arr.length)];
    const today = new Date();
    const curMonth = periodKey('month', today.getFullYear(), today.getMonth());
    const add = (y, m, day, cat, amount, note = '', personalChance = 0) => {
      const date = new Date(y, m, Math.min(day, new Date(y, m + 1, 0).getDate()));
      if (date > today) return;
      const iso = toISO(date);
      const paidBy = rnd() < personalChance ? pick(['mama', 'papa']) : '';
      d.expenses.push({ id: uid(), amount, categoryId: cat, date: iso, note, paidBy, reimbursed: Boolean(paidBy) && !iso.startsWith(curMonth) && rnd() > 0.25, createdAt: date.getTime() + Math.floor(rnd() * 1e6) });
    };
    const income = (y, m, day, memberId, amount, note) => {
      const date = new Date(y, m, day);
      if (date > today) return;
      d.incomes.push({ id: uid(), amount, memberId, date: toISO(date), note, createdAt: date.getTime() });
    };
    for (let i = 7; i >= 0; i--) {
      const ref = new Date(today.getFullYear(), today.getMonth() - i, 1);
      const y = ref.getFullYear(); const m = ref.getMonth();
      const winter = [0, 1, 2, 10, 11].includes(m);
      income(y, m, 1, 'mama', 1200, 'Aportación mensual');
      income(y, m, 1, 'papa', 1200, 'Aportación mensual');
      if (m === 5 || m === 11) income(y, m, 20, 'papa', 300, 'Extra paga');
      add(y, m, 1, 'hipoteca', 780, 'Cuota hipoteca');
      add(y, m, 5, 'internet', 62.9, 'Fibra + móviles');
      add(y, m, 8, 'luz', between(winter ? 85 : 55, winter ? 135 : 90), 'Factura luz');
      if (m % 2 === 0) add(y, m, 12, 'agua', between(38, 56), 'Factura bimestral');
      if (winter) add(y, m, 15, 'gas', between(70, 120), 'Gas natural');
      if (m === 0 || m === 6) add(y, m, 3, 'seguros', 312.4, 'Seguro hogar + coche');
      if (m !== 6 && m !== 7) { add(y, m, 2, 'colegio', 185, 'Comedor escolar'); add(y, m, 4, 'extraescolares', 65, 'Fútbol + inglés'); }
      if (m === 8) add(y, m, 6, 'colegio', 236.5, 'Libros y material', 0.6);
      if (m === 7) add(y, m, 10, 'ocio', between(450, 700), 'Vacaciones', 0.5);
      [3, 9, 14, 20, 26].forEach((day) => add(y, m, day + Math.floor(rnd() * 2), 'super', between(60, 150), pick(['Mercadona', 'Lidl', 'Carrefour', 'Frutería', 'Compra semanal']), 0.15));
      for (let k = 0; k < 3; k++) add(y, m, 6 + k * 9, 'cenas', between(28, 85), pick(['Pizzería', 'Cena con amigos', 'Sushi', 'Hamburguesas', 'Menú del día']), 0.4);
      for (let k = 0; k < 2; k++) add(y, m, 10 + k * 11, 'ninos', between(12, 60), pick(['Cumpleaños', 'Juguete', 'Excursión', 'Material manualidades']), 0.4);
      for (let k = 0; k < 3; k++) add(y, m, 7 + k * 8, 'transporte', between(45, 70), pick(['Gasolina', 'Gasolina', 'Parking', 'Abono transporte']), 0.3);
      if (rnd() > 0.4) add(y, m, 17, 'salud', between(12, 60), pick(['Farmacia', 'Dentista', 'Óptica']), 0.5);
      if (rnd() > 0.3) add(y, m, 19, 'ropa', between(25, 120), pick(['Ropa niños', 'Zapatillas', 'Abrigo']), 0.5);
      add(y, m, 22, 'ocio', between(20, 90), pick(['Cine', 'Parque de atracciones', 'Museo', 'Escapada']), 0.3);
      if (rnd() > 0.5) add(y, m, 24, 'mascotas', between(18, 45), pick(['Pienso', 'Veterinario']));
    }
    ui.year = today.getFullYear(); ui.month = today.getMonth(); ui.mode = 'month';
    replaceAll(toApi(d), '✨ Datos de ejemplo cargados');
  }

  // ---------------------------------------------------------------- toast
  let toastTimer;
  function toast(msg, actionLabel, action) {
    const el = $('#toast');
    el.innerHTML = `<span>${esc(msg)}</span>${actionLabel ? `<button>${esc(actionLabel)}</button>` : ''}`;
    if (actionLabel) $('button', el).onclick = () => { action(); el.classList.remove('show'); };
    el.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.remove('show'), actionLabel ? 5000 : 2800);
  }

  // ---------------------------------------------------------------- arranque
  $$('.tab').forEach((t) => t.addEventListener('click', () => { ui.filterCat = ''; ui.filterType = 'all'; goto(t.dataset.view); }));
  $('#fab-add').addEventListener('click', () => {
    if (ui.view === 'cuenta') return openIncomeForm();
    if (ui.view === 'movimientos' && ui.filterType === 'income') return openIncomeForm();
    openExpenseForm(null, ui.view === 'movimientos' ? ui.filterCat : '');
  });
  // al volver a la app, traer los cambios del resto de la familia
  document.addEventListener('visibilitychange', () => { if (!document.hidden && signedIn) refresh({ quiet: true }); });

  // mensajes al volver del login de Google
  const params = new URLSearchParams(location.search);
  const LOGIN_ERRORS = {
    not_allowed: `La cuenta ${params.get('email') || ''} no tiene acceso. Pide a alguien de la familia que te añada como miembro con este email.`,
    cancelled: 'Has cancelado el inicio de sesión.',
    state: 'La sesión de inicio ha caducado. Vuelve a intentarlo.',
    failed: 'No se ha podido iniciar sesión con Google. Vuelve a intentarlo.',
  };
  if (params.get('login_error')) {
    loginMessage = LOGIN_ERRORS[params.get('login_error')] || LOGIN_ERRORS.failed;
    history.replaceState(null, '', location.pathname);
  }

  render();
  refresh();

  if ('serviceWorker' in navigator && location.protocol.startsWith('http')) {
    window.addEventListener('load', () => navigator.serviceWorker.register('sw.js').catch(() => {}));
  }
})();
