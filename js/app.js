/* Gastos de Casa — gestor de gastos familiares.
 * App sin dependencias: los datos se guardan en el navegador (localStorage).
 */
(() => {
  'use strict';

  // ---------------------------------------------------------------- utilidades
  const STORAGE_KEY = 'homeaccounts.v1';
  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  const pad = (n) => String(n).padStart(2, '0');
  const toISO = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const todayISO = () => toISO(new Date());
  const parseISO = (s) => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); };
  const round2 = (n) => Math.round(n * 100) / 100;

  const MONTHS = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
  const MONTHS_SHORT = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];

  const DEFAULT_CATEGORIES = [
    { id: 'hipoteca', name: 'Casa / Hipoteca', icon: '🏠', color: '#64748b', group: 'Hogar' },
    { id: 'luz', name: 'Luz', icon: '💡', color: '#eab308', group: 'Hogar' },
    { id: 'agua', name: 'Agua', icon: '💧', color: '#0ea5e9', group: 'Hogar' },
    { id: 'gas', name: 'Gas / Calefacción', icon: '🔥', color: '#f97316', group: 'Hogar' },
    { id: 'internet', name: 'Internet y móvil', icon: '📶', color: '#8b5cf6', group: 'Hogar' },
    { id: 'seguros', name: 'Seguros', icon: '🛡️', color: '#0f766e', group: 'Hogar' },
    { id: 'super', name: 'Supermercado', icon: '🛒', color: '#16a34a', group: 'Alimentación' },
    { id: 'cenas', name: 'Cenas fuera', icon: '🍽️', color: '#e11d48', group: 'Alimentación' },
    { id: 'colegio', name: 'Colegio', icon: '🎒', color: '#2563eb', group: 'Niños' },
    { id: 'ninos', name: 'Gastos niños', icon: '🧸', color: '#f59e0b', group: 'Niños' },
    { id: 'extraescolares', name: 'Extraescolares', icon: '⚽', color: '#65a30d', group: 'Niños' },
    { id: 'transporte', name: 'Coche y transporte', icon: '🚗', color: '#14b8a6', group: 'Transporte' },
    { id: 'salud', name: 'Salud', icon: '💊', color: '#ec4899', group: 'Personal' },
    { id: 'ropa', name: 'Ropa', icon: '👕', color: '#c026d3', group: 'Personal' },
    { id: 'ocio', name: 'Ocio y viajes', icon: '🎬', color: '#7c3aed', group: 'Personal' },
    { id: 'mascotas', name: 'Mascotas', icon: '🐾', color: '#a16207', group: 'Otros' },
    { id: 'otros', name: 'Otros', icon: '📦', color: '#78716c', group: 'Otros' },
  ];

  const EMOJIS = ('🏠 💡 💧 🔥 📶 📱 🛡️ 🛒 🍽️ 🍕 ☕ 🥖 🍷 🎒 📚 ✏️ 🧸 👶 🍼 ⚽ 🎨 🎹 🩰 🚗 ⛽ 🚌 🚆 🅿️ ✈️ 💊 🦷 👓 🏥 👕 👟 💇 🎬 🎮 🎁 🎉 🏖️ 🏕️ 🐾 🐶 🐱 🧹 🧺 🔧 🛋️ 🌱 💻 📺 🎵 💳 🏦 💶 🧾 📦 ❤️ ⭐').split(' ');
  const COLORS = ['#2563eb', '#0ea5e9', '#14b8a6', '#16a34a', '#65a30d', '#eab308', '#f59e0b', '#f97316', '#e11d48', '#ec4899', '#c026d3', '#7c3aed', '#8b5cf6', '#0f766e', '#64748b', '#a16207', '#78716c'];
  const CURRENCIES = [['EUR', 'Euro (€)'], ['USD', 'Dólar ($)'], ['GBP', 'Libra (£)'], ['MXN', 'Peso mexicano'], ['ARS', 'Peso argentino'], ['COP', 'Peso colombiano'], ['CLP', 'Peso chileno']];

  // ---------------------------------------------------------------- datos
  function defaults() {
    return {
      version: 1,
      currency: 'EUR',
      members: [],
      categories: DEFAULT_CATEGORIES.map((c) => ({ ...c, budget: 0 })),
      expenses: [],
    };
  }

  function normalize(d) {
    const base = defaults();
    if (!d || typeof d !== 'object') return base;
    return {
      version: 1,
      currency: typeof d.currency === 'string' ? d.currency : base.currency,
      members: Array.isArray(d.members) ? d.members.filter((m) => typeof m === 'string') : [],
      categories: Array.isArray(d.categories) && d.categories.length ? d.categories.map((c) => ({
        id: String(c.id || uid()), name: String(c.name || 'Sin nombre'), icon: String(c.icon || '📦'),
        color: String(c.color || '#78716c'), group: String(c.group || 'Otros'), budget: Number(c.budget) || 0,
      })) : base.categories,
      expenses: Array.isArray(d.expenses) ? d.expenses.filter((e) => e && /^\d{4}-\d{2}-\d{2}$/.test(e.date) && Number(e.amount) > 0).map((e) => ({
        id: String(e.id || uid()), amount: round2(Number(e.amount)), categoryId: String(e.categoryId), date: e.date,
        note: String(e.note || ''), member: String(e.member || ''), createdAt: Number(e.createdAt) || Date.now(),
      })) : [],
    };
  }

  function load() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) return normalize(JSON.parse(raw));
    } catch (_) { /* almacenamiento no disponible */ }
    return defaults();
  }

  function save() {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(data)); }
    catch (_) { toast('⚠️ No se han podido guardar los datos en este navegador'); }
  }

  let data = load();

  const now = new Date();
  const ui = {
    view: 'resumen',
    mode: 'month', // 'month' | 'year'
    year: now.getFullYear(),
    month: now.getMonth(),
    filterCat: '',
    search: '',
  };
  try { const v = localStorage.getItem(STORAGE_KEY + ':view'); if (v) ui.view = v; } catch (_) {}

  const catById = (id) => data.categories.find((c) => c.id === id) || { id, name: 'Sin categoría', icon: '❔', color: '#78716c', group: 'Otros', budget: 0 };

  function money(n, opts = {}) {
    try {
      return new Intl.NumberFormat('es-ES', { style: 'currency', currency: data.currency, maximumFractionDigits: opts.noCents ? 0 : 2, minimumFractionDigits: opts.noCents ? 0 : 2 }).format(n);
    } catch (_) { return n.toFixed(2) + ' ' + data.currency; }
  }
  function compact(n) {
    if (n >= 10000) return Math.round(n / 1000) + 'k';
    if (n >= 1000) return (n / 1000).toFixed(1).replace('.', ',') + 'k';
    return String(Math.round(n));
  }
  function currencySymbol() {
    try {
      const p = new Intl.NumberFormat('es-ES', { style: 'currency', currency: data.currency }).formatToParts(0);
      return (p.find((x) => x.type === 'currency') || {}).value || data.currency;
    } catch (_) { return data.currency; }
  }

  // ---------------------------------------------------------------- periodos
  const periodKey = (mode = ui.mode, y = ui.year, m = ui.month) => (mode === 'month' ? `${y}-${pad(m + 1)}` : `${y}`);
  const inPeriod = (key) => data.expenses.filter((e) => e.date.startsWith(key));
  const sum = (list) => round2(list.reduce((a, e) => a + e.amount, 0));
  function periodLabel() {
    return ui.mode === 'month' ? `${MONTHS[ui.month]} ${ui.year}` : `Año ${ui.year}`;
  }
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
    else {
      const d = new Date(ui.year, ui.month + delta, 1);
      ui.year = d.getFullYear(); ui.month = d.getMonth();
    }
    render();
  }

  function periodSelector() {
    return `
      <div class="period">
        <div class="seg" role="tablist">
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
  function bindPeriod(root) {
    $$('[data-mode]', root).forEach((b) => b.addEventListener('click', () => { ui.mode = b.dataset.mode; render(); }));
    $$('[data-shift]', root).forEach((b) => b.addEventListener('click', () => shiftPeriod(Number(b.dataset.shift))));
  }

  // ---------------------------------------------------------------- vistas
  const TITLES = { resumen: 'Resumen', movimientos: 'Gastos', categorias: 'Categorías', ajustes: 'Ajustes' };
  const main = $('#main');

  function render() {
    $('#view-title').textContent = TITLES[ui.view];
    $$('.tab').forEach((t) => t.classList.toggle('on', t.dataset.view === ui.view));
    ({ resumen: renderSummary, movimientos: renderMovements, categorias: renderCategories, ajustes: renderSettings })[ui.view]();
  }

  function goto(view) {
    ui.view = view;
    try { localStorage.setItem(STORAGE_KEY + ':view', view); } catch (_) {}
    render();
    window.scrollTo({ top: 0 });
  }

  // ---------- Resumen
  function renderSummary() {
    const key = periodKey();
    const list = inPeriod(key);
    const total = sum(list);
    const prevTotal = sum(inPeriod(prevPeriodKey()));
    const months = ui.mode === 'year' ? 12 : 1;

    if (!data.expenses.length) {
      main.innerHTML = `
        <div class="card empty">
          <div class="big">👋</div>
          <h3>¡Bienvenidos!</h3>
          <p>Empieza a apuntar los gastos de casa con el botón <b>+</b>.<br>Verás aquí cuánto gastáis y en qué.</p>
          <div class="btn-row">
            <button class="btn primary" data-act="add">➕ Añadir primer gasto</button>
            <button class="btn" data-act="demo">✨ Ver con datos de ejemplo</button>
          </div>
        </div>`;
      $('[data-act=add]', main).onclick = () => openExpenseForm();
      $('[data-act=demo]', main).onclick = loadDemo;
      return;
    }

    // por categoría
    const byCat = new Map();
    list.forEach((e) => byCat.set(e.categoryId, (byCat.get(e.categoryId) || 0) + e.amount));
    const catRows = data.categories
      .map((c) => ({ c, total: round2(byCat.get(c.id) || 0), budget: (c.budget || 0) * months }))
      .concat([...byCat.keys()].filter((id) => !data.categories.some((c) => c.id === id)).map((id) => ({ c: catById(id), total: round2(byCat.get(id)), budget: 0 })))
      .filter((r) => r.total > 0 || r.budget > 0)
      .sort((a, b) => b.total - a.total);

    // por grupo
    const byGroup = new Map();
    catRows.forEach((r) => {
      const g = byGroup.get(r.c.group) || { name: r.c.group, total: 0, icons: [] };
      g.total += r.total; if (r.total > 0) g.icons.push(r.c.icon);
      byGroup.set(r.c.group, g);
    });
    const groups = [...byGroup.values()].filter((g) => g.total > 0).sort((a, b) => b.total - a.total);

    const totalBudget = data.categories.reduce((a, c) => a + (c.budget || 0), 0) * months;
    const delta = prevTotal > 0 ? ((total - prevTotal) / prevTotal) * 100 : null;
    let daysElapsed;
    if (ui.mode === 'month') {
      const dim = new Date(ui.year, ui.month + 1, 0).getDate();
      daysElapsed = isCurrentPeriod() ? new Date().getDate() : dim;
    } else {
      const start = new Date(ui.year, 0, 1);
      const end = isCurrentPeriod() ? new Date() : new Date(ui.year, 11, 31);
      daysElapsed = Math.round((end - start) / 864e5) + 1;
    }

    const donutSegs = donutData(catRows.filter((r) => r.total > 0), total);

    main.innerHTML = `
      ${periodSelector()}
      <section class="hero">
        <div class="label">Total gastado · ${esc(periodLabel())}</div>
        <div class="total">${money(total)}</div>
        <div class="hero-stats">
          <div><b>${list.length}</b><span>movimientos</span></div>
          <div><b>${money(total / Math.max(1, daysElapsed), { noCents: total / daysElapsed >= 100 })}</b><span>media al día</span></div>
          <div><b>${delta === null ? '—' : `${delta > 0 ? '▲' : '▼'} ${Math.abs(delta).toFixed(0)}%`}</b><span>vs ${ui.mode === 'month' ? 'mes' : 'año'} anterior</span></div>
        </div>
        ${totalBudget > 0 ? `
          <div class="budget-bar">
            <div class="track"><div class="fill ${total > totalBudget ? 'over' : ''}" style="width:${Math.min(100, (total / totalBudget) * 100)}%"></div></div>
            <div class="meta"><span>Presupuesto ${money(totalBudget, { noCents: true })}</span><span>${total > totalBudget ? `Te pasas ${money(total - totalBudget, { noCents: true })}` : `Quedan ${money(totalBudget - total, { noCents: true })}`}</span></div>
          </div>` : ''}
      </section>

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
              ${donutSegs.map((s) => `<circle cx="21" cy="21" r="15.915" stroke="${s.color}" stroke-dasharray="${s.len} ${100 - s.len}" stroke-dashoffset="${-s.offset}"><title>${esc(s.name)}: ${money(s.total)}</title></circle>`).join('')}
            </svg>
            <div class="donut-center"><span>Total</span><b>${money(total, { noCents: true })}</b></div>
          </div>
          <ul class="legend">
            ${donutSegs.map((s) => `<li><span class="dot" style="background:${s.color}"></span><span>${s.icon} ${esc(s.name)}</span><span class="pct">${s.pct.toFixed(0)}%</span></li>`).join('')}
          </ul>
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
        <h2>Últimos gastos <button class="link-btn" data-goto="movimientos">Ver todos</button></h2>
        ${list.length ? `<div class="rows">${[...list].sort(sortExpenses).slice(0, 5).map(expenseRow).join('')}</div>` : '<p class="muted">Todavía no hay gastos en este periodo.</p>'}
      </section>
    `;

    bindPeriod(main);
    $$('[data-cat]', main).forEach((b) => b.addEventListener('click', () => { ui.filterCat = b.dataset.cat; goto('movimientos'); }));
    $$('[data-goto]', main).forEach((b) => b.addEventListener('click', () => { ui.filterCat = ''; goto(b.dataset.goto); }));
    bindExpenseRows(main);
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

  function trendChart() {
    const cols = [];
    if (ui.mode === 'month') {
      for (let i = 5; i >= 0; i--) {
        const d = new Date(ui.year, ui.month - i, 1);
        cols.push({ key: periodKey('month', d.getFullYear(), d.getMonth()), label: MONTHS_SHORT[d.getMonth()], on: i === 0, y: d.getFullYear(), m: d.getMonth() });
      }
    } else {
      for (let m = 0; m < 12; m++) cols.push({ key: periodKey('month', ui.year, m), label: MONTHS_SHORT[m].slice(0, 1), on: false, y: ui.year, m });
    }
    cols.forEach((c) => { c.total = sum(inPeriod(c.key)); });
    const max = Math.max(1, ...cols.map((c) => c.total));
    return `<div class="trend">${cols.map((c) => `
      <div class="col ${c.on ? 'on' : ''}" title="${MONTHS[c.m]} ${c.y}: ${money(c.total)}">
        <span class="val">${c.total ? compact(c.total) : ''}</span>
        <span class="b" style="height:${(c.total / max) * 100}%"></span>
        <span class="m">${c.label}</span>
      </div>`).join('')}</div>`;
  }

  // ---------- Movimientos
  const sortExpenses = (a, b) => (a.date === b.date ? b.createdAt - a.createdAt : a.date < b.date ? 1 : -1);

  function expenseRow(e) {
    const c = catById(e.categoryId);
    const sub = [e.note, e.member].filter(Boolean).join(' · ') || c.group;
    return `
      <button class="row" data-exp="${esc(e.id)}" style="--c:${c.color}">
        <span class="cat-icon sm">${c.icon}</span>
        <span class="row-main">
          <span class="row-top"><span class="row-title">${esc(c.name)}</span><span class="amount">${money(e.amount)}</span></span>
          <span class="row-sub">${esc(sub)}</span>
        </span>
      </button>`;
  }
  function bindExpenseRows(root) {
    $$('[data-exp]', root).forEach((b) => b.addEventListener('click', () => {
      const e = data.expenses.find((x) => x.id === b.dataset.exp);
      if (e) openExpenseForm(e);
    }));
  }

  function renderMovements() {
    const q = ui.search.trim().toLowerCase();
    let list = inPeriod(periodKey());
    const usedCats = new Set(list.map((e) => e.categoryId));
    if (ui.filterCat) list = list.filter((e) => e.categoryId === ui.filterCat);
    if (q) {
      list = list.filter((e) => {
        const c = catById(e.categoryId);
        return [e.note, e.member, c.name, c.group, String(e.amount).replace('.', ',')].join(' ').toLowerCase().includes(q);
      });
    }
    list.sort(sortExpenses);

    const days = new Map();
    list.forEach((e) => { if (!days.has(e.date)) days.set(e.date, []); days.get(e.date).push(e); });

    const chipCats = data.categories.filter((c) => usedCats.has(c.id) || c.id === ui.filterCat);
    const filterCat = ui.filterCat ? catById(ui.filterCat) : null;

    main.innerHTML = `
      ${periodSelector()}
      <div class="toolbar">
        <input class="search" type="search" placeholder="Buscar por nota, persona, categoría…" value="${esc(ui.search)}" aria-label="Buscar">
        <div class="chips">
          <button class="chip ${!ui.filterCat ? 'on' : ''}" data-filter="">Todas</button>
          ${chipCats.map((c) => `<button class="chip ${ui.filterCat === c.id ? 'on' : ''}" data-filter="${esc(c.id)}">${c.icon} ${esc(c.name)}</button>`).join('')}
        </div>
      </div>
      ${(ui.filterCat || q) && list.length ? `<div class="filter-total"><span>${filterCat ? `${filterCat.icon} ${esc(filterCat.name)}` : 'Resultados'} · ${list.length}</span><span>${money(sum(list))}</span></div>` : ''}
      <div id="mov-list">
        ${list.length ? [...days.entries()].map(([date, items]) => `
          <div class="day-head"><span>${esc(dayLabel(date))}</span><span>${money(sum(items))}</span></div>
          <div class="card" style="padding:6px 10px"><div class="rows">${items.map(expenseRow).join('')}</div></div>
        `).join('') : `
          <div class="card empty">
            <div class="big">🧾</div>
            <h3>Sin gastos</h3>
            <p>${q || ui.filterCat ? 'No hay resultados con estos filtros.' : 'No hay gastos en este periodo.'}</p>
            <button class="btn primary" data-act="add">➕ Añadir gasto</button>
          </div>`}
      </div>`;

    bindPeriod(main);
    const search = $('.search', main);
    search.addEventListener('input', () => {
      ui.search = search.value;
      const pos = search.selectionStart;
      renderMovements();
      const s = $('.search', main); s.focus(); try { s.setSelectionRange(pos, pos); } catch (_) {}
    });
    $$('[data-filter]', main).forEach((b) => b.addEventListener('click', () => { ui.filterCat = b.dataset.filter; renderMovements(); }));
    const add = $('[data-act=add]', main); if (add) add.onclick = () => openExpenseForm(null, ui.filterCat);
    bindExpenseRows(main);
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
    const monthKey = periodKey('month', now.getFullYear(), now.getMonth());
    const monthList = inPeriod(monthKey);
    const groups = new Map();
    data.categories.forEach((c) => { if (!groups.has(c.group)) groups.set(c.group, []); groups.get(c.group).push(c); });

    main.innerHTML = `
      <p class="muted" style="margin:0 0 14px">Organiza tus categorías en grupos, elige su icono y color, y ponles un presupuesto mensual si quieres controlar cuánto gastáis.</p>
      ${[...groups.entries()].map(([g, cats]) => `
        <div class="day-head"><span>${esc(g)}</span><span>${money(sum(monthList.filter((e) => cats.some((c) => c.id === e.categoryId))), { noCents: true })} este mes</span></div>
        <div class="card" style="padding:6px 10px"><div class="rows">
          ${cats.map((c) => {
            const t = sum(monthList.filter((e) => e.categoryId === c.id));
            return `
            <button class="row" data-edit-cat="${esc(c.id)}" style="--c:${c.color}">
              <span class="cat-icon">${c.icon}</span>
              <span class="row-main">
                <span class="row-top"><span class="row-title">${esc(c.name)}</span><span class="amount">${money(t)}</span></span>
                <span class="row-sub">${c.budget ? `Presupuesto: ${money(c.budget, { noCents: true })}/mes` : 'Sin presupuesto'}</span>
              </span>
            </button>`;
          }).join('')}
        </div></div>`).join('')}
      <button class="btn primary block" data-act="new-cat">➕ Nueva categoría</button>`;

    $$('[data-edit-cat]', main).forEach((b) => b.addEventListener('click', () => openCategoryForm(data.categories.find((c) => c.id === b.dataset.editCat))));
    $('[data-act=new-cat]', main).onclick = () => openCategoryForm();
  }

  // ---------- Ajustes
  function renderSettings() {
    main.innerHTML = `
      <section class="card">
        <h2>👨‍👩‍👧‍👦 Familia</h2>
        <p class="muted" style="margin-top:-6px">Añade quién hace los gastos para saber quién ha pagado cada cosa (opcional).</p>
        <div class="members">
          ${data.members.map((m, i) => `<span class="member">${esc(m)} <button data-del-member="${i}" aria-label="Quitar ${esc(m)}">×</button></span>`).join('') || '<span class="faint">Aún no hay miembros.</span>'}
        </div>
        <form class="inline-form" id="member-form">
          <input class="input" name="name" placeholder="Ej.: Mamá, Papá, Lucía…" maxlength="24" autocomplete="off">
          <button class="btn primary" type="submit">Añadir</button>
        </form>
      </section>

      <section class="card">
        <h2>⚙️ Preferencias</h2>
        <div class="setting">
          <div><div class="s-title">Moneda</div></div>
          <select class="input" id="currency" style="width:auto">
            ${CURRENCIES.map(([code, name]) => `<option value="${code}" ${data.currency === code ? 'selected' : ''}>${name}</option>`).join('')}
          </select>
        </div>
      </section>

      <section class="card">
        <h2>💾 Tus datos</h2>
        <p class="muted" style="margin-top:-6px">Los datos se guardan en este dispositivo. Haz copias de seguridad de vez en cuando y úsalas para pasar los datos a otro móvil.</p>
        <div class="setting">
          <div><div class="s-title">Copia de seguridad</div><div class="s-sub">${data.expenses.length} gastos · ${data.categories.length} categorías</div></div>
          <button class="btn" data-act="export">⬇️ Exportar</button>
        </div>
        <div class="setting">
          <div><div class="s-title">Restaurar copia</div><div class="s-sub">Sustituye los datos actuales</div></div>
          <label class="btn">⬆️ Importar<input type="file" accept="application/json,.json" id="import-file" hidden></label>
        </div>
        <div class="setting">
          <div><div class="s-title">Exportar a Excel</div><div class="s-sub">Archivo CSV con todos los gastos</div></div>
          <button class="btn" data-act="csv">📊 CSV</button>
        </div>
        <div class="setting">
          <div><div class="s-title">Datos de ejemplo</div><div class="s-sub">Para probar la app (borra los actuales)</div></div>
          <button class="btn" data-act="demo">✨ Cargar</button>
        </div>
        <div class="setting">
          <div><div class="s-title">Borrar todo</div><div class="s-sub">Empieza de cero</div></div>
          <button class="btn danger" data-act="reset">🗑️ Borrar</button>
        </div>
      </section>
      <p class="faint" style="text-align:center;font-size:12px">Gastos de Casa · funciona sin conexión</p>`;

    $('#member-form').addEventListener('submit', (ev) => {
      ev.preventDefault();
      const name = ev.target.name.value.trim();
      if (!name) return;
      if (data.members.some((m) => m.toLowerCase() === name.toLowerCase())) return toast('Ya existe');
      data.members.push(name); save(); renderSettings();
    });
    $$('[data-del-member]', main).forEach((b) => b.addEventListener('click', () => {
      data.members.splice(Number(b.dataset.delMember), 1); save(); renderSettings();
    }));
    $('#currency').addEventListener('change', (ev) => { data.currency = ev.target.value; save(); toast('Moneda actualizada'); });
    $('[data-act=export]', main).onclick = exportJSON;
    $('[data-act=csv]', main).onclick = exportCSV;
    $('#import-file').addEventListener('change', importJSON);
    $('[data-act=demo]', main).onclick = () => {
      if (data.expenses.length && !confirm('Se borrarán tus gastos actuales y se cargarán datos de ejemplo. ¿Continuar?')) return;
      loadDemo();
    };
    $('[data-act=reset]', main).onclick = () => {
      if (!confirm('¿Seguro que quieres borrar todos los gastos y categorías? Esta acción no se puede deshacer.')) return;
      data = defaults(); save(); toast('Datos borrados'); goto('resumen');
    };
  }

  // ---------------------------------------------------------------- formularios (hoja inferior)
  const sheetRoot = $('#sheet-root');
  const sheetBody = $('#sheet-body');
  let lastFocus = null;

  function openSheet(html, onMount) {
    lastFocus = document.activeElement;
    sheetBody.innerHTML = html;
    sheetRoot.hidden = false;
    document.body.style.overflow = 'hidden';
    onMount && onMount(sheetBody);
  }
  function closeSheet() {
    sheetRoot.hidden = true;
    sheetBody.innerHTML = '';
    document.body.style.overflow = '';
    if (lastFocus && lastFocus.focus) lastFocus.focus();
  }
  sheetRoot.addEventListener('click', (e) => { if (e.target.closest('[data-close]')) closeSheet(); });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !sheetRoot.hidden) closeSheet(); });

  function lastCategoryId() {
    const last = [...data.expenses].sort((a, b) => b.createdAt - a.createdAt)[0];
    return last ? last.categoryId : '';
  }

  function openExpenseForm(exp = null, presetCat = '') {
    const editing = Boolean(exp);
    let catId = exp ? exp.categoryId : presetCat || '';
    let member = exp ? exp.member : (data.members.length === 1 ? data.members[0] : (() => { try { return localStorage.getItem(STORAGE_KEY + ':member') || ''; } catch (_) { return ''; } })());
    if (member && !data.members.includes(member) && !editing) member = '';
    const suggested = lastCategoryId();

    openSheet(`
      <h2 id="sheet-title">${editing ? 'Editar gasto' : 'Nuevo gasto'}</h2>
      <form id="exp-form" autocomplete="off">
        <div class="amount-input">
          <input id="f-amount" inputmode="decimal" placeholder="0,00" value="${exp ? String(exp.amount).replace('.', ',') : ''}" aria-label="Importe" required>
          <span class="cur">${esc(currencySymbol())}</span>
        </div>
        <div class="field">
          <span class="field-label">Categoría</span>
          <div class="cat-grid">
            ${data.categories.map((c) => `
              <button type="button" class="cat-pick ${catId === c.id ? 'on' : ''}" data-pick="${esc(c.id)}" style="--c:${c.color}">
                <span class="cat-icon">${c.icon}</span><span>${esc(c.name)}</span>
              </button>`).join('')}
          </div>
        </div>
        <div class="two">
          <div class="field">
            <label for="f-date">Fecha</label>
            <input class="input" type="date" id="f-date" value="${exp ? exp.date : todayISO()}" required>
          </div>
          <div class="field">
            <label for="f-note">Nota</label>
            <input class="input" id="f-note" placeholder="Opcional" maxlength="80" value="${esc(exp ? exp.note : '')}">
          </div>
        </div>
        ${data.members.length ? `
        <div class="field">
          <span class="field-label">¿Quién ha pagado?</span>
          <div class="chips" style="flex-wrap:wrap">
            ${data.members.map((m) => `<button type="button" class="chip ${member === m ? 'on' : ''}" data-member="${esc(m)}">${esc(m)}</button>`).join('')}
          </div>
        </div>` : ''}
        <div class="btn-row" style="margin-top:6px">
          ${editing ? '<button type="button" class="btn danger" data-act="delete">🗑️ Borrar</button>' : '<button type="button" class="btn" data-close>Cancelar</button>'}
          <button type="submit" class="btn primary">${editing ? 'Guardar cambios' : 'Añadir gasto'}</button>
        </div>
      </form>`, (root) => {
      const amount = $('#f-amount', root);
      setTimeout(() => amount.focus(), 60);
      amount.addEventListener('input', () => { amount.value = amount.value.replace(/[^\d.,]/g, ''); });

      // si no hay categoría elegida, sugerimos la última usada visualmente
      if (!catId && suggested) {
        const b = $(`[data-pick="${CSS.escape(suggested)}"]`, root);
        if (b) b.style.order = '-1';
      }
      $$('[data-pick]', root).forEach((b) => b.addEventListener('click', () => {
        catId = b.dataset.pick;
        $$('[data-pick]', root).forEach((x) => x.classList.toggle('on', x === b));
      }));
      $$('[data-member]', root).forEach((b) => b.addEventListener('click', () => {
        member = member === b.dataset.member ? '' : b.dataset.member;
        $$('[data-member]', root).forEach((x) => x.classList.toggle('on', x.dataset.member === member));
      }));
      const del = $('[data-act=delete]', root);
      if (del) del.onclick = () => {
        const idx = data.expenses.findIndex((x) => x.id === exp.id);
        if (idx < 0) return;
        const [removed] = data.expenses.splice(idx, 1);
        save(); closeSheet(); render();
        toast('Gasto borrado', 'Deshacer', () => { data.expenses.push(removed); save(); render(); });
      };

      $('#exp-form', root).addEventListener('submit', (ev) => {
        ev.preventDefault();
        const value = round2(parseFloat(amount.value.replace(/\.(?=\d{3}(\D|$))/g, '').replace(',', '.')));
        if (!(value > 0)) { amount.focus(); return toast('Escribe un importe'); }
        if (!catId) return toast('Elige una categoría');
        const date = $('#f-date', root).value || todayISO();
        const note = $('#f-note', root).value.trim();
        if (editing) {
          Object.assign(exp, { amount: value, categoryId: catId, date, note, member });
        } else {
          data.expenses.push({ id: uid(), amount: value, categoryId: catId, date, note, member, createdAt: Date.now() });
        }
        try { if (member) localStorage.setItem(STORAGE_KEY + ':member', member); } catch (_) {}
        save(); closeSheet();
        // llevar la vista al periodo del gasto
        const d = parseISO(date);
        if (!editing) { ui.year = d.getFullYear(); ui.month = d.getMonth(); }
        render();
        const c = catById(catId);
        toast(`${c.icon} ${editing ? 'Gasto actualizado' : `${money(value)} en ${c.name}`}`);
      });
    });
  }

  function openCategoryForm(cat = null) {
    const editing = Boolean(cat);
    const state = cat ? { ...cat } : { id: uid(), name: '', icon: '📦', color: COLORS[0], group: 'Otros', budget: 0 };
    const groups = [...new Set(data.categories.map((c) => c.group))];
    const count = editing ? data.expenses.filter((e) => e.categoryId === cat.id).length : 0;

    openSheet(`
      <h2 id="sheet-title">${editing ? 'Editar categoría' : 'Nueva categoría'}</h2>
      <form id="cat-form" autocomplete="off">
        <div class="cat-preview" style="--c:${state.color}">
          <span class="cat-icon" id="pv-icon">${state.icon}</span>
          <div><b id="pv-name">${esc(state.name || 'Nombre de la categoría')}</b><div class="row-sub" id="pv-group">${esc(state.group)}</div></div>
        </div>
        <div class="field">
          <label for="c-name">Nombre</label>
          <input class="input" id="c-name" maxlength="30" required value="${esc(state.name)}" placeholder="Ej.: Comedor escolar">
        </div>
        <div class="two">
          <div class="field">
            <label for="c-group">Grupo</label>
            <input class="input" id="c-group" list="group-list" maxlength="24" value="${esc(state.group)}">
            <datalist id="group-list">${groups.map((g) => `<option value="${esc(g)}">`).join('')}</datalist>
          </div>
          <div class="field">
            <label for="c-budget">Presupuesto / mes</label>
            <input class="input" id="c-budget" inputmode="decimal" placeholder="Sin límite" value="${state.budget ? String(state.budget).replace('.', ',') : ''}">
          </div>
        </div>
        <div class="field">
          <span class="field-label">Icono</span>
          <div class="emoji-grid">${EMOJIS.map((e) => `<button type="button" data-emoji="${e}" class="${e === state.icon ? 'on' : ''}">${e}</button>`).join('')}</div>
        </div>
        <div class="field">
          <span class="field-label">Color</span>
          <div class="swatches">${COLORS.map((c) => `<button type="button" data-color="${c}" class="${c === state.color ? 'on' : ''}" style="--c:${c}" aria-label="Color ${c}"></button>`).join('')}</div>
        </div>
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
        let fallback = data.categories.find((c) => c.id === 'otros' && c.id !== cat.id) || data.categories.find((c) => c.id !== cat.id);
        const msg = count ? `"${cat.name}" tiene ${count} gasto(s). Se moverán a "${fallback.name}". ¿Borrar la categoría?` : `¿Borrar la categoría "${cat.name}"?`;
        if (!confirm(msg)) return;
        data.expenses.forEach((e) => { if (e.categoryId === cat.id) e.categoryId = fallback.id; });
        data.categories = data.categories.filter((c) => c.id !== cat.id);
        if (ui.filterCat === cat.id) ui.filterCat = '';
        save(); closeSheet(); render(); toast('Categoría borrada');
      };
      $('#cat-form', root).addEventListener('submit', (ev) => {
        ev.preventDefault();
        state.name = $('#c-name', root).value.trim();
        if (!state.name) return toast('Ponle un nombre');
        state.group = $('#c-group', root).value.trim() || 'Otros';
        const b = parseFloat($('#c-budget', root).value.replace(',', '.'));
        state.budget = b > 0 ? round2(b) : 0;
        if (editing) Object.assign(cat, state); else data.categories.push(state);
        save(); closeSheet(); render(); toast(`${state.icon} ${editing ? 'Categoría guardada' : 'Categoría creada'}`);
      });
    });
  }

  // ---------------------------------------------------------------- import / export
  function download(name, content, type) {
    const blob = new Blob([content], { type });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = name;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }
  function exportJSON() {
    download(`gastos-casa-${todayISO()}.json`, JSON.stringify(data, null, 2), 'application/json');
    toast('Copia descargada');
  }
  function exportCSV() {
    const q = (s) => `"${String(s).replace(/"/g, '""')}"`;
    const lines = [['Fecha', 'Categoría', 'Grupo', 'Importe', 'Nota', 'Persona'].map(q).join(';')];
    [...data.expenses].sort((a, b) => (a.date < b.date ? -1 : 1)).forEach((e) => {
      const c = catById(e.categoryId);
      lines.push([e.date, c.name, c.group, e.amount.toFixed(2).replace('.', ','), e.note, e.member].map(q).join(';'));
    });
    download(`gastos-casa-${todayISO()}.csv`, '﻿' + lines.join('\r\n'), 'text/csv;charset=utf-8');
    toast('CSV descargado');
  }
  function importJSON(ev) {
    const file = ev.target.files && ev.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const parsed = JSON.parse(reader.result);
        if (!parsed || !Array.isArray(parsed.expenses)) throw new Error('formato');
        const next = normalize(parsed);
        if (!confirm(`Se importarán ${next.expenses.length} gastos y ${next.categories.length} categorías, sustituyendo los datos actuales. ¿Continuar?`)) return;
        data = next; save(); toast('Datos importados'); goto('resumen');
      } catch (_) { toast('⚠️ El archivo no es una copia válida'); }
    };
    reader.readAsText(file);
    ev.target.value = '';
  }

  // ---------------------------------------------------------------- datos de ejemplo
  function loadDemo() {
    const d = defaults();
    d.members = ['Mamá', 'Papá'];
    const budgets = { super: 550, cenas: 150, ninos: 120, ocio: 150, transporte: 220 };
    d.categories.forEach((c) => { c.budget = budgets[c.id] || 0; });
    let seed = 7;
    const rnd = () => { seed = (seed * 16807) % 2147483647; return (seed - 1) / 2147483646; };
    const between = (a, b) => round2(a + rnd() * (b - a));
    const pick = (arr) => arr[Math.floor(rnd() * arr.length)];
    const today = new Date();
    const add = (y, m, day, cat, amount, note = '') => {
      const date = new Date(y, m, Math.min(day, new Date(y, m + 1, 0).getDate()));
      if (date > today) return;
      d.expenses.push({ id: uid(), amount, categoryId: cat, date: toISO(date), note, member: pick(d.members), createdAt: date.getTime() + Math.floor(rnd() * 1e6) });
    };
    for (let i = 7; i >= 0; i--) {
      const ref = new Date(today.getFullYear(), today.getMonth() - i, 1);
      const y = ref.getFullYear(); const m = ref.getMonth();
      const winter = [0, 1, 2, 10, 11].includes(m);
      add(y, m, 1, 'hipoteca', 780, 'Cuota hipoteca');
      add(y, m, 5, 'internet', 62.9, 'Fibra + móviles');
      add(y, m, 8, 'luz', between(winter ? 85 : 55, winter ? 135 : 90), 'Factura luz');
      if (m % 2 === 0) add(y, m, 12, 'agua', between(38, 56), 'Factura bimestral');
      if (winter) add(y, m, 15, 'gas', between(70, 120), 'Gas natural');
      if (m === 0 || m === 6) add(y, m, 3, 'seguros', 312.4, 'Seguro hogar + coche');
      if (m !== 6 && m !== 7) {
        add(y, m, 2, 'colegio', 185, 'Comedor escolar');
        add(y, m, 4, 'extraescolares', 65, 'Fútbol + inglés');
      }
      if (m === 8) add(y, m, 6, 'colegio', 236.5, 'Libros y material');
      [3, 9, 14, 20, 26].forEach((day) => add(y, m, day + Math.floor(rnd() * 2), 'super', between(55, 145), pick(['Mercadona', 'Lidl', 'Carrefour', 'Frutería', 'Compra semanal'])));
      for (let k = 0; k < 3; k++) add(y, m, 6 + k * 9, 'cenas', between(28, 85), pick(['Pizzería', 'Cena con amigos', 'Sushi', 'Hamburguesas', 'Menú del día']));
      for (let k = 0; k < 2; k++) add(y, m, 10 + k * 11, 'ninos', between(12, 60), pick(['Cumpleaños', 'Juguete', 'Excursión', 'Material manualidades']));
      for (let k = 0; k < 3; k++) add(y, m, 7 + k * 8, 'transporte', between(45, 70), pick(['Gasolina', 'Gasolina', 'Parking', 'Abono transporte']));
      if (rnd() > 0.4) add(y, m, 17, 'salud', between(12, 60), pick(['Farmacia', 'Dentista', 'Óptica']));
      if (rnd() > 0.3) add(y, m, 19, 'ropa', between(25, 120), pick(['Ropa niños', 'Zapatillas', 'Abrigo']));
      add(y, m, 22, 'ocio', between(20, 90), pick(['Cine', 'Parque de atracciones', 'Museo', 'Escapada']));
      if (rnd() > 0.5) add(y, m, 24, 'mascotas', between(18, 45), pick(['Pienso', 'Veterinario']));
    }
    data = d; save();
    ui.year = today.getFullYear(); ui.month = today.getMonth(); ui.mode = 'month';
    toast('✨ Datos de ejemplo cargados');
    goto('resumen');
  }

  // ---------------------------------------------------------------- toast
  let toastTimer;
  function toast(msg, actionLabel, action) {
    const el = $('#toast');
    el.innerHTML = `<span>${esc(msg)}</span>${actionLabel ? `<button>${esc(actionLabel)}</button>` : ''}`;
    if (actionLabel) $('button', el).onclick = () => { action(); el.classList.remove('show'); };
    el.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.remove('show'), actionLabel ? 5000 : 2600);
  }

  // ---------------------------------------------------------------- arranque
  $$('.tab').forEach((t) => t.addEventListener('click', () => { if (t.dataset.view !== 'movimientos') ui.filterCat = ''; goto(t.dataset.view); }));
  $('#fab-add').addEventListener('click', () => openExpenseForm(null, ui.view === 'movimientos' ? ui.filterCat : ''));
  window.addEventListener('storage', (e) => { if (e.key === STORAGE_KEY) { data = load(); render(); } });

  render();

  if ('serviceWorker' in navigator && location.protocol.startsWith('http')) {
    window.addEventListener('load', () => navigator.serviceWorker.register('sw.js').catch(() => {}));
  }
})();
