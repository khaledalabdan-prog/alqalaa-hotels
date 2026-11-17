// واجهة نظام حجز الفنادق — سفريات القلعة للسياحة والسفر
'use strict';
try { if (localStorage.getItem('qh_theme') === 'dark') document.documentElement.classList.add('dark'); } catch (e) { }
const $app = document.getElementById('app');
const S = { user: null, company: {}, meta: null, search: null, results: null, filters: { stars: [], boards: [], refundable: false, min: '', max: '', sort: 'price' }, rules: null, timer: null, bk: { q: '', status: '', from: '', to: '', dateType: 'created', user: '', city: '', page: 1 }, openBooking: null };

// ---------- أدوات ----------
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const money = n => (n == null ? '—' : (+n).toFixed(3)) + ' د.ك';
const can = p => !!S.user && (S.user.fixed || S.user.perms.includes(p));
const days = ['الأحد', 'الاثنين', 'الثلاثاء', 'الأربعاء', 'الخميس', 'الجمعة', 'السبت'];
const months = ['يناير', 'فبراير', 'مارس', 'أبريل', 'مايو', 'يونيو', 'يوليو', 'أغسطس', 'سبتمبر', 'أكتوبر', 'نوفمبر', 'ديسمبر'];
const longDate = d => { if (!d) return ''; const x = new Date(d + 'T00:00:00'); return `${days[x.getDay()]} ${x.getDate()} ${months[x.getMonth()]} ${x.getFullYear()}`; };
const shortDate = d => d ? d.split('-').reverse().join('/') : '';
const iso = d => d.toISOString().slice(0, 10);
const addDays = (n, from = new Date()) => { const x = new Date(from); x.setDate(x.getDate() + n); return iso(x); };
const STATUS = { confirmed: ['مؤكد', 'ok'], pending: ['بانتظار الفندق', 'warn'], cancelled: ['ملغي', 'bad'], failed: ['فشل الحجز', 'bad'], processing: ['قيد التنفيذ', 'info'] };
const pill = st => { const [t, c] = STATUS[st] || [st, '']; return `<span class="pill ${c}">${esc(t)}</span>`; };
const starsTxt = n => n ? `<span class="stars">${'★'.repeat(n)}</span> <span class="muted">${n} نجوم</span>` : '';

async function api(url, opts = {}) {
  const res = await fetch(url, { method: opts.method || (opts.body ? 'POST' : 'GET'), headers: opts.body ? { 'Content-Type': 'application/json' } : {}, body: opts.body ? JSON.stringify(opts.body) : undefined, credentials: 'same-origin' });
  const data = await res.json().catch(() => ({}));
  if (res.status === 401 && !url.includes('/login')) { S.user = null; go('login'); throw new Error(data.error || 'سجّل الدخول'); }
  if (res.status === 403 && data.mustChange) { S.user.mustChange = true; go('password'); throw new Error(data.error); }
  if (!res.ok) throw new Error(data.error || 'حدث خطأ');
  return data;
}
function toast(msg, ms = 3500) { const t = document.createElement('div'); t.className = 'toast'; t.textContent = msg; document.body.appendChild(t); setTimeout(() => t.remove(), ms); }
function modal(html, onMount) {
  const m = document.createElement('div'); m.className = 'modal'; m.innerHTML = `<div class="card" role="dialog" aria-modal="true">${html}</div>`;
  m.addEventListener('click', e => { if (e.target === m || e.target.closest('[data-close]')) m.remove(); });
  document.body.appendChild(m); onMount && onMount(m, () => m.remove()); return m;
}
const val = (root, sel) => root.querySelector(sel)?.value?.trim() ?? '';
function busy(btn, on) { if (!btn) return; btn.disabled = on; if (on) { btn.dataset.t = btn.textContent; btn.textContent = '...'; } else if (btn.dataset.t) btn.textContent = btn.dataset.t; }

// ---------- التنقل ----------
const NAV = [
  ['search', 'البحث والحجز', () => can('search')],
  ['bookings', 'الحجوزات والقسائم', () => can('bookings_own') || can('bookings_all')],
  ['suppliers', 'الشركات الموردة و API', () => can('suppliers_view') || can('api_keys')],
  ['hunter', 'فرص التوفير', () => can('rebook')],
  ['accounts', 'الحسابات', () => can('accounts_view') || can('reports') || can('bonus_edit')],
  ['employees', 'الموظفون', () => can('users_view') || can('users_edit') || can('password_reset')],
  ['permissions', 'الصلاحيات', () => can('roles_edit')],
];
function go(r) { if (location.hash !== '#' + r) location.hash = r; else route(); }
window.addEventListener('hashchange', route);
function shell(active, inner) {
  const links = NAV.filter(n => n[2]()).map(n => `<a href="#${n[0]}" class="${n[0] === active ? 'on' : ''}">${n[1]}</a>`).join('');
  $app.innerHTML = `<header class="topbar">
    <div class="brand"><img src="/logo.jpg" alt="شعار سفريات القلعة"><div><b>${esc(S.company.name || 'سفريات القلعة للسياحة والسفر')}</b><small>نظام حجز الفنادق</small></div></div>
    <nav class="nav" aria-label="القائمة الرئيسية">${links}</nav>
    <div class="who"><div><b>${esc(S.user.name)}</b><small>${esc(S.user.role)}</small></div><button class="btn s g theme" id="theme" aria-label="تبديل الوضع الداكن" title="الوضع الداكن / الفاتح">${document.documentElement.classList.contains('dark') ? '☀' : '☾'}</button><a href="#password" class="btn s g">الرقم السري</a><button class="btn s g" id="logout">خروج</button></div>
  </header><main>${inner}</main>`;
  $app.querySelector('#theme').onclick = () => { const d = document.documentElement.classList.toggle('dark'); try { localStorage.setItem('qh_theme', d ? 'dark' : 'light'); } catch (e) { } $app.querySelector('#theme').textContent = d ? '☀' : '☾'; };
  $app.querySelector('#logout').onclick = async () => { await api('/api/logout', { method: 'POST' }); S.user = null; go('login'); };
  return $app.querySelector('main');
}
async function route() {
  clearInterval(S.timer);
  const r = (location.hash || '#').slice(1) || 'search';
  if (!S.user && r !== 'forgot') return viewLogin();
  if (r === 'forgot') return viewForgot();
  if (S.user.mustChange || r === 'password') return viewPassword();
  if (!S.meta) S.meta = await api('/api/meta');
  const views = { hunter: viewHunter, search: viewSearch, booking: viewBooking, bookings: viewBookings, suppliers: viewSuppliers, accounts: viewAccounts, employees: viewEmployees, permissions: viewPermissions };
  const allowed = NAV.find(n => n[0] === r);
  if (!views[r] || (allowed && !allowed[2]())) { const first = NAV.find(n => n[2]()); return first ? go(first[0]) : shell('', '<div class="card">لا توجد صلاحيات لحسابك. راجع المدير.</div>'); }
  try { await views[r](); } catch (e) { console.error(e); }
}

// ---------- الدخول ----------
function viewLogin() {
  $app.innerHTML = `<div class="login"><form class="card" id="f">
    <img src="/logo.jpg" alt="شعار سفريات القلعة">
    <div style="text-align:center"><h2>${esc(S.company.name || 'سفريات القلعة للسياحة والسفر')}</h2><p class="sub">نظام حجز الفنادق للموظفين</p></div>
    <label class="f">اسم المستخدم<input name="u" autocomplete="username" required></label>
    <label class="f">الرقم السري<input name="p" type="password" autocomplete="current-password" required></label>
    <div id="e"></div><button class="btn p">تسجيل الدخول</button>
    <a href="#forgot" style="text-align:center">نسيت الرقم السري؟</a></form></div>`;
  const f = $app.querySelector('#f');
  f.onsubmit = async e => {
    e.preventDefault(); const b = f.querySelector('button'); busy(b, true);
    try { const d = await api('/api/login', { body: { username: f.u.value, password: f.p.value } }); S.user = d.user; S.meta = null; go(d.user.mustChange ? 'password' : 'search'); route(); }
    catch (er) { f.querySelector('#e').innerHTML = `<div class="err">${esc(er.message)}</div>`; } finally { busy(b, false); }
  };
}
function viewForgot() {
  $app.innerHTML = `<div class="login"><form class="card" id="f">
    <img src="/logo.jpg" alt="شعار سفريات القلعة"><div style="text-align:center"><h2>استرجاع الرقم السري</h2><p class="sub">يصل طلبك للمدير أو لمن لديه صلاحية إعادة الرقم السري.</p></div>
    <label class="f">اسم المستخدم أو البريد الإلكتروني<input name="i" required></label>
    <label class="f">الرقم المدني<input name="c" inputmode="numeric" maxlength="12" required></label>
    <div id="e"></div><button class="btn p">إرسال الطلب</button><a href="#login" style="text-align:center">رجوع لتسجيل الدخول</a></form></div>`;
  const f = $app.querySelector('#f');
  f.onsubmit = async e => {
    e.preventDefault();
    try { const d = await api('/api/forgot', { body: { ident: f.i.value, civilId: f.c.value } }); f.querySelector('#e').innerHTML = `<div class="okmsg">${esc(d.message)}</div>`; f.querySelector('button').remove(); }
    catch (er) { f.querySelector('#e').innerHTML = `<div class="err">${esc(er.message)}</div>`; }
  };
}
function viewPassword() {
  const forced = S.user.mustChange;
  const html = `<form class="card" id="f" style="max-width:460px;display:flex;flex-direction:column;gap:14px">
    <h2>تغيير الرقم السري</h2>${forced ? '<p class="sub">لازم تغيّر الرقم السري المؤقت قبل استخدام النظام.</p>' : ''}
    <label class="f">الرقم السري الحالي<input name="c" type="password" autocomplete="current-password" required></label>
    <label class="f">الرقم السري الجديد (8 خانات على الأقل)<input name="n" type="password" autocomplete="new-password" minlength="8" required></label>
    <label class="f">تأكيد الرقم الجديد<input name="n2" type="password" autocomplete="new-password" required></label>
    <div id="e"></div><button class="btn p">حفظ</button></form>`;
  const main = forced ? (($app.innerHTML = `<div class="login">${html}</div>`), $app) : shell('', html);
  const f = main.querySelector('#f');
  f.onsubmit = async e => {
    e.preventDefault();
    if (f.n.value !== f.n2.value) return f.querySelector('#e').innerHTML = '<div class="err">الرقمان غير متطابقين</div>';
    try { await api('/api/change-password', { body: { current: f.c.value, next: f.n.value } }); S.user.mustChange = false; toast('تم تغيير الرقم السري'); go('search'); }
    catch (er) { f.querySelector('#e').innerHTML = `<div class="err">${esc(er.message)}</div>`; }
  };
}

// ---------- البحث والنتائج ----------
const steps = n => `<ol class="steps" aria-label="خطوات الحجز">${['اختيار الفندق والغرفة', 'بيانات النزلاء', 'التأكيد والقسيمة'].map((t, i) => `${i ? '<i aria-hidden="true"></i>' : ''}<li class="${i + 1 === n ? 'on' : ''}"><span>${i + 1}</span>${t}</li>`).join('')}</ol>`;
const NATS = [['KW', 'كويتي'], ['SA', 'سعودي'], ['AE', 'إماراتي'], ['QA', 'قطري'], ['BH', 'بحريني'], ['OM', 'عماني'], ['YE', 'يمني'], ['IQ', 'عراقي'], ['JO', 'أردني'], ['SY', 'سوري'], ['LB', 'لبناني'], ['PS', 'فلسطيني'], ['EG', 'مصري'], ['SD', 'سوداني'], ['LY', 'ليبي'], ['TN', 'تونسي'], ['DZ', 'جزائري'], ['MA', 'مغربي'], ['MR', 'موريتاني'], ['SO', 'صومالي'], ['DJ', 'جيبوتي'], ['KM', 'قمري']];
const normAr = s => String(s || '').toLowerCase().replace(/[\u064B-\u0652\u0640]/g, '').replace(/[أإآ]/g, 'ا').replace(/ة/g, 'ه').replace(/ى/g, 'ي').trim();
async function loadCities() {
  if (S.cities) return S.cities;
  const d = await fetch('/cities.json').then(r => r.json());
  S.cities = d.cities.map(([code, ar, en, cAr, cEn, alt]) => ({ code, ar, en, cAr, cEn, alt, key: normAr([ar, en, code, cAr, cEn, ...(alt || [])].join(' ')) }));
  return S.cities;
}
const cityLabel = c => `${c.ar || c.en}${c.code ? ` (${c.code})` : ''}${c.ar ? ' · ' + c.en : ''}${c.cAr ? ' — ' + c.cAr : ''}`;
function findCities(term) {
  const t = normAr(term); if (!t) return [];
  const exact = [], starts = [], has = [];
  for (const c of S.cities) {
    if (c.code.toLowerCase() === t || (c.alt || []).some(a => a.toLowerCase() === t)) exact.push(c);
    else if (normAr(c.ar).startsWith(t) || c.en.toLowerCase().startsWith(t)) starts.push(c);
    else if (c.key.includes(t)) has.push(c);
    if (exact.length + starts.length > 40) break;
  }
  return [...exact, ...starts, ...has].slice(0, 12);
}
async function viewSearch() {
  await loadCities();
  const q = S.search || { city: 'مكة المكرمة', cityEn: 'Makkah', cityCode: '', checkin: addDays(14), checkout: addDays(17), rooms: [{ adults: 2, children: [] }], nationality: 'كويتي', residence: 'KW' };
  if (!S.cityObj) S.cityObj = S.cities.find(c => c.ar === q.city || c.en === q.cityEn) || null;
  const main = shell('search', `${steps(1)}
    <div class="head"><div><h1>البحث عن فندق</h1><p class="sub">ابحث في كل الشركات المورّدة دفعة واحدة. السعر المعروض هو سعر البيع النهائي، واسم الشركة لا يظهر إلا بعد تأكيد الحجز.</p></div></div>
    <form class="card" id="sf" autocomplete="off"><div class="row">
      <label class="f" style="flex:2 1 280px;position:relative">الوجهة (المدينة أو رمز المطار)<input name="city" id="cityIn" value="${esc(S.cityObj ? cityLabel(S.cityObj) : '')}" placeholder="مثال: القاهرة أو Cairo أو CAI" required role="combobox" aria-expanded="false" aria-controls="cityList">
        <ul id="cityList" role="listbox" style="display:none;position:absolute;top:100%;right:0;left:0;z-index:20;background:var(--card);border:1px solid var(--bd2);border-radius:12px;margin:4px 0 0;padding:6px;list-style:none;max-height:340px;overflow:auto;box-shadow:0 8px 24px rgba(0,0,0,.12)"></ul></label>
      <label class="f">تاريخ الدخول<input name="checkin" type="date" value="${q.checkin}" min="${addDays(0)}" required></label>
      <label class="f">تاريخ الخروج<input name="checkout" type="date" value="${q.checkout}" required></label>
      <label class="f">الغرف<select name="rooms">${[1, 2, 3, 4, 5].map(n => `<option ${q.rooms.length === n ? 'selected' : ''}>${n}</option>`).join('')}</select></label>
      <label class="f">جنسية النزلاء<select name="nat">${NATS.map(([c, t]) => `<option value="${c}|${t}" ${q.nationality === t ? 'selected' : ''}>${t}</option>`).join('')}</select></label>
      <button class="btn p" style="flex:0 0 auto">بحث</button></div>
      <div id="paxes" class="row" style="margin-top:12px"></div>
      <p class="muted" style="margin:10px 0 0">الجنسية تُثبّت من البحث حتى الحجز، لأن تغييرها قد يغيّر السعر أو يُفشل الحجز.</p></form>
    <div id="res"></div>`);
  const cin = main.querySelector('#cityIn'), cl = main.querySelector('#cityList');
  let matches = [];
  const drawList = () => {
    matches = findCities(cin.value);
    cl.innerHTML = matches.map((c, i) => `<li role="option" data-i="${i}" style="padding:10px 12px;border-radius:8px;cursor:pointer;display:flex;justify-content:space-between;gap:10px"><span><b>${esc(c.ar || c.en)}</b> <span class="muted">${c.ar ? esc(c.en) + ' — ' : ''}${esc(c.cAr || c.cEn)}</span></span>${c.code ? `<b dir="ltr" style="color:var(--ac)">${esc(c.code)}</b>` : ''}</li>`).join('') || '<li class="muted" style="padding:10px">لا توجد مدينة بهذا الاسم</li>';
    cl.style.display = cin.value.trim() ? 'block' : 'none'; cin.setAttribute('aria-expanded', cl.style.display === 'block');
  };
  const pick = c => { S.cityObj = c; cin.value = cityLabel(c); cl.style.display = 'none'; };
  cin.oninput = () => { S.cityObj = null; drawList(); };
  cin.onfocus = () => { if (!S.cityObj && cin.value) drawList(); else cin.select(); };
  cin.onkeydown = e => { if (e.key === 'Enter' && cl.style.display === 'block' && matches[0]) { e.preventDefault(); pick(matches[0]); } if (e.key === 'Escape') cl.style.display = 'none'; };
  cl.onmousedown = e => { const li = e.target.closest('[data-i]'); if (li) { e.preventDefault(); pick(matches[+li.dataset.i]); } };
  cl.onmouseover = e => { cl.querySelectorAll('li').forEach(l => l.style.background = ''); const li = e.target.closest('[data-i]'); if (li) li.style.background = 'var(--acbg)'; };
  cin.onblur = () => setTimeout(() => { cl.style.display = 'none'; }, 150);
  const f = main.querySelector('#sf');
  let rooms = JSON.parse(JSON.stringify(q.rooms));
  const drawPax = () => {
    main.querySelector('#paxes').innerHTML = rooms.map((r, i) => `<div class="row" style="flex:1 1 300px;background:var(--bg);border-radius:12px;padding:10px 12px;gap:10px">
      <b style="flex:0 0 auto;align-self:center">غرفة ${i + 1}</b>
      <label class="f" style="flex:1 1 90px">بالغون<select data-a="${i}">${[1, 2, 3, 4].map(n => `<option ${r.adults === n ? 'selected' : ''}>${n}</option>`).join('')}</select></label>
      <label class="f" style="flex:1 1 90px">أطفال<select data-c="${i}">${[0, 1, 2, 3].map(n => `<option ${r.children.length === n ? 'selected' : ''}>${n}</option>`).join('')}</select></label>
      ${r.children.map((a, j) => `<label class="f" style="flex:1 1 80px">عمر الطفل ${j + 1}<select data-ca="${i}-${j}">${Array.from({ length: 18 }, (_, k) => `<option ${a === k ? 'selected' : ''}>${k}</option>`).join('')}</select></label>`).join('')}</div>`).join('');
  };
  drawPax();
  f.rooms.onchange = () => { const n = +f.rooms.value; while (rooms.length < n) rooms.push({ adults: 2, children: [] }); rooms = rooms.slice(0, n); drawPax(); };
  main.querySelector('#paxes').onchange = e => {
    const t = e.target;
    if (t.dataset.a) rooms[+t.dataset.a].adults = +t.value;
    if (t.dataset.c) { const r = rooms[+t.dataset.c]; const n = +t.value; while (r.children.length < n) r.children.push(5); r.children = r.children.slice(0, n); drawPax(); }
    if (t.dataset.ca) { const [i, j] = t.dataset.ca.split('-'); rooms[i].children[j] = +t.value; }
  };
  f.checkin.onchange = () => { if (f.checkout.value <= f.checkin.value) f.checkout.value = addDays(1, f.checkin.value); };
  f.onsubmit = async e => {
    e.preventDefault();
    const [res, nat] = f.nat.value.split('|');
    if (!S.cityObj) { const m = findCities(f.city.value)[0]; if (!m) return toast('اختر الوجهة من القائمة'); S.cityObj = m; f.city.value = cityLabel(m); }
    const c = S.cityObj;
    S.search = { city: c.ar || c.en, cityEn: c.en, cityCode: c.code, checkin: f.checkin.value, checkout: f.checkout.value, rooms, residence: res, nationality: nat };
    const out = main.querySelector('#res'); out.innerHTML = '<div class="card muted">جارٍ البحث في كل الشركات المفعّلة...</div>';
    try { S.results = await api('/api/search', { body: S.search }); drawResults(main); }
    catch (er) { out.innerHTML = `<div class="err">${esc(er.message)}</div>`; }
  };
  if (S.results) drawResults(main);
}
function drawResults(main) {
  const out = main.querySelector('#res'); const R = S.results; const F = S.filters; const q = S.search;
  const boards = [...new Set(R.hotels.flatMap(h => h.options.map(o => o.board)).filter(Boolean))];
  let hotels = R.hotels.map(h => ({ ...h, options: h.options.filter(o => (!F.boards.length || F.boards.includes(o.board)) && (!F.refundable || o.refundable) && (!F.min || o.sell >= +F.min) && (!F.max || o.sell <= +F.max)) }))
    .filter(h => h.options.length && (!F.stars.length || F.stars.includes(h.stars)));
  hotels.sort((a, b) => F.sort === 'stars' ? (b.stars || 0) - (a.stars || 0) : a.options[0].sell - b.options[0].sell);
  const chip = (on, t, d) => `<button type="button" class="chip ${on ? 'on' : ''}" ${d}>${t}</button>`;
  const pax = q.rooms.reduce((a, r) => a + r.adults + r.children.length, 0);
  out.innerHTML = `<div style="display:flex;flex-direction:column;gap:14px">
    <section class="card chips" aria-label="تصفية النتائج" style="padding:14px 18px">
      <div class="grp"><b>التصنيف</b>${[5, 4, 3, 2].map(s => chip(F.stars.includes(s), `${s} نجوم`, `data-star="${s}"`)).join('')}</div><span class="sep"></span>
      <div class="grp"><b>الوجبات</b>${boards.map(b => chip(F.boards.includes(b), esc(b), `data-board="${esc(b)}"`)).join('')}</div><span class="sep"></span>
      <div class="grp"><b>الإلغاء</b>${chip(F.refundable, 'قابل للاسترداد فقط', 'data-ref="1"')}</div><span class="sep"></span>
      <div class="grp"><b>السعر</b><input id="pmin" placeholder="من" value="${esc(F.min)}" style="width:80px;height:36px;border:1px solid var(--bd2);border-radius:10px;padding:0 10px"><input id="pmax" placeholder="إلى" value="${esc(F.max)}" style="width:80px;height:36px;border:1px solid var(--bd2);border-radius:10px;padding:0 10px"></div>
      <label class="grp" style="margin-right:auto"><b>الترتيب</b><select id="sort" style="height:36px;border:1px solid var(--bd2);border-radius:10px;padding:0 10px"><option value="price">الأقل سعراً</option><option value="stars" ${F.sort === 'stars' ? 'selected' : ''}>الأعلى تصنيفاً</option></select></label>
    </section>
    <div class="row" style="justify-content:space-between"><span><b>${hotels.length}</b> فندقاً متاحاً · ${R.nights} ليالٍ · تم البحث في ${R.suppliersSearched} ${R.suppliersSearched === 1 ? 'شركة' : 'شركات'}${R.suppliersFailed ? ` · <span class="pill warn">${R.suppliersFailed} لم ترد</span>` : ''}</span></div>
    ${hotels.length ? hotels.map(h => `<article class="hotel"><div class="top">
      <div class="himg">${h.image ? `<img src="${esc(h.image)}" alt="">` : 'صورة الفندق'}</div>
      <div class="hinfo"><h3 style="font-size:20px">${esc(h.name)}</h3><div>${starsTxt(h.stars)}</div><div class="muted">${esc(h.area || '')}${h.area ? '، ' : ''}${esc(h.city)}</div>
        <div class="stay"><div><small>الوصول</small><b>${longDate(q.checkin)}</b>${h.checkinTime ? `<small>من ${esc(h.checkinTime)}</small>` : ''}</div><div><small>المغادرة</small><b>${longDate(q.checkout)}</b>${h.checkoutTime ? `<small>حتى ${esc(h.checkoutTime)}</small>` : ''}</div><div><small>المدة</small><b>${R.nights} ليالٍ</b><small>${q.rooms.length} ${q.rooms.length > 1 ? 'غرف' : 'غرفة'}، ${pax} نزلاء</small></div></div></div></div>
      <div class="rooms"><div class="row" style="justify-content:space-between"><b>الغرف المتاحة</b><span class="muted">أفضل الأسعار من كل المزوّدين · ${h.options.length} خيار</span></div>
      ${h.options.map(o => `<div class="opt"><div class="l"><div><b style="font-size:17px">${esc(o.roomName)}</b><div class="muted" style="display:flex;gap:14px;flex-wrap:wrap;margin-top:4px"><span>${esc(o.board)}</span><span>السعر لكل الغرف</span></div></div>
        <div style="display:flex;flex-direction:column;align-items:flex-end;gap:6px"><span class="price">${(+o.sell).toFixed(3)} <small>KWD</small></span><span class="muted">للإقامة كاملة، ${R.nights} ليالٍ · شامل الضرائب</span>${can('book') ? `<button class="btn p s" style="height:40px;padding:0 22px" data-pick="${o.token}">اختر</button>` : ''}</div></div>
        <div class="canc ${o.refundable ? 'ok' : 'bad'}">${esc(o.cancelPolicy)}</div></div>`).join('')}</div></article>`).join('') : (R.hotels.length ? '<div class="empty">لا توجد نتائج مطابقة للفلاتر. غيّر الفلاتر.</div>' : '<div class="empty">لا توجد فنادق متاحة لهذه الوجهة والتواريخ لدى الشركات المفعّلة حالياً.</div>')}</div>`;
  const tog = (arr, v) => arr.includes(v) ? arr.splice(arr.indexOf(v), 1) : arr.push(v);
  out.onclick = async e => {
    const t = e.target.closest('button'); if (!t) return;
    if (t.dataset.star) { tog(F.stars, +t.dataset.star); return drawResults(main); }
    if (t.dataset.board) { tog(F.boards, t.dataset.board); return drawResults(main); }
    if (t.dataset.ref) { F.refundable = !F.refundable; return drawResults(main); }
    if (t.dataset.pick) {
      busy(t, true);
      try { S.rules = await api('/api/rules', { body: { token: t.dataset.pick } }); S.rules.optionToken = t.dataset.pick; go('booking'); }
      catch (er) { toast(er.message); busy(t, false); }
    }
  };
  out.querySelector('#sort').onchange = e => { F.sort = e.target.value; drawResults(main); };
  out.querySelector('#pmin').onchange = e => { F.min = e.target.value; drawResults(main); };
  out.querySelector('#pmax').onchange = e => { F.max = e.target.value; drawResults(main); };
}

// ---------- الغرف وبيانات الحجز ----------
function viewBooking() {
  const R = S.rules; if (!R) return go('search');
  const q = R.query; const H = R.hotel || {};
  const adults = q.rooms.reduce((a, r) => a + r.adults, 0);
  let gi = 0;
  const guestFields = q.rooms.map((r, ri) => `<div style="flex:1 1 100%"><b>غرفة ${ri + 1}</b> <span class="muted">· ${r.adults} بالغ${r.children.length ? ` · ${r.children.length} طفل (${r.children.join('، ')} سنوات)` : ''}</span></div>` +
    Array.from({ length: r.adults }, () => { const i = gi++; return `<label class="f">الاسم الأول (كما في الجواز)<input data-gf="${i}" required dir="ltr"></label><label class="f">اسم العائلة<input data-gl="${i}" required dir="ltr"></label>`; }).join('')).join('');
  const main = shell('search', `${steps(2)}
    <div class="head"><div><h1>تفاصيل الفندق</h1><p class="sub">الاسم والعنوان والتصنيف من رد الشركة المورّدة مباشرة.</p></div><a class="btn g" href="#search">رجوع للنتائج</a></div>
    <section class="card row" style="align-items:flex-start;gap:22px">
      <div class="gallery">${H.images?.length ? H.images.slice(0, 4).map(s => `<div style="background:url('${esc(s)}') center/cover"></div>`).join('') : '<div>صورة الفندق الرئيسية</div><div>الغرفة</div><div>الواجهة</div><div>المرافق</div>'}</div>
      <div style="flex:1 1 360px;display:flex;flex-direction:column;gap:12px">
        <h2 style="font-size:24px">${esc(H.name)}</h2><div>${starsTxt(H.stars)}</div><div class="muted">${esc(H.address || '')}</div>
        ${H.description ? `<p style="margin:0;line-height:1.8">${esc(H.description)}</p>` : ''}
        ${H.facilities?.length ? `<div class="row" style="gap:8px">${H.facilities.map(x => `<span class="pill">${esc(x)}</span>`).join('')}</div>` : ''}
        <div class="stay" style="grid-template-columns:1fr 1fr"><div><small>الدخول</small><b>${longDate(q.checkin)}</b>${H.checkinTime ? `<small>من ${esc(H.checkinTime)}</small>` : ''}</div><div><small>الخروج</small><b>${longDate(q.checkout)}</b>${H.checkoutTime ? `<small>حتى ${esc(H.checkoutTime)}</small>` : ''}</div></div>
      </div></section>
    <form id="bf" style="display:flex;flex-direction:column;gap:20px">
    <section class="card"><h2>بيانات النزلاء والعميل</h2><div class="row">${guestFields}</div>
      <div class="row" style="margin-top:16px">
        <label class="f">اسم العميل<input name="cn" required></label><label class="f">هاتف العميل<input name="cp" required inputmode="tel" dir="ltr" placeholder="+965"></label>
        <label class="f">البريد الإلكتروني (لإرسال القسيمة)<input name="ce" type="email" dir="ltr"></label><label class="f" style="flex:2 1 300px">ملاحظات للفندق (غير مضمونة)<input name="notes"></label></div></section>
    <section class="card" style="display:flex;flex-direction:column;gap:18px" aria-label="ملخص الحجز">
      <div class="row" style="justify-content:space-between;align-items:center"><h2>ملخص الحجز</h2><div class="timer"><b id="tm">10:00</b><span class="muted" style="color:inherit">السعر محجوز 10 دقائق، بعدها نعيد طلب الشروط تلقائياً</span></div></div>
      <div class="tiles">
        <div class="tile"><small>الفندق</small><b>${esc(H.name)}</b><small>${H.stars ? H.stars + ' نجوم · ' : ''}${esc(H.city || q.city)}</small></div>
        <div class="tile"><small>الدخول</small><b>${longDate(q.checkin)}</b>${H.checkinTime ? `<small>من ${esc(H.checkinTime)}</small>` : ''}</div>
        <div class="tile"><small>الخروج</small><b>${longDate(q.checkout)}</b>${H.checkoutTime ? `<small>حتى ${esc(H.checkoutTime)}</small>` : ''}</div>
        <div class="tile"><small>المدة</small><b>${R.nights} ليالٍ</b></div>
        <div class="tile"><small>الغرفة</small><b>${esc(R.roomName)}</b><small>${esc(R.board)}</small></div>
        <div class="tile"><small>النزلاء</small><b>${adults} بالغ${q.rooms.reduce((a, r) => a + r.children.length, 0) ? ' + أطفال' : ''}</b><small>${esc(q.nationality)}</small></div>
        <div class="tile"><small>الإلغاء</small><b style="color:${R.refundable ? 'var(--ok)' : 'var(--bad)'}">${R.refundable ? 'قابل للاسترداد' : 'غير مسترد'}</b><small>${esc(R.cancelPolicy)}</small></div>
      </div>
      <div class="row" style="border-top:1px solid var(--bd);padding-top:18px;gap:18px">
        <div style="flex:1 1 220px"><span class="muted">سعر البيع للعميل</span><div class="price" style="font-size:32px">${(+R.sell).toFixed(3)} <small>د.ك</small></div><span class="muted">شامل الضرائب والرسوم</span></div>
        <label class="f" style="flex:1 1 240px">طريقة تحصيل المبلغ من العميل<select name="col"><option>نقداً في المكتب</option><option>كي نت / رابط دفع Payq8</option><option>تحويل بنكي</option><option>على حساب العميل (آجل)</option></select></label>
        <div style="flex:1 1 240px;display:flex;flex-direction:column;gap:6px"><button class="btn p" style="height:50px">تأكيد الحجز</button><span class="muted" style="text-align:center">يتأكد فوراً على حساب الوكالة لدى الشركة المورّدة</span></div>
      </div><div id="e"></div></section></form>`);
  const tm = main.querySelector('#tm');
  const tick = () => { const s = Math.max(0, Math.floor((R.expiresAt - Date.now()) / 1000)); tm.textContent = `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`; };
  tick(); S.timer = setInterval(tick, 1000);
  const f = main.querySelector('#bf');
  f.onsubmit = async e => {
    e.preventDefault(); const b = f.querySelector('button.p'); busy(b, true); f.querySelector('#e').innerHTML = '';
    const guests = Array.from({ length: adults }, (_, i) => ({ first: val(f, `[data-gf="${i}"]`), last: val(f, `[data-gl="${i}"]`) }));
    try {
      const d = await api('/api/book', { body: { quoteToken: R.quoteToken, guests, customerName: f.cn.value, customerPhone: f.cp.value, customerEmail: f.ce.value, notes: f.notes.value, collection: f.col.value } });
      S.rules = null; S.results = null; S.openBooking = d.booking.id;
      toast(d.booking.status === 'confirmed' ? `تم تأكيد الحجز ${d.booking.ref}` : `الحجز ${d.booking.ref}: ${STATUS[d.booking.status]?.[0] || d.booking.status}`);
      go('bookings');
    } catch (er) { f.querySelector('#e').innerHTML = `<div class="err">${esc(er.message)}</div>`; busy(b, false); }
  };
}

// ---------- الحجوزات والقسائم ----------
async function viewBookings() {
  const B = S.bk;
  let users = [];
  if (can('bookings_all') && (can('users_view') || can('users_edit') || can('password_reset'))) users = (await api('/api/users').catch(() => ({ users: [] }))).users;
  const main = shell('bookings', `<div class="head"><div><h1>الحجوزات والقسائم</h1><p class="sub">آخر الحجوزات أولاً. ابحث أو صفِّ النتائج، ثم اضغط «عرض القسيمة».</p></div>${can('search') ? '<a class="btn p" href="#search">+ حجز جديد</a>' : ''}</div>
    <section class="card" style="display:flex;flex-direction:column;gap:14px"><h2 style="margin:0">آخر الحجوزات</h2>
      <form class="row" id="ff">
        <label class="f" style="flex:3 1 300px">بحث<input name="q" value="${esc(B.q)}" placeholder="اسم العميل أو النزيل أو رقم الحجز أو الهاتف"></label>
        <label class="f">الحالة<select name="status"><option value="">الكل</option>${Object.entries(STATUS).map(([k, v]) => `<option value="${k}" ${B.status === k ? 'selected' : ''}>${v[0]}</option>`).join('')}</select></label>
        <label class="f">من تاريخ<input type="date" name="from" value="${B.from}"></label><label class="f">إلى تاريخ<input type="date" name="to" value="${B.to}"></label>
        <label class="f">نوع التاريخ<select name="dateType"><option value="created">تاريخ الحجز</option><option value="checkin" ${B.dateType === 'checkin' ? 'selected' : ''}>تاريخ الدخول</option></select></label>
        ${users.length ? `<label class="f">الموظف<select name="user"><option value="">كل الموظفين</option>${users.map(u => `<option value="${u.id}" ${+B.user === u.id ? 'selected' : ''}>${esc(u.name)}</option>`).join('')}</select></label>` : ''}
        <label class="f">المدينة / الفندق<input name="city" value="${esc(B.city)}"></label>
        <button class="btn p" style="flex:0 0 auto">بحث</button><button type="button" class="btn g" id="clr" style="flex:0 0 auto">مسح الفلاتر</button></form>
      <div id="list"><div class="muted">جارٍ التحميل...</div></div></section>
    <div id="detail"></div>`);
  const ff = main.querySelector('#ff');
  ff.onsubmit = e => { e.preventDefault(); Object.assign(B, Object.fromEntries(new FormData(ff)), { page: 1 }); load(); };
  main.querySelector('#clr').onclick = () => { Object.assign(B, { q: '', status: '', from: '', to: '', dateType: 'created', user: '', city: '', page: 1 }); viewBookings(); };
  async function load() {
    const p = new URLSearchParams({ ...B, size: 20 });
    const d = await api('/api/bookings?' + p);
    const total = Object.values(d.counts).reduce((a, b) => a + b, 0);
    const pages = Math.max(1, Math.ceil(d.total / d.size));
    main.querySelector('#list').innerHTML = `<div class="row" style="gap:8px;margin-bottom:12px">${[['', 'الكل', total], ...Object.entries(STATUS).map(([k, v]) => [k, v[0], d.counts[k] || 0])].map(([k, t, n]) => `<button class="chip ${B.status === k ? 'on' : ''}" data-st="${k}">${t} · ${n}</button>`).join('')}</div>
      <div class="tw"><table><thead><tr><th>رقم الحجز</th><th>العميل</th><th>الهاتف</th><th>الفندق</th><th>المدينة</th><th>الدخول</th><th>الخروج</th><th>الموظف</th><th>المبلغ</th><th>الحالة</th><th></th></tr></thead><tbody>
      ${d.bookings.map(b => `<tr class="${S.openBooking === b.id ? 'sel' : ''}"><td><b>${b.ref}</b></td><td>${esc(b.customer.name)}</td><td dir="ltr">${esc(b.customer.phone)}</td><td>${esc(b.hotel.name)}</td><td>${esc(b.hotel.city)}</td><td>${shortDate(b.checkin)}</td><td>${shortDate(b.checkout)}</td><td>${esc(b.employee)}</td><td>${money(b.sell)}</td><td>${pill(b.status)}</td>
        <td><button class="btn p s" data-open="${b.id}">عرض القسيمة</button></td></tr>`).join('') || '<tr><td colspan="11" class="muted" style="text-align:center;padding:24px">لا توجد حجوزات</td></tr>'}</tbody></table></div>
      <div class="pager" style="margin-top:12px"><span>عرض ${d.bookings.length ? (d.page - 1) * d.size + 1 : 0}–${(d.page - 1) * d.size + d.bookings.length} من ${d.total} حجز · مرتبة من الأحدث</span>
      <div class="row" style="gap:6px">${Array.from({ length: Math.min(pages, 10) }, (_, i) => `<button class="btn s ${i + 1 === d.page ? 'p' : 'g'}" data-pg="${i + 1}">${i + 1}</button>`).join('')}</div></div>`;
  }
  main.querySelector('#list').onclick = e => {
    const t = e.target.closest('button'); if (!t) return;
    if ('st' in t.dataset) { B.status = t.dataset.st; B.page = 1; ff.status.value = B.status; load(); }
    if (t.dataset.pg) { B.page = +t.dataset.pg; load(); }
    if (t.dataset.open) { S.openBooking = +t.dataset.open; main.querySelectorAll('tr.sel').forEach(r => r.classList.remove('sel')); t.closest('tr').classList.add('sel'); showDetail(main); }
  };
  await load();
  if (S.openBooking) showDetail(main, false); else main.querySelector('#detail').innerHTML = '<div class="empty">اضغط «عرض القسيمة» على أي حجز في الجدول، وتظهر قسائمه هنا.</div>';
}
async function showDetail(main, scroll = true) {
  const box = main.querySelector('#detail');
  const { booking: b } = await api('/api/bookings/' + S.openBooking);
  const c = S.company;
  const kv = (k, v) => `<div class="kv"><span>${k}</span><b>${v}</b></div>`;
  const wa = (b.customer.phone || '').replace(/[^\d]/g, '');
  const waNum = wa.length === 8 ? '965' + wa : wa;
  const waText = `${c.name}\nقسيمة حجز فندق ${b.ref}\n${b.hotel.name}\nالدخول: ${shortDate(b.checkin)}${b.hotel.checkinTime ? ' من ' + b.hotel.checkinTime : ''}\nالخروج: ${shortDate(b.checkout)}${b.hotel.checkoutTime ? ' حتى ' + b.hotel.checkoutTime : ''}\nالغرفة: ${b.roomName} · ${b.board}\nرقم تأكيد الفندق: ${b.hotelConf || '—'}`;
  box.innerHTML = `<section class="card" style="border:2px solid var(--ac);display:flex;flex-direction:column;gap:16px">
    <div class="row" style="justify-content:space-between;align-items:center"><div><span class="muted">قسيمة الحجز المختار</span><h2 style="font-size:22px">${b.ref} ${pill(b.status)}</h2></div>
      <div class="row" style="gap:8px">
        ${can('voucher') ? `<button class="btn" id="pr">طباعة</button><button class="btn" id="pdf">تحميل PDF</button>${b.customer.email ? '<button class="btn" id="em">إرسال بالبريد</button>' : ''}${waNum ? `<a class="btn p" target="_blank" rel="noopener" href="https://wa.me/${waNum}?text=${encodeURIComponent(waText)}">إرسال للعميل واتساب</a>` : ''}` : ''}
        <button class="btn g" id="rd">قراءة الحجز من الشركة</button>
        ${can('cancel') && b.status !== 'cancelled' && b.status !== 'failed' ? '<button class="btn d" id="cx">إلغاء الحجز</button>' : ''}
        <button class="btn g" id="x" aria-label="إغلاق القسيمة">×</button></div></div>
    <div class="vcards">
      <article class="card"><div class="vhead"><img src="/logo.jpg" alt=""><div><span class="muted">قسيمة حجز العميل</span><h3>${esc(c.name)}</h3></div></div>
        ${kv('رقم الحجز', b.ref)}${kv('رقم تأكيد الفندق', esc(b.hotelConf || '—'))}${kv('الفندق', esc(b.hotel.name) + (b.hotel.stars ? ` · ${b.hotel.stars} نجوم` : ''))}${kv('العنوان', esc(b.hotel.address || ''))}
        ${kv('الغرفة والوجبات', esc(b.roomName) + ' · ' + esc(b.board))}${kv('النزلاء', b.guests.map(g => esc(g.first + ' ' + g.last)).join('، '))}
        ${kv('الدخول / الخروج', `${shortDate(b.checkin)} — ${shortDate(b.checkout)} · ${b.nights} ليالٍ`)}${kv('سياسة الإلغاء', esc(b.cancelPolicy))}${kv('المبلغ', money(b.sell))}
        <p class="muted" style="margin:10px 0 0">لا تظهر في هذه القسيمة اسم الشركة المورّدة ولا سعر التكلفة.</p></article>
      ${b.supplier ? `<article class="card"><div class="vhead"><img src="/logo.jpg" alt=""><div><span class="muted">بيانات الحجز لدى الشركة</span><h3>${b.cost != null ? 'تفاصيل داخلية' : 'تظهر بعد تأكيد الحجز'}</h3></div></div>
        ${kv('الشركة المورّدة', esc(b.supplier))}${kv('رقم حجز الشركة (Locator)', esc(b.locator || '—'))}${kv('حالة الحجز لدى الشركة', pill(b.status) + (b.supplierStatus ? ` <span class="muted">${esc(b.supplierStatus)}</span>` : ''))}
        ${kv('سعر البيع للعميل', money(b.sell))}${kv('الموظف', esc(b.employee))}${kv('طريقة التحصيل', esc(b.collection || '—'))}
        ${b.cost != null ? `<div style="margin-top:10px;padding-top:6px;border-top:2px solid var(--tx)"><span class="pill warn">للمحاسب والمدير</span>${kv('سعر التكلفة', money(b.cost))}${kv(`هامش الربح (${esc(b.marginDesc)})`, money(b.margin))}${kv(`مكافأة الموظف (${esc(b.bonusDesc)})`, money(b.bonus))}${kv('صافي ربح الشركة', money(b.net))}${b.savings ? kv(`وفّره صيّاد الأسعار (${b.rebooks} إعادة حجز)`, `<span style="color:var(--ok)">${money(b.savings)}</span>`) : ''}</div>` : '<p class="muted" style="margin:10px 0 0">سعر التكلفة وهامش الربح لا يظهران هنا.</p>'}
      </article>` : ''}
    </div></section>`;
  if (scroll) box.scrollIntoView({ behavior: 'smooth', block: 'start' });
  const $ = s => box.querySelector(s);
  $('#x').onclick = () => { S.openBooking = null; box.innerHTML = '<div class="empty">اضغط «عرض القسيمة» على أي حجز في الجدول، وتظهر قسائمه هنا.</div>'; main.querySelectorAll('tr.sel').forEach(r => r.classList.remove('sel')); };
  if ($('#pr')) $('#pr').onclick = () => printVoucher(b);
  if ($('#pdf')) $('#pdf').onclick = () => { toast('اختر «حفظ بصيغة PDF» من نافذة الطباعة'); setTimeout(() => printVoucher(b), 400); };
  if ($('#em')) $('#em').onclick = async e => { busy(e.target, true); try { await api(`/api/bookings/${b.id}/email`, { method: 'POST' }); toast('تم إرسال القسيمة على بريد العميل'); } catch (er) { toast(er.message); } busy(e.target, false); };
  $('#rd').onclick = async e => { busy(e.target, true); try { await api(`/api/bookings/${b.id}/read`, { method: 'POST' }); toast('تم تحديث الحالة من الشركة'); viewBookings(); } catch (er) { toast(er.message); busy(e.target, false); } };
  if ($('#cx')) $('#cx').onclick = () => modal(`<h2>إلغاء الحجز ${b.ref}</h2><p>سياسة الإلغاء: ${esc(b.cancelPolicy)}</p><p class="muted">الإلغاء يُرسل للشركة المورّدة مباشرة ولا يمكن التراجع عنه.</p><div class="row"><button class="btn d" id="ok">تأكيد الإلغاء</button><button class="btn g" data-close>رجوع</button></div>`, (m, close) => {
    m.querySelector('#ok').onclick = async e => { busy(e.target, true); try { await api(`/api/bookings/${b.id}/cancel`, { method: 'POST' }); close(); toast('تم إلغاء الحجز'); viewBookings(); } catch (er) { toast(er.message); busy(e.target, false); } };
  });
}
function printVoucher(b) {
  const c = S.company;
  let qr = '';
  try { const q = qrcode(0, 'M'); q.addData(`${b.ref}|${b.hotelConf || ''}|${b.checkin}`); q.make(); qr = q.createSvgTag({ cellSize: 3, margin: 0 }); } catch (e) { }
  const g = (ar, en, v) => `<div><small>${ar} · <span dir="ltr">${en}</span></small><b>${v}</b></div>`;
  let gi = 0;
  document.getElementById('print').innerHTML = `<div class="pv" dir="rtl">
    <header><div style="display:flex;align-items:center;gap:10px"><img src="/logo.jpg" alt=""><div><b style="font-size:17px">${esc(c.name)}</b><div class="muted" dir="ltr" style="text-align:right">${esc(c.nameEn || '')}</div></div></div><div><b style="font-size:19px">قسيمة حجز فندق</b><div class="muted">Hotel Voucher</div></div></header>
    <div style="display:flex;gap:12px"><div class="bx" style="flex:1"><h4>بيانات الحجز<small>Booking details</small></h4><div class="g">${g('رقم الحجز', 'Booking No.', b.ref)}${g('رقم تأكيد الفندق', 'Hotel Conf.', esc(b.hotelConf || '—'))}${g('تاريخ الإصدار', 'Issued', shortDate(b.createdAt.slice(0, 10)))}${g('الحالة', 'Status', STATUS[b.status]?.[0] || b.status)}</div></div>
      <div class="bx" style="flex:0 0 110px;text-align:center">${qr}<div class="muted" style="font-size:10px">للتحقق من الحجز</div></div></div>
    <div class="bx"><h4>الفندق<small>Hotel</small></h4><b style="font-size:16px">${esc(b.hotel.name)}</b> ${b.hotel.stars ? `<span class="stars">${'★'.repeat(b.hotel.stars)}</span>` : ''}<div>${esc(b.hotel.address || '')}</div>${b.hotel.phone ? `<div dir="ltr" style="text-align:right">Tel: ${esc(b.hotel.phone)}</div>` : ''}</div>
    <div class="bx"><h4>مدة الإقامة<small>Stay</small></h4><div class="g">${g('الدخول', 'Check-in', longDate(b.checkin) + (b.hotel.checkinTime ? ' · من ' + esc(b.hotel.checkinTime) : ''))}${g('الخروج', 'Check-out', longDate(b.checkout) + (b.hotel.checkoutTime ? ' · حتى ' + esc(b.hotel.checkoutTime) : ''))}${g('الليالي', 'Nights', b.nights)}</div></div>
    <div class="bx"><h4>الغرفة والنزلاء<small>Room &amp; Guests</small></h4><div class="g" style="margin-bottom:8px">${g('نوع الغرفة', 'Room', esc(b.roomName))}${g('الوجبات', 'Board', esc(b.board))}${g('عدد الغرف', 'Rooms', b.rooms.length)}</div>
      <table><thead><tr><th>#</th><th>اسم النزيل · Guest name</th><th>الغرفة · Room</th><th>الجنسية · Nationality</th></tr></thead><tbody>${b.rooms.flatMap((r, ri) => Array.from({ length: r.adults }, () => { const x = b.guests[gi++] || {}; return `<tr><td>${gi}</td><td dir="ltr" style="text-align:right">${esc((x.first || '') + ' ' + (x.last || ''))}</td><td>${ri + 1}</td><td>${esc(b.nationality || '')}</td></tr>`; })).join('')}</tbody></table></div>
    <div style="display:flex;gap:12px"><div class="bx" style="flex:2"><h4>سياسة الإلغاء<small>Cancellation policy</small></h4>${esc(b.cancelPolicy)}</div><div class="bx" style="flex:1"><h4>المبلغ<small>Amount</small></h4><b style="font-size:18px">${money(b.sell)}</b><div class="muted">${esc(b.collection || '')}</div></div></div>
    <div class="bx"><h4>ملاحظات مهمة<small>Important notes</small></h4><ul style="margin:0;padding-right:18px;line-height:1.7"><li>يرجى تقديم هذه القسيمة وجواز السفر أو البطاقة المدنية عند الوصول.</li><li>الطلبات الخاصة حسب التوفر ولا يضمنها الفندق.</li><li>أي رسوم إضافية يفرضها الفندق (مثل ضريبة البلدية) تُدفع مباشرة للفندق.</li></ul></div>
    <footer><span>للاستفسار: ${esc([c.phone, c.email, c.website].filter(Boolean).join(' · '))}</span><span>أصدرها: ${esc(b.employee || '')}</span></footer></div>`;
  setTimeout(() => window.print(), 300);
}

// ---------- الشركات الموردة و API ----------
async function viewSuppliers() {
  const d = can('suppliers_view') ? await api('/api/suppliers') : { suppliers: [] };
  const keys = can('api_keys') ? (await api('/api/api-keys')).keys : null;
  const main = shell('suppliers', `<div class="head"><div><h1>الشركات الموردة و API</h1><p class="sub">أضف أي عدد من شركات الفنادق، وفعّل أو أوقف أي شركة. الشركة الموقوفة لا تدخل في البحث، وحجوزاتها القديمة تبقى محفوظة.</p></div>${can('suppliers_edit') ? '<button class="btn p" id="add">+ إضافة شركة</button>' : ''}</div>
    ${can('suppliers_view') ? `<section class="card"><h2>الشركات</h2><div class="tw"><table><thead><tr><th>الشركة</th><th>نوع الربط</th><th>البيئة</th><th>الفنادق المخزنة</th><th>الحجوزات</th><th>آخر اختبار اتصال</th><th>الحالة</th><th></th></tr></thead><tbody>
    ${d.suppliers.map(s => `<tr><td><b>${esc(s.name)}</b></td><td>${esc(s.typeLabel)}</td><td>${s.env === 'live' ? '<span class="pill info">فعلي</span>' : s.env === 'test' ? '<span class="pill">تجريبي داخلي</span>' : '<span class="pill warn">تجريبي UAT</span>'}</td>
      <td>${s.type === 'mock' ? '—' : s.hotels}</td><td>${s.bookings}</td><td>${s.lastTest ? `${s.lastTestOk ? '<span class="pill ok">ناجح</span>' : '<span class="pill bad">فشل</span>'} <span class="muted">${esc(s.lastTest)}</span>` : '<span class="muted">لم يُختبر</span>'}</td>
      <td>${can('suppliers_toggle') ? `<button class="chip ${s.active ? 'on' : ''}" data-tg="${s.id}" aria-pressed="${s.active}" style="${s.active ? 'background:var(--okbg);color:var(--ok);border-color:var(--ok)' : 'background:var(--badbg);color:var(--bad);border-color:var(--bad)'}">${s.active ? 'مفعّلة · إيقاف' : 'موقوفة · تفعيل'}</button>` : (s.active ? '<span class="pill ok">مفعّلة</span>' : '<span class="pill bad">موقوفة</span>')}</td>
      <td>${can('suppliers_edit') ? `<button class="btn s g" data-ed="${s.id}">تعديل</button> <button class="btn s g" data-ts="${s.id}">اختبار الاتصال</button>${s.type !== 'mock' ? ` <button class="btn s g" data-sy="${s.id}">تحديث الفنادق</button>` : ''}` : ''}</td></tr>`).join('')}</tbody></table></div>
      <p class="muted">بيانات الربط (الرقم السري) تُحفظ مشفرة في السيرفر ولا تظهر مرة أخرى. قائمة فنادق Juniper تُحدّث مرة كل 15 يوماً على الأقل.</p></section>` : ''}
    ${keys ? `<section class="card"><h2>ربط موقع السفريات (API)</h2><div class="tw"><table><thead><tr><th>الموقع</th><th>المفتاح</th><th>تاريخ الإنشاء</th><th>الحالة</th><th></th></tr></thead><tbody>
      ${keys.map(k => `<tr><td>${esc(k.name)}</td><td dir="ltr">qh_live_••••${esc(k.key_tail)}</td><td>${esc(k.created_at)}</td><td>${k.active ? '<span class="pill ok">فعّال</span>' : '<span class="pill bad">موقوف</span>'}</td><td><button class="btn s g" data-kt="${k.id}">${k.active ? 'إيقاف' : 'تفعيل'}</button></td></tr>`).join('') || '<tr><td colspan="5" class="muted">لا توجد مفاتيح</td></tr>'}</tbody></table></div>
      <div class="row" style="margin-top:14px"><label class="f" style="flex:0 1 320px">اسم الموقع<input id="kn" value="alqalaatravels.net"></label><button class="btn" id="nk">إنشاء مفتاح جديد</button></div>
      <pre dir="ltr" style="background:var(--bg);border-radius:12px;padding:14px;font-size:13px;overflow:auto;margin:14px 0 0">Header: X-API-Key: qh_live_...
POST /api/v1/hotels/search   {city, checkin, checkout, rooms:[{adults, children:[ages]}], residence}
POST /api/v1/hotels/rules    {token}            → final price + cancellation (valid 10 min)
POST /api/v1/hotels/book     {quoteToken, guests:[{first,last}], customerName, customerPhone, customerEmail}
GET  /api/v1/bookings/:ref
POST /api/v1/bookings/:ref/cancel</pre><p class="muted">الموقع يرى سعر البيع النهائي فقط، ولا يعرف أي شركة وراء الحجز.</p></section>` : ''}`);
  const supForm = s => modal(`<h2>${s ? 'تعديل شركة' : 'إضافة شركة'}</h2><form id="sf" style="display:flex;flex-direction:column;gap:12px">
    <label class="f">اسم الشركة<input name="name" value="${esc(s?.name || '')}" required></label>
    ${s ? '' : `<label class="f">نوع الربط<select name="type">${S.meta.supplierTypes.map(t => `<option value="${t.key}" ${t.key === 'juniper' ? 'selected' : ''}>${esc(t.label)}</option>`).join('')}</select></label>`}
    <label class="f">البيئة<select name="env"><option value="uat" ${s?.env === 'uat' ? 'selected' : ''}>تجريبي UAT</option><option value="live" ${s?.env === 'live' ? 'selected' : ''}>فعلي</option></select></label>
    <label class="f">عنوان الربط (URL)<input name="endpoint" dir="ltr" value="${esc(s?.endpoint || '')}" placeholder="https://..."></label>
    <label class="f">البريد (Email)<input name="username" dir="ltr" value="${esc(s?.username || '')}"></label>
    <label class="f">الرقم السري ${s?.hasPassword ? '(محفوظ — اتركه فاضي إذا ما تبي تغيّره)' : ''}<input name="password" type="password" autocomplete="new-password"></label>
    <label class="f">مهلة البحث بالثواني (حتى 8)<input name="timeoutSec" type="number" min="1" max="8" value="${s?.timeoutSec || 8}"></label>
    <div id="e"></div><div class="row"><button class="btn p">حفظ</button><button type="button" class="btn g" data-close>إلغاء</button></div></form>`, (m, close) => {
    const f = m.querySelector('#sf');
    f.onsubmit = async e => { e.preventDefault(); const body = Object.fromEntries(new FormData(f));
      try { await api(s ? `/api/suppliers/${s.id}` : '/api/suppliers', { method: s ? 'PUT' : 'POST', body }); close(); toast(s ? 'تم الحفظ' : 'تمت إضافة الشركة (موقوفة حتى تفعّلها)'); viewSuppliers(); }
      catch (er) { f.querySelector('#e').innerHTML = `<div class="err">${esc(er.message)}</div>`; } };
  });
  const add = main.querySelector('#add'); if (add) add.onclick = () => supForm(null);
  main.onclick = async e => {
    const t = e.target.closest('button'); if (!t) return;
    const id = t.dataset.tg || t.dataset.ed || t.dataset.ts || t.dataset.sy || t.dataset.kt;
    try {
      if (t.dataset.tg) { await api(`/api/suppliers/${id}/toggle`, { method: 'POST' }); viewSuppliers(); }
      if (t.dataset.ed) supForm(d.suppliers.find(s => s.id === +id));
      if (t.dataset.ts) { busy(t, true); const r = await api(`/api/suppliers/${id}/test`, { method: 'POST' }); toast((r.ok ? '✓ ' : '✗ ') + r.message, 6000); viewSuppliers(); }
      if (t.dataset.sy) { busy(t, true); const r = await api(`/api/suppliers/${id}/sync`, { method: 'POST' }); toast(r.message, 6000); viewSuppliers(); }
      if (t.dataset.kt) { await api(`/api/api-keys/${id}/toggle`, { method: 'POST' }); viewSuppliers(); }
      if (t.id === 'nk') { const r = await api('/api/api-keys', { body: { name: main.querySelector('#kn').value } });
        modal(`<h2>المفتاح الجديد</h2><p>${esc(r.note)}</p><pre dir="ltr" style="background:var(--bg);padding:12px;border-radius:10px;white-space:pre-wrap;word-break:break-all">${esc(r.key)}</pre><div class="row"><button class="btn p" id="cp">نسخ</button><button class="btn g" data-close>تم</button></div>`,
          (m) => { m.querySelector('#cp').onclick = () => navigator.clipboard.writeText(r.key).then(() => toast('تم النسخ')); });
        viewSuppliers(); }
    } catch (er) { toast(er.message); busy(t, false); }
  };
}

// ---------- صيّاد الأسعار ----------
async function viewHunter() {
  const d = await api('/api/hunter');
  const st = d.settings || {};
  const dt = s => s ? shortDate(String(s).slice(0, 10)) : '—';
  const main = shell('hunter', `<div class="head"><div><h1>فرص التوفير · صيّاد الأسعار</h1><p class="sub">يراقب الحجوزات القابلة للإلغاء المجاني، ويبحث عن نفس الغرفة بتكلفة أرخص عند كل الشركات. العميل يدفع نفس السعر، والفرق ربح للمكتب.</p></div><button class="btn p" id="run">افحص الآن</button></div>
    <div class="tiles">
      <div class="tile"><small>وفّر هذا الشهر</small><b style="font-size:24px;color:var(--ok)">${money(d.month.saving)}</b><small>${d.month.n} إعادة حجز</small></div>
      <div class="tile"><small>إجمالي التوفير</small><b style="font-size:24px">${money(d.total.saving)}</b><small>${d.total.n} إعادة حجز</small></div>
      <div class="tile"><small>فرص مفتوحة الآن</small><b style="font-size:24px">${d.opps.length}</b><small>${money(d.opps.reduce((a, o) => a + o.saving, 0))} توفير محتمل</small></div>
      <div class="tile"><small>حجوزات تحت المراقبة</small><b style="font-size:24px">${d.watched.length}</b><small>آخر فحص: ${d.last ? esc(new Date(d.last.at).toLocaleString('ar-KW')) : 'لم يتم بعد'}</small></div>
    </div>
    <section class="card"><h2>الفرص المفتوحة</h2>
      ${d.opps.length ? `<div class="tw"><table><thead><tr><th>رقم الحجز</th><th>العميل</th><th>الفندق</th><th>الدخول</th><th>الغرفة</th><th>التكلفة الحالية</th><th>التكلفة الجديدة</th><th>التوفير</th><th>الشركة الجديدة</th><th>الإلغاء المجاني الحالي حتى</th><th></th></tr></thead><tbody>
      ${d.opps.map(o => `<tr><td><b>${esc(o.ref)}</b></td><td>${esc(o.customer_name)}</td><td>${esc(o.hotel_name)}</td><td>${shortDate(o.checkin)}</td><td>${esc(o.room_name)} · ${esc(o.board)}</td><td>${money(o.old_cost)}</td><td>${money(o.new_cost)}</td><td><b style="color:var(--ok)">${money(o.saving)}</b></td><td>${esc(o.supplier_name)}</td><td>${dt(o.free_cancel_until)}</td>
        <td><button class="btn s p" data-rb="${o.id}">أعد الحجز</button> <button class="btn s g" data-ds="${o.id}">تجاهل</button></td></tr>${o.note ? `<tr><td colspan="11" class="muted" style="white-space:normal">${esc(o.note)}</td></tr>` : ''}`).join('')}</tbody></table></div>`
      : '<div class="empty">لا توجد فرص توفير الآن. الصياد يفحص تلقائياً، أو اضغط «افحص الآن».</div>'}</section>
    <section class="card"><h2>الإعدادات</h2><form class="row" id="hs">
      <label class="f" style="flex:0 1 200px">الحالة<select name="enabled"><option value="1" ${st.enabled ? 'selected' : ''}>يعمل تلقائياً</option><option value="" ${st.enabled ? '' : 'selected'}>موقوف</option></select></label>
      <label class="f" style="flex:0 1 200px">يفحص كل (ساعات)<input name="intervalHours" type="number" min="1" max="48" value="${st.intervalHours || 6}"></label>
      <label class="f" style="flex:0 1 220px">أقل توفير يستحق التنبيه (د.ك)<input name="minSaving" type="number" min="0" step="0.5" value="${st.minSaving ?? 5}"></label>
      <button class="btn p">حفظ</button></form>
      <p class="muted">يراقب فقط الحجوزات المؤكدة القابلة للإلغاء المجاني، ويتوقف قبل نهاية الإلغاء المجاني بـ 12 ساعة. الغرفة الجديدة لازم تكون نفس الفندق ونفس الغرفة والوجبات، وقابلة للإلغاء المجاني بعد. عند وجود فرصة جديدة يصل بريد للمدير ولمن لديه الصلاحية.</p></section>
    <section class="card"><h2>تحت المراقبة</h2>${d.watched.length ? `<div class="tw"><table><thead><tr><th>رقم الحجز</th><th>الفندق</th><th>المدينة</th><th>الدخول</th><th>التكلفة</th><th>الإلغاء المجاني حتى</th><th>آخر فحص</th></tr></thead><tbody>
      ${d.watched.map(w => `<tr><td>${esc(w.ref)}</td><td>${esc(w.hotel)}</td><td>${esc(w.city)}</td><td>${shortDate(w.checkin)}</td><td>${money(w.cost)}</td><td>${dt(w.freeCancelUntil)}</td><td>${esc(w.lastWatch || '—')}</td></tr>`).join('')}</tbody></table></div>` : '<p class="muted">لا توجد حجوزات قابلة للإلغاء المجاني حالياً.</p>'}</section>
    <section class="card"><h2>السجل</h2>${d.history.length ? `<div class="tw"><table><thead><tr><th>التاريخ</th><th>رقم الحجز</th><th>الفندق</th><th>من</th><th>إلى</th><th>التوفير</th><th>نفّذها</th><th>الحالة</th></tr></thead><tbody>
      ${d.history.map(h => `<tr><td>${esc(h.handled_at || '')}</td><td>${esc(h.ref)}</td><td>${esc(h.hotel_name)}</td><td>${esc(h.old_supplier || '')} ${h.old_locator ? `<span class="muted">(${esc(h.old_locator)})</span>` : ''}</td><td>${esc(h.supplier_name || '')} ${h.new_locator ? `<span class="muted">(${esc(h.new_locator)})</span>` : ''}</td><td>${h.status === 'dismissed' ? '—' : money(h.saving)}</td><td>${esc(h.handler || '')}</td>
        <td>${h.status === 'done' ? '<span class="pill ok">تمت</span>' : h.status === 'dismissed' ? '<span class="pill">تم التجاهل</span>' : `<span class="pill bad">ألغِ القديم يدوياً</span>`}</td></tr>${h.status === 'cancel_failed' ? `<tr><td colspan="8" class="err" style="white-space:normal">${esc(h.note)}</td></tr>` : ''}`).join('')}</tbody></table></div>` : '<p class="muted">لا يوجد سجل بعد.</p>'}</section>`);
  main.querySelector('#hs').onsubmit = async e => { e.preventDefault(); try { await api('/api/hunter/settings', { method: 'PUT', body: Object.fromEntries(new FormData(e.target)) }); toast('تم حفظ الإعدادات'); } catch (er) { toast(er.message); } };
  main.querySelector('#run').onclick = async e => { busy(e.target, true); try { const r = await api('/api/hunter/run', { method: 'POST' }); toast(r.busy ? 'الفحص شغّال حالياً' : `تم فحص ${r.checked} حجز · ${r.found} فرصة`); viewHunter(); } catch (er) { toast(er.message); busy(e.target, false); } };
  main.onclick = async e => {
    const t = e.target.closest('button'); if (!t) return;
    if (t.dataset.ds) { await api(`/api/hunter/${t.dataset.ds}/dismiss`, { method: 'POST' }); viewHunter(); }
    if (t.dataset.rb) {
      const o = d.opps.find(x => x.id === +t.dataset.rb);
      modal(`<h2>إعادة حجز ${esc(o.ref)}</h2>
        <div class="kv"><span>الفندق والغرفة</span><b>${esc(o.hotel_name)} · ${esc(o.room_name)}</b></div>
        <div class="kv"><span>التكلفة الحالية (${esc(o.old_supplier || '')})</span><b>${money(o.old_cost)}</b></div>
        <div class="kv"><span>التكلفة الجديدة (${esc(o.supplier_name)})</span><b>${money(o.new_cost)}</b></div>
        <div class="kv"><span>التوفير</span><b style="color:var(--ok)">${money(o.saving)}</b></div>
        <div class="kv"><span>سياسة الإلغاء الجديدة</span><b style="white-space:normal">${esc(o.new_cancel_policy || '')}</b></div>
        <p class="muted">النظام يتأكد من السعر من جديد، ثم يحجز الغرفة الجديدة، ولما تتأكد يلغي الحجز القديم. إذا ما تأكد الجديد يبقى الحجز الحالي كما هو. سعر البيع للعميل لا يتغير.</p>
        <div id="e"></div><div class="row"><button class="btn p" id="ok">تأكيد إعادة الحجز</button><button class="btn g" data-close>رجوع</button></div>`, (m, close) => {
        m.querySelector('#ok').onclick = async ev => {
          busy(ev.target, true);
          try { const r = await api(`/api/hunter/${o.id}/rebook`, { method: 'POST' }); close();
            toast(r.oldCancelled ? `تمت إعادة الحجز ${r.ref} · وفّرت ${money(r.saving)}` : `تم الحجز الجديد، لكن الحجز القديم لم يُلغَ. ألغه يدوياً لدى ${r.oldSupplier} (${r.oldLocator})`, 8000); viewHunter(); }
          catch (er) { m.querySelector('#e').innerHTML = `<div class="err">${esc(er.message)}</div>`; busy(ev.target, false); }
        };
      });
    }
  };
}

// ---------- الحسابات ----------
async function viewAccounts() {
  const st = can('accounts_view') ? await api('/api/accounts/settings') : null;
  const sups = can('accounts_view') ? (await api('/api/suppliers')).suppliers : [];
  const emps = (can('accounts_view') || can('bonus_edit')) ? (await api('/api/accounts/employees')).employees : [];
  const from = S.repFrom || addDays(-new Date().getDate() + 1); const to = S.repTo || addDays(0);
  const MT = { percent: 'نسبة من سعر الشركة', fixed_booking: 'مبلغ ثابت لكل حجز', fixed_night: 'مبلغ ثابت لكل ليلة' };
  const BT = { default: 'حسب العام', percent_profit: 'نسبة من الربح', fixed: 'مبلغ ثابت لكل حجز', none: 'بدون مكافأة' };
  const sel = (name, opts, v, dis) => `<select name="${name}" ${dis ? 'disabled' : ''} style="height:40px;border:1px solid var(--bd2);border-radius:10px;padding:0 10px">${Object.entries(opts).map(([k, t]) => `<option value="${k}" ${k === v ? 'selected' : ''}>${t}</option>`).join('')}</select>`;
  const num = (name, v, dis) => `<input name="${name}" type="number" step="0.001" min="0" value="${v ?? 0}" ${dis ? 'disabled' : ''} style="width:110px;height:40px;border:1px solid var(--bd2);border-radius:10px;padding:0 10px">`;
  const me = !can('margin_edit'); const be = !can('bonus_edit');
  const main = shell('accounts', `<div class="head"><div><h1>الحسابات</h1><p class="sub">للمحاسب والمدير. هامش الربح وسعر التكلفة لا يظهران للموظف العادي في أي شاشة.</p></div><span class="pill warn">للمحاسب والمدير</span></div>
    ${st ? `<section class="card"><h2>هامش الربح العام</h2><form class="row" id="mf"><label class="f" style="flex:0 1 240px">نوع الهامش${sel('type', MT, st.margin.type, me)}</label><label class="f" style="flex:0 1 160px">القيمة${num('value', st.margin.value, me)}</label>${me ? '' : '<button class="btn p">حفظ</button>'}</form>
      <p class="muted">يُضاف على سعر الشركة تلقائياً. الموظف والموقع يريان سعر البيع النهائي فقط.</p></section>
    <section class="card"><h2>هامش خاص لكل شركة</h2><div class="tw"><table><thead><tr><th>الشركة</th><th>نوع الهامش</th><th>القيمة</th><th></th></tr></thead><tbody>
      ${sups.map(s => `<tr data-sid="${s.id}"><td><b>${esc(s.name)}</b></td><td>${sel('type', { default: `حسب العام (${st.margin.type === 'percent' ? st.margin.value + '%' : st.margin.value + ' د.ك'})`, ...MT }, s.marginType, me)}</td><td>${num('value', s.marginValue, me)}</td><td>${me ? '' : '<button class="btn s" data-sm>حفظ</button>'}</td></tr>`).join('')}</tbody></table></div></section>
    <section class="card"><h2>أسعار صرف عملات الموردين إلى الدينار</h2><form class="row" id="fx">${['USD', 'EUR', 'SAR', 'AED', 'GBP', 'TRY'].map(c => `<label class="f" style="flex:0 1 140px">1 ${c} =${num(c, st.fx[c] || '', me)}</label>`).join('')}${me ? '' : '<button class="btn p">حفظ</button>'}</form>
      <p class="muted">إذا وصل سعر من الشركة بعملة غير الدينار وما لها سعر صرف هنا، ما يُعرض الخيار. حدّث الأسعار باستمرار.</p></section>` : ''}
    ${emps.length ? `<section class="card"><h2>مكافأة الموظفين</h2>${st ? `<form class="row" id="bd" style="margin-bottom:14px"><b style="align-self:center">المكافأة العامة:</b>${sel('type', { percent_profit: BT.percent_profit, fixed: BT.fixed, none: BT.none }, st.bonus.type, be)}${num('value', st.bonus.value, be)}${be ? '' : '<button class="btn s">حفظ</button>'}</form>` : ''}
      <div class="tw"><table><thead><tr><th>الموظف</th><th>الصفة</th><th>نوع المكافأة</th><th>القيمة</th><th></th></tr></thead><tbody>
      ${emps.map(u => `<tr data-uid="${u.id}"><td><b>${esc(u.name)}</b></td><td>${esc(u.role)}</td><td>${sel('type', BT, u.bonus_type || 'default', be)}</td><td>${num('value', u.bonus_value, be)}</td><td>${be ? '' : '<button class="btn s" data-sb>حفظ</button>'}</td></tr>`).join('')}</tbody></table></div>
      <p class="muted">النسبة تُحسب من ربح الحجز. الحجز الملغي لا تُحسب عليه مكافأة.</p></section>` : ''}
    ${S.user.fixed ? `<section class="card"><h2>بيانات المكتب (تظهر في القسيمة)</h2><form class="row" id="co">
      <label class="f" style="flex:2 1 260px">اسم المكتب<input name="name" value="${esc(S.company.name || '')}" required></label>
      <label class="f">الاسم بالإنجليزي<input name="nameEn" dir="ltr" value="${esc(S.company.nameEn || '')}"></label>
      <label class="f">هاتف المكتب<input name="phone" dir="ltr" value="${esc(S.company.phone || '')}"></label>
      <label class="f">بريد المكتب<input name="email" dir="ltr" value="${esc(S.company.email || '')}"></label>
      <label class="f">الموقع<input name="website" dir="ltr" value="${esc(S.company.website || '')}"></label>
      <button class="btn p">حفظ</button></form></section>` : ''}
    ${can('reports') ? `<section class="card"><div class="row" style="justify-content:space-between;margin-bottom:12px"><h2>تقرير المحاسب</h2><form class="row" id="rf"><input type="date" name="from" value="${from}" style="height:40px;border:1px solid var(--bd2);border-radius:10px;padding:0 10px"><span style="align-self:center">إلى</span><input type="date" name="to" value="${to}" style="height:40px;border:1px solid var(--bd2);border-radius:10px;padding:0 10px"><button class="btn s p" style="height:40px">عرض</button><a class="btn s" style="height:40px" id="csv">تصدير Excel</a></form></div><div id="rep"></div></section>` : ''}`);
  main.onsubmit = async e => {
    e.preventDefault(); const f = e.target;
    try {
      if (f.id === 'mf') { await api('/api/accounts/margin', { method: 'PUT', body: Object.fromEntries(new FormData(f)) }); toast('تم حفظ الهامش العام'); }
      if (f.id === 'fx') { await api('/api/accounts/fx', { method: 'PUT', body: Object.fromEntries(new FormData(f)) }); toast('تم حفظ أسعار الصرف'); }
      if (f.id === 'bd') { await api('/api/accounts/bonus', { method: 'PUT', body: Object.fromEntries(new FormData(f)) }); toast('تم حفظ المكافأة العامة'); }
      if (f.id === 'rf') { S.repFrom = f.from.value; S.repTo = f.to.value; loadRep(); }
      if (f.id === 'co') { const d = await api('/api/company', { method: 'PUT', body: Object.fromEntries(new FormData(f)) }); S.company = d.company; toast('تم حفظ بيانات المكتب'); }
    } catch (er) { toast(er.message); }
  };
  main.onclick = async e => {
    const t = e.target.closest('button'); if (!t) return; const tr = t.closest('tr'); if (!tr) return;
    const body = { type: tr.querySelector('[name=type]').value, value: tr.querySelector('[name=value]').value };
    try {
      if ('sm' in t.dataset) { await api(`/api/suppliers/${tr.dataset.sid}/margin`, { method: 'PUT', body }); toast('تم الحفظ'); }
      if ('sb' in t.dataset) { await api(`/api/accounts/bonus/${tr.dataset.uid}`, { method: 'PUT', body }); toast('تم الحفظ'); }
    } catch (er) { toast(er.message); }
  };
  async function loadRep() {
    const f = S.repFrom || from, tt = S.repTo || to;
    main.querySelector('#csv').href = `/api/accounts/report?format=csv&from=${f}&to=${tt}`;
    const { rows } = await api(`/api/accounts/report?from=${f}&to=${tt}`);
    const sum = k => rows.reduce((a, r) => a + (+r[k] || 0), 0);
    main.querySelector('#rep').innerHTML = `<div class="tw"><table><thead><tr><th>الموظف</th><th>عدد الحجوزات</th><th>المبيعات</th><th>التكلفة</th><th>الربح</th><th>المكافأة المستحقة</th><th>صافي الربح</th></tr></thead><tbody>
      ${rows.map(r => `<tr><td><b>${esc(r.name)}</b></td><td>${r.n}</td><td>${money(r.sales)}</td><td>${money(r.cost)}</td><td>${money(r.profit)}</td><td>${money(r.bonus)}</td><td>${money(r.net)}</td></tr>`).join('') || '<tr><td colspan="7" class="muted">لا توجد حجوزات في هذه الفترة</td></tr>'}
      ${rows.length ? `<tr style="font-weight:700;background:var(--bg)"><td>الإجمالي</td><td>${sum('n')}</td><td>${money(sum('sales'))}</td><td>${money(sum('cost'))}</td><td>${money(sum('profit'))}</td><td>${money(sum('bonus'))}</td><td>${money(sum('net'))}</td></tr>` : ''}</tbody></table></div><p class="muted">يشمل الحجوزات المؤكدة وبانتظار الفندق، ولا يشمل الملغاة أو الفاشلة.</p>`;
  }
  if (can('reports')) loadRep();
}

// ---------- الموظفون ----------
async function viewEmployees() {
  const { users } = await api('/api/users');
  const roles = (can('users_edit') ? (await api('/api/roles')).roles : []);
  const reqs = can('password_reset') ? (await api('/api/password-requests')).requests : null;
  const main = shell('employees', `<div class="head"><div><h1>الموظفون</h1><p class="sub">حسابات خاصة بنظام الفنادق. الرقم المدني والبريد إلزاميان لكل حساب، والرقم المدني لا يتكرر.</p></div>${can('users_edit') ? '<button class="btn p" id="add">+ إضافة موظف</button>' : ''}</div>
    ${reqs ? `<section class="card"><div class="row" style="justify-content:space-between;margin-bottom:10px"><h2>طلبات استرجاع الرقم السري</h2>${reqs.length ? `<span class="pill warn">${reqs.length} طلب جديد</span>` : ''}</div>
      ${reqs.length ? `<div class="tw"><table><thead><tr><th>الموظف</th><th>الرقم المدني المُدخل</th><th>البريد</th><th>وقت الطلب</th><th>التطابق</th><th></th></tr></thead><tbody>${reqs.map(r => `<tr><td><b>${esc(r.name)}</b></td><td>${esc(r.civil_id)}</td><td dir="ltr">${esc(r.email)}</td><td>${esc(r.created_at)}</td><td>${r.matched ? '<span class="pill ok">الرقم المدني مطابق</span>' : '<span class="pill bad">غير مطابق</span>'}</td>
        <td><button class="btn s p" data-ap="${r.id}">إرسال رقم مؤقت للبريد</button> <button class="btn s d" data-rj="${r.id}">رفض</button></td></tr>`).join('')}</tbody></table></div>` : '<p class="muted">لا توجد طلبات.</p>'}
      <p class="muted">تصل الطلبات للمدير ولكل من لديه صلاحية «إعادة الرقم السري». كل إعادة تُسجّل باسم من نفّذها ووقتها.</p></section>` : ''}
    <section class="card"><div class="row" style="justify-content:space-between;margin-bottom:10px"><h2>قائمة الموظفين</h2><input id="flt" placeholder="بحث بالاسم أو اسم المستخدم أو الرقم المدني" style="height:40px;border:1px solid var(--bd2);border-radius:10px;padding:0 12px;width:320px;max-width:100%"></div>
      <div class="tw"><table><thead><tr><th>الموظف</th><th>الرقم المدني</th><th>اسم المستخدم</th><th>البريد الإلكتروني</th><th>الصفة</th><th>الهاتف</th><th>آخر دخول</th><th>الحالة</th><th></th></tr></thead><tbody id="ub">
      ${users.map(u => `<tr data-s="${esc((u.name + ' ' + u.username + ' ' + u.civilId).toLowerCase())}"><td><b>${esc(u.name)}</b></td><td>${esc(u.civilId)}</td><td dir="ltr">${esc(u.username)}</td><td dir="ltr">${esc(u.email)}</td><td><span class="pill ${u.fixed ? 'info' : ''}">${esc(u.role)}</span></td><td dir="ltr">${esc(u.phone)}</td><td>${esc(u.lastLogin || '—')}</td>
        <td>${can('users_edit') && u.id !== S.user.id ? `<button class="chip" data-tg="${u.id}" style="${u.active ? 'background:var(--okbg);color:var(--ok);border-color:var(--ok)' : 'background:var(--badbg);color:var(--bad);border-color:var(--bad)'}">${u.active ? 'نشط · إيقاف' : 'موقوف · تفعيل'}</button>` : (u.active ? '<span class="pill ok">نشط</span>' : '<span class="pill bad">موقوف</span>')}</td>
        <td>${can('users_edit') ? `<button class="btn s g" data-ed="${u.id}">تعديل</button>` : ''} ${can('password_reset') && u.id !== S.user.id ? `<button class="btn s g" data-rp="${u.id}">رقم سري مؤقت</button>` : ''}</td></tr>`).join('')}</tbody></table></div>
      <p class="muted">الموظف الموقوف لا يستطيع الدخول، وحجوزاته السابقة تبقى محفوظة باسمه. مكافأة كل موظف تُحدد من قسم الحسابات.</p></section>`);
  main.querySelector('#flt').oninput = e => { const v = e.target.value.toLowerCase(); main.querySelectorAll('#ub tr').forEach(r => r.hidden = !r.dataset.s.includes(v)); };
  const showTemp = r => r.tempPassword ? modal(`<h2>الرقم السري المؤقت</h2><p>البريد غير مضبوط في النظام بعد، فأعطِ الموظف هذا الرقم بنفسك:</p><pre dir="ltr" style="background:var(--bg);padding:12px;border-radius:10px;font-size:18px">${esc(r.tempPassword)}</pre><button class="btn p" data-close>تم</button>`) : toast('تم إرسال الرقم المؤقت على بريد الموظف');
  const form = u => modal(`<h2>${u ? 'تعديل موظف' : 'إضافة موظف'}</h2><form id="uf" class="row">
    <label class="f" style="flex:1 1 100%">الاسم الكامل<input name="name" value="${esc(u?.name || '')}" required></label>
    <label class="f">الرقم المدني (12 رقماً)<input name="civilId" value="${esc(u?.civilId || '')}" inputmode="numeric" maxlength="12" pattern="\\d{12}" required></label>
    <label class="f">اسم المستخدم<input name="username" dir="ltr" value="${esc(u?.username || '')}" required></label>
    <label class="f">البريد الإلكتروني (لاسترجاع الرقم السري)<input name="email" type="email" dir="ltr" value="${esc(u?.email || '')}" required></label>
    <label class="f">الهاتف<input name="phone" dir="ltr" value="${esc(u?.phone || '')}"></label>
    <label class="f">الصفة (تحدد الصلاحيات)<select name="roleId">${roles.filter(r => !r.fixed || S.user.fixed).map(r => `<option value="${r.id}" ${u?.roleId === r.id ? 'selected' : ''}>${esc(r.name)}</option>`).join('')}</select></label>
    ${u ? '' : '<p class="muted" style="flex:1 1 100%;margin:0">يُنشأ رقم سري مؤقت ويُرسل لبريد الموظف، ويغيّره عند أول دخول.</p>'}
    <div id="e" style="flex:1 1 100%"></div><div class="row"><button class="btn p">حفظ</button><button type="button" class="btn g" data-close>إلغاء</button></div></form>`, (m, close) => {
    const f = m.querySelector('#uf');
    f.onsubmit = async e => { e.preventDefault();
      try { const r = await api(u ? `/api/users/${u.id}` : '/api/users', { method: u ? 'PUT' : 'POST', body: Object.fromEntries(new FormData(f)) }); close(); if (!u) showTemp(r); else toast('تم الحفظ'); viewEmployees(); }
      catch (er) { f.querySelector('#e').innerHTML = `<div class="err">${esc(er.message)}</div>`; } };
  });
  const add = main.querySelector('#add'); if (add) add.onclick = () => form(null);
  main.onclick = async e => {
    const t = e.target.closest('button'); if (!t) return;
    try {
      if (t.dataset.tg) { await api(`/api/users/${t.dataset.tg}/toggle`, { method: 'POST' }); viewEmployees(); }
      if (t.dataset.ed) form(users.find(u => u.id === +t.dataset.ed));
      if (t.dataset.rp) { busy(t, true); showTemp(await api(`/api/users/${t.dataset.rp}/reset-password`, { method: 'POST' })); busy(t, false); }
      if (t.dataset.ap) { busy(t, true); showTemp(await api(`/api/password-requests/${t.dataset.ap}/approve`, { method: 'POST' })); viewEmployees(); }
      if (t.dataset.rj) { await api(`/api/password-requests/${t.dataset.rj}/reject`, { method: 'POST' }); toast('تم رفض الطلب'); viewEmployees(); }
    } catch (er) { toast(er.message); busy(t, false); }
  };
}

// ---------- الصلاحيات ----------
async function viewPermissions() {
  const { roles, catalog } = await api('/api/roles');
  const main = shell('permissions', `<div class="head"><div><h1>الصلاحيات</h1><p class="sub">كل صفة لها صلاحيات، وكل موظف يأخذ صلاحيات صفته. المدير يرى كل شيء دائماً.</p></div><button class="btn p" id="save">حفظ الصلاحيات</button></div>
    <section class="card"><h2>صلاحيات الصفات</h2><div class="tw"><table class="perm"><thead><tr><th>الصلاحية</th>${roles.map(r => `<th>${esc(r.name)}<br><span class="muted" style="font-weight:400">${r.fixed ? 'كل شيء · ثابتة' : r.users + ' موظف'}</span>${!r.fixed && !r.users ? ` <button class="btn s g" data-del="${r.id}" aria-label="حذف الصفة" style="height:26px;padding:0 8px">×</button>` : ''}</th>`).join('')}</tr></thead><tbody>
      ${catalog.map(g => `<tr><td colspan="${roles.length + 1}" style="background:var(--bg);font-weight:700">${esc(g.group)}</td></tr>` + g.items.map(([k, t]) => `<tr><td>${esc(t)}</td>${roles.map(r => `<td><input type="checkbox" aria-label="${esc(t)} — ${esc(r.name)}" data-r="${r.id}" data-p="${k}" ${r.perms.includes(k) ? 'checked' : ''} ${r.fixed ? 'disabled' : ''}></td>`).join('')}</tr>`).join('')).join('')}
    </tbody></table></div></section>
    <section class="card"><h2>صفة مخصصة</h2><form class="row" id="nr"><label class="f" style="flex:0 1 320px">اسم الصفة الجديدة<input name="name" placeholder="مثال: مشرف حجوزات" required></label><button class="btn">+ إضافة صفة</button></form><p class="muted">الصفة الجديدة تظهر عموداً في الجدول، وتختار صلاحياتها بنفسك.</p></section>`);
  main.querySelector('#save').onclick = async () => {
    const out = roles.filter(r => !r.fixed).map(r => ({ id: r.id, perms: [...main.querySelectorAll(`input[data-r="${r.id}"]:checked`)].map(i => i.dataset.p) }));
    try { await api('/api/roles', { method: 'PUT', body: { roles: out } }); toast('تم حفظ الصلاحيات'); } catch (er) { toast(er.message); }
  };
  main.querySelector('#nr').onsubmit = async e => { e.preventDefault(); try { await api('/api/roles', { body: { name: e.target.name.value } }); viewPermissions(); } catch (er) { toast(er.message); } };
  main.onclick = async e => { const t = e.target.closest('[data-del]'); if (!t) return; try { await api('/api/roles/' + t.dataset.del, { method: 'DELETE' }); viewPermissions(); } catch (er) { toast(er.message); } };
}

// ---------- البداية ----------
(async () => {
  try { const d = await api('/api/me'); S.user = d.user; S.company = d.company || {}; } catch (e) { }
  route();
})();
