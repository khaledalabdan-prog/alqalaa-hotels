// نظام حجز الفنادق — سفريات القلعة للسياحة والسفر
const express = require('express');
const path = require('path');
const bcrypt = require('bcryptjs');
const { db, setting, setSetting, audit } = require('./db');
const { ALL_PERMS, KEYS } = require('./perms');
const { token, sha, encrypt } = require('./secret');
const { adapter, TYPES, MOCK_CITIES } = require('./suppliers');
const { r3, toKWD, price, bonusFor, marginDesc } = require('./pricing');
const mail = require('./mail');

const app = express();
app.set('trust proxy', 1);
app.use(express.json({ limit: '1mb' }));
app.use((req, res, next) => { res.set('X-Content-Type-Options', 'nosniff'); res.set('X-Frame-Options', 'DENY'); next(); });

const SESSION_DAYS = 7;
const QUOTE_MIN = 10;
const now = () => Date.now();
const nightsBetween = (a, b) => Math.max(1, Math.round((new Date(b) - new Date(a)) / 864e5));
const isDate = s => /^\d{4}-\d{2}-\d{2}$/.test(s || '');
const wrap = fn => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(e => { console.error(e); res.status(e.status || 500).json({ error: e.message || 'خطأ في الخادم' }); });
const fail = (status, msg) => Object.assign(new Error(msg), { status });

// ---------- الجلسات والصلاحيات ----------
function cookie(req, name) {
  const m = (req.headers.cookie || '').split(';').map(s => s.trim()).find(s => s.startsWith(name + '='));
  return m ? decodeURIComponent(m.slice(name.length + 1)) : null;
}
function loadUser(id) {
  const u = db.prepare('SELECT u.*, r.name role_name, r.perms role_perms, r.fixed role_fixed FROM users u JOIN roles r ON r.id=u.role_id WHERE u.id=?').get(id);
  if (!u) return null;
  u.perms = u.role_fixed ? KEYS : JSON.parse(u.role_perms || '[]');
  return u;
}
function auth(req, res, next) {
  const t = cookie(req, 'qh_session');
  if (t) {
    const s = db.prepare('SELECT * FROM sessions WHERE token=? AND expires_at>?').get(sha(t), now());
    if (s) { const u = loadUser(s.user_id); if (u && u.active) req.user = u; }
  }
  next();
}
app.use(auth);
const can = (u, p) => !!u && (u.role_fixed || u.perms.includes(p));
function need(...perms) {
  return (req, res, next) => {
    if (!req.user) return res.status(401).json({ error: 'سجّل الدخول أولاً' });
    if (req.user.must_change && !req.path.endsWith('change-password')) return res.status(403).json({ error: 'غيّر الرقم السري المؤقت أولاً', mustChange: true });
    if (perms.length && !perms.some(p => can(req.user, p))) return res.status(403).json({ error: 'ليس لديك صلاحية لهذا الإجراء' });
    next();
  };
}
const publicUser = u => ({ id: u.id, name: u.name, username: u.username, role: u.role_name, fixed: !!u.role_fixed, perms: u.perms, mustChange: !!u.must_change });

// ---------- الدخول ----------
const attempts = new Map();
app.post('/api/login', wrap(async (req, res) => {
  const ip = req.ip; const a = attempts.get(ip) || { n: 0, t: now() };
  if (now() - a.t > 15 * 60e3) { a.n = 0; a.t = now(); }
  if (a.n >= 10) throw fail(429, 'محاولات كثيرة. حاول بعد 15 دقيقة.');
  const { username, password } = req.body || {};
  const u = db.prepare('SELECT * FROM users WHERE username=?').get(String(username || '').trim());
  if (!u || !bcrypt.compareSync(String(password || ''), u.pass_hash)) { a.n++; attempts.set(ip, a); throw fail(401, 'اسم المستخدم أو الرقم السري غير صحيح'); }
  if (!u.active) throw fail(403, 'الحساب موقوف. راجع المدير.');
  attempts.delete(ip);
  const t = token();
  db.prepare('INSERT INTO sessions(token,user_id,expires_at) VALUES(?,?,?)').run(sha(t), u.id, now() + SESSION_DAYS * 864e5);
  db.prepare("UPDATE users SET last_login=datetime('now') WHERE id=?").run(u.id);
  res.set('Set-Cookie', `qh_session=${t}; HttpOnly; Path=/; SameSite=Lax; Max-Age=${SESSION_DAYS * 86400}${req.secure ? '; Secure' : ''}`);
  res.json({ user: publicUser(loadUser(u.id)) });
}));
app.post('/api/logout', (req, res) => {
  const t = cookie(req, 'qh_session'); if (t) db.prepare('DELETE FROM sessions WHERE token=?').run(sha(t));
  res.set('Set-Cookie', 'qh_session=; HttpOnly; Path=/; Max-Age=0'); res.json({ ok: true });
});
app.get('/api/me', (req, res) => res.json({ user: req.user ? publicUser(req.user) : null, company: setting('company') }));
app.post('/api/change-password', need(), wrap(async (req, res) => {
  const { current, next: nw } = req.body || {};
  if (!bcrypt.compareSync(String(current || ''), req.user.pass_hash)) throw fail(400, 'الرقم السري الحالي غير صحيح');
  if (!nw || nw.length < 8) throw fail(400, 'الرقم السري الجديد لازم يكون 8 خانات على الأقل');
  db.prepare('UPDATE users SET pass_hash=?, must_change=0 WHERE id=?').run(bcrypt.hashSync(nw, 10), req.user.id);
  audit(req.user.id, 'change_password'); res.json({ ok: true });
}));

// طلب استرجاع الرقم السري: يذهب للمدير ولمن لديه صلاحية password_reset
app.post('/api/forgot', wrap(async (req, res) => {
  const ident = String(req.body?.ident || '').trim(); const civil = String(req.body?.civilId || '').trim();
  if (!ident || !civil) throw fail(400, 'اكتب اسم المستخدم أو البريد، والرقم المدني');
  const u = db.prepare('SELECT * FROM users WHERE username=? OR lower(email)=lower(?)').get(ident, ident);
  const matched = !!(u && u.civil_id === civil);
  if (u) {
    db.prepare('INSERT INTO password_requests(user_id,ident,civil_id,matched) VALUES(?,?,?,?)').run(u.id, ident, civil, matched ? 1 : 0);
    const handlers = db.prepare('SELECT u.email, u.name, r.perms, r.fixed FROM users u JOIN roles r ON r.id=u.role_id WHERE u.active=1').all()
      .filter(h => h.fixed || JSON.parse(h.perms).includes('password_reset'));
    for (const h of handlers) mail.send(h.email, 'طلب استرجاع رقم سري — نظام الفنادق',
      `<div dir="rtl">طلب الموظف <b>${u.name}</b> (${u.username}) استرجاع الرقم السري.<br>الرقم المدني ${matched ? 'مطابق' : '<b>غير مطابق</b>'}.<br>راجع قسم الموظفين في النظام.</div>`);
  }
  // نفس الرد دائماً حتى لا يُعرف هل الحساب موجود
  res.json({ ok: true, message: 'تم إرسال طلبك. سيصلك رقم سري مؤقت على بريدك الإلكتروني بعد موافقة المسؤول.' });
}));

// ---------- بيانات عامة ----------
app.get('/api/meta', need(), (req, res) => {
  const cities = new Set(MOCK_CITIES);
  db.prepare("SELECT DISTINCT city FROM supplier_hotels s JOIN suppliers p ON p.id=s.supplier_id WHERE p.active=1 AND city<>''").all().forEach(r => cities.add(r.city));
  res.json({ cities: [...cities], perms: ALL_PERMS, supplierTypes: Object.entries(TYPES).map(([k, v]) => ({ key: k, label: v.label })), mail: mail.configured() });
});

// ---------- البحث (يدمج نتائج كل الشركات المفعّلة) ----------
function cleanQuery(b) {
  const q = { city: String(b.city || '').trim(), checkin: b.checkin, checkout: b.checkout, residence: (b.residence || 'KW').toUpperCase().slice(0, 2), nationality: b.nationality || 'كويتي', lang: 'en' };
  q.rooms = (Array.isArray(b.rooms) && b.rooms.length ? b.rooms : [{ adults: 2, children: [] }]).slice(0, 5)
    .map(r => ({ adults: Math.min(6, Math.max(1, +r.adults || 1)), children: (r.children || []).slice(0, 4).map(a => Math.min(17, Math.max(0, +a || 0))) }));
  if (!q.city) throw fail(400, 'اختر الوجهة');
  if (!isDate(q.checkin) || !isDate(q.checkout) || q.checkout <= q.checkin) throw fail(400, 'تواريخ الدخول والخروج غير صحيحة');
  if (q.checkin < new Date().toISOString().slice(0, 10)) throw fail(400, 'تاريخ الدخول في الماضي');
  return q;
}
const norm = s => String(s || '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '');
async function searchAll(q, ctx) {
  const sups = db.prepare('SELECT * FROM suppliers WHERE active=1').all();
  const nights = nightsBetween(q.checkin, q.checkout);
  const results = await Promise.allSettled(sups.map(async s => {
    const t = new Promise((_, rej) => setTimeout(() => rej(new Error('انتهت مهلة البحث')), (Math.min(8, s.timeout_sec || 8) + 2) * 1000));
    return { sup: s, hotels: await Promise.race([adapter(s).search(q), t]) };
  }));
  const map = new Map(); let ok = 0; const errors = [];
  const insQ = db.prepare('INSERT INTO quotes(token,data,user_id,api_key_id,expires_at) VALUES(?,?,?,?,?)');
  const tx = db.transaction(() => {
    results.forEach((r, i) => {
      if (r.status !== 'fulfilled') { errors.push(sups[i].id); console.error('search', sups[i].name, r.reason?.message); return; }
      ok++;
      for (const h of r.value.hotels) {
        const key = norm(h.hotelName) + '|' + norm(h.city);
        if (!map.has(key)) map.set(key, { key, name: h.hotelName, stars: h.stars, city: h.city, area: h.area, image: h.image || '', checkinTime: h.checkinTime, checkoutTime: h.checkoutTime, options: new Map() });
        const H = map.get(key);
        for (const o of h.options) {
          const kwd = toKWD(o.cost, o.currency); if (kwd == null || !(kwd > 0)) continue;
          const p = price(kwd, r.value.sup, nights, q.rooms.length);
          const okey = norm(o.roomName) + '|' + norm(o.board) + '|' + (o.refundable ? 1 : 0);
          const prev = H.options.get(okey);
          if (prev && prev.sell <= p.sell) continue;
          const tk = token(16);
          insQ.run(tk, JSON.stringify({ kind: 'option', supplierId: r.value.sup.id, optionId: o.optionId, hotelCode: h.hotelCode, q }), ctx.userId || null, ctx.apiKeyId || null, now() + 60 * 60e3);
          H.options.set(okey, { token: tk, roomName: o.roomName, board: o.board, refundable: o.refundable, cancelPolicy: o.cancelPolicy, sell: p.sell });
        }
      }
    });
  });
  tx();
  const hotels = [...map.values()].map(h => ({ ...h, options: [...h.options.values()].sort((a, b) => a.sell - b.sell) }))
    .filter(h => h.options.length).map(h => ({ ...h, from: h.options[0].sell }));
  return { hotels, nights, suppliersSearched: ok, suppliersFailed: errors.length };
}
app.post('/api/search', need('search'), wrap(async (req, res) => {
  res.json(await searchAll(cleanQuery(req.body || {}), { userId: req.user.id }));
}));

// ---------- شروط الحجز: السعر النهائي + كود صالح 10 دقائق ----------
function getQuote(tk, ctx) {
  const row = db.prepare('SELECT * FROM quotes WHERE token=?').get(String(tk || ''));
  if (!row) throw fail(404, 'انتهت صلاحية النتيجة. ابحث من جديد.');
  if ((ctx.userId && row.user_id !== ctx.userId) || (ctx.apiKeyId && row.api_key_id !== ctx.apiKeyId)) throw fail(403, 'غير مسموح');
  return { row, data: JSON.parse(row.data) };
}
async function runRules(optTk, ctx) {
  const { row, data } = getQuote(optTk, ctx);
  if (row.expires_at < now()) throw fail(410, 'انتهت صلاحية نتائج البحث. ابحث من جديد.');
  const sup = db.prepare('SELECT * FROM suppliers WHERE id=?').get(data.supplierId);
  if (!sup || !sup.active) throw fail(409, 'هذا الخيار لم يعد متاحاً');
  const r = await adapter(sup).rules(data.optionId, data.q);
  const kwd = toKWD(r.cost, r.currency); if (kwd == null) throw fail(409, 'عملة المورّد بدون سعر صرف');
  const nights = nightsBetween(data.q.checkin, data.q.checkout);
  const p = price(kwd, sup, nights, data.q.rooms.length);
  const qt = token(16);
  const exp = now() + QUOTE_MIN * 60e3;
  db.prepare('INSERT INTO quotes(token,data,user_id,api_key_id,expires_at) VALUES(?,?,?,?,?)').run(qt,
    JSON.stringify({ kind: 'rules', optionToken: optTk, supplierId: sup.id, optionId: data.optionId, hotelCode: r.hotel?.code || data.hotelCode, q: data.q, rules: r, pricing: p, costOrig: r.cost, currency: r.currency }),
    ctx.userId || null, ctx.apiKeyId || null, exp);
  return { quoteToken: qt, expiresAt: exp, nights, query: data.q, hotel: r.hotel, roomName: r.roomName, board: r.board,
    refundable: r.refundable, cancelPolicy: r.cancelPolicy, requiredFields: r.requiredFields || [], sell: p.sell };
}
app.post('/api/rules', need('book'), wrap(async (req, res) => res.json(await runRules(req.body?.token, { userId: req.user.id }))));

// ---------- الحجز ----------
function nextRef() {
  const y = new Date().getFullYear();
  const last = db.prepare("SELECT ref FROM bookings WHERE ref LIKE ? ORDER BY id DESC LIMIT 1").get(`QH-${y}-%`);
  const n = last ? +last.ref.split('-')[2] + 1 : 1;
  return `QH-${y}-${String(n).padStart(5, '0')}`;
}
async function doBook(body, ctx) {
  let { row, data } = getQuote(body.quoteToken, ctx);
  if (data.kind !== 'rules') throw fail(400, 'طلب غير صحيح');
  // إذا مرت أكثر من 10 دقائق نعيد طلب الشروط تلقائياً
  if (row.expires_at < now()) {
    const fresh = await runRules(data.optionToken, ctx);
    if (fresh.sell > data.pricing.sell) throw fail(409, `تغيّر السعر إلى ${fresh.sell} د.ك. راجع السعر الجديد ثم أكّد.`);
    ({ row, data } = getQuote(fresh.quoteToken, ctx));
  }
  const q = data.q;
  const guests = Array.isArray(body.guests) ? body.guests : [];
  const totalAdults = q.rooms.reduce((a, r) => a + r.adults, 0);
  const clean = guests.slice(0, totalAdults).map(g => ({ first: String(g.first || '').trim().slice(0, 40), last: String(g.last || '').trim().slice(0, 40) }));
  if (clean.length < totalAdults || clean.some(g => !g.first || !g.last)) throw fail(400, 'اكتب الاسم الأول واسم العائلة لكل النزلاء البالغين (كما في الجواز)');
  const customer = { name: String(body.customerName || '').trim(), phone: String(body.customerPhone || '').trim(), email: String(body.customerEmail || '').trim() };
  if (!customer.name || !customer.phone) throw fail(400, 'اكتب اسم العميل وهاتفه');
  const guestsByRoom = []; let gi = 0; q.rooms.forEach(r => { guestsByRoom.push(clean.slice(gi, gi + r.adults)); gi += r.adults; });
  const sup = db.prepare('SELECT * FROM suppliers WHERE id=?').get(data.supplierId);
  const user = ctx.userId ? db.prepare('SELECT * FROM users WHERE id=?').get(ctx.userId) : null;
  const ref = nextRef();
  const p = data.pricing; const r = data.rules;
  const bonus = user ? bonusFor(user, p.margin) : { bonus: 0, desc: 'حجز من الموقع' };
  const nights = nightsBetween(q.checkin, q.checkout);
  const ins = db.prepare(`INSERT INTO bookings(ref,user_id,source,api_key_id,supplier_id,supplier_name,status,hotel_code,hotel_name,hotel_stars,hotel_address,hotel_city,hotel_phone,
    checkin,checkout,nights,checkin_time,checkout_time,room_name,board,rooms_json,guests_json,nationality,cancel_policy,refundable,customer_name,customer_phone,customer_email,notes,collection,
    cost,margin,sell,margin_desc,bonus,bonus_desc) VALUES(?,?,?,?,?,?,'processing',?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
    ref, user?.id || null, ctx.apiKeyId ? 'website' : 'staff', ctx.apiKeyId || null, sup.id, sup.name, data.hotelCode, r.hotel?.name, r.hotel?.stars, r.hotel?.address, r.hotel?.city || q.city, r.hotel?.phone || '',
    q.checkin, q.checkout, nights, r.hotel?.checkinTime || '', r.hotel?.checkoutTime || '', r.roomName, r.board, JSON.stringify(q.rooms), JSON.stringify(clean), q.nationality, r.cancelPolicy, r.refundable ? 1 : 0,
    customer.name, customer.phone, customer.email, String(body.notes || '').slice(0, 500), String(body.collection || ''), p.cost, p.margin, p.sell, p.marginDesc, bonus.bonus, bonus.desc);
  const id = ins.lastInsertRowid;
  db.prepare('DELETE FROM quotes WHERE token=?').run(row.token);
  let result;
  try {
    result = await adapter(sup).book(r.bookingCode, { ref, rooms: q.rooms, guestsByRoom, checkin: q.checkin, checkout: q.checkout, hotelCode: data.hotelCode, cost: data.costOrig, currency: data.currency, notes: body.notes, lang: q.lang });
  } catch (e) {
    result = { status: 'failed', raw: e.message };
  }
  const log = [{ at: new Date().toISOString(), action: 'book', status: result.status, raw: result.raw }];
  db.prepare('UPDATE bookings SET status=?, supplier_status=?, supplier_locator=?, hotel_conf=?, log=? WHERE id=?')
    .run(result.status, String(result.raw || ''), result.locator || null, result.hotelConf || null, JSON.stringify(log), id);
  if (result.xml) audit(ctx.userId, 'supplier_xml', { ref, ...result.xml });
  audit(ctx.userId, 'book', { ref, status: result.status });
  return db.prepare('SELECT * FROM bookings WHERE id=?').get(id);
}
function shapeBooking(b, u, opts = {}) {
  const out = {
    id: b.id, ref: b.ref, createdAt: b.created_at, status: b.status, source: b.source,
    hotel: { name: b.hotel_name, stars: b.hotel_stars, address: b.hotel_address, city: b.hotel_city, phone: b.hotel_phone, checkinTime: b.checkin_time, checkoutTime: b.checkout_time },
    checkin: b.checkin, checkout: b.checkout, nights: b.nights, roomName: b.room_name, board: b.board,
    rooms: JSON.parse(b.rooms_json || '[]'), guests: JSON.parse(b.guests_json || '[]'), nationality: b.nationality,
    cancelPolicy: b.cancel_policy, refundable: !!b.refundable, hotelConf: b.hotel_conf,
    customer: { name: b.customer_name, phone: b.customer_phone, email: b.customer_email }, notes: b.notes, collection: b.collection,
    sell: b.sell, employee: b.user_id ? db.prepare('SELECT name FROM users WHERE id=?').get(b.user_id)?.name : (b.source === 'website' ? 'الموقع الإلكتروني' : ''),
    cancelledAt: b.cancelled_at,
  };
  const done = ['confirmed', 'pending', 'cancelled'].includes(b.status);
  if (opts.api) return out;
  if (can(u, 'supplier_view') && done) Object.assign(out, { supplier: b.supplier_name, locator: b.supplier_locator, supplierStatus: b.supplier_status });
  if (can(u, 'accounts_view')) Object.assign(out, { supplier: b.supplier_name, locator: b.supplier_locator, supplierStatus: b.supplier_status, cost: b.cost, margin: b.margin, marginDesc: b.margin_desc, bonus: b.bonus, bonusDesc: b.bonus_desc, net: r3(b.margin - b.bonus) });
  return out;
}
app.post('/api/book', need('book'), wrap(async (req, res) => res.json({ booking: shapeBooking(await doBook(req.body || {}, { userId: req.user.id }), req.user) })));

function bookingFilter(req, skipStatus) {
  const w = []; const p = [];
  if (!can(req.user, 'bookings_all')) { w.push('b.user_id=?'); p.push(req.user.id); }
  const { q, status, from, to, dateType, user, city } = req.query;
  if (q) { w.push('(b.ref LIKE ? OR b.customer_name LIKE ? OR b.customer_phone LIKE ? OR b.guests_json LIKE ? OR b.hotel_name LIKE ?)'); const like = `%${q}%`; p.push(like, like, like, like, like); }
  if (status && !skipStatus) { w.push('b.status=?'); p.push(status); }
  const col = dateType === 'checkin' ? 'b.checkin' : 'date(b.created_at)';
  if (isDate(from)) { w.push(`${col}>=?`); p.push(from); }
  if (isDate(to)) { w.push(`${col}<=?`); p.push(to); }
  if (user && can(req.user, 'bookings_all')) { w.push('b.user_id=?'); p.push(+user); }
  if (city) { w.push('(b.hotel_city LIKE ? OR b.hotel_name LIKE ?)'); p.push(`%${city}%`, `%${city}%`); }
  return { where: w.length ? 'WHERE ' + w.join(' AND ') : '', params: p };
}
app.get('/api/bookings', need('bookings_own', 'bookings_all'), (req, res) => {
  const { where, params } = bookingFilter(req);
  const size = Math.min(100, +req.query.size || 20); const page = Math.max(1, +req.query.page || 1);
  const total = db.prepare(`SELECT COUNT(*) c FROM bookings b ${where}`).get(...params).c;
  const cf = bookingFilter(req, true);
  const counts = Object.fromEntries(db.prepare(`SELECT status, COUNT(*) c FROM bookings b ${cf.where} GROUP BY status`).all(...cf.params).map(r => [r.status, r.c]));
  const rows = db.prepare(`SELECT b.* FROM bookings b ${where} ORDER BY b.id DESC LIMIT ? OFFSET ?`).all(...params, size, (page - 1) * size);
  res.json({ total, page, size, counts, bookings: rows.map(b => shapeBooking(b, req.user)) });
});
function ownBooking(req) {
  const b = db.prepare('SELECT * FROM bookings WHERE id=?').get(+req.params.id);
  if (!b) throw fail(404, 'الحجز غير موجود');
  if (!can(req.user, 'bookings_all') && b.user_id !== req.user.id) throw fail(403, 'هذا الحجز ليس لك');
  return b;
}
app.get('/api/bookings/:id', need('bookings_own', 'bookings_all'), wrap(async (req, res) => res.json({ booking: shapeBooking(ownBooking(req), req.user) })));
async function supplierAction(b, action, userId) {
  if (!b.supplier_locator) throw fail(400, 'لا يوجد رقم حجز لدى الشركة');
  const sup = db.prepare('SELECT * FROM suppliers WHERE id=?').get(b.supplier_id);
  const r = await adapter(sup)[action](b.supplier_locator);
  const log = JSON.parse(b.log || '[]'); log.push({ at: new Date().toISOString(), action, status: r.status, raw: r.raw, by: userId });
  db.prepare(`UPDATE bookings SET status=?, supplier_status=?, log=? ${r.status === 'cancelled' ? ", cancelled_at=datetime('now')" : ''} WHERE id=?`).run(r.status, String(r.raw || ''), JSON.stringify(log), b.id);
  audit(userId, action, { ref: b.ref, status: r.status });
  return db.prepare('SELECT * FROM bookings WHERE id=?').get(b.id);
}
app.post('/api/bookings/:id/read', need('bookings_own', 'bookings_all'), wrap(async (req, res) => res.json({ booking: shapeBooking(await supplierAction(ownBooking(req), 'read', req.user.id), req.user) })));
app.post('/api/bookings/:id/cancel', need('cancel'), wrap(async (req, res) => {
  const b = ownBooking(req); if (b.status === 'cancelled') throw fail(400, 'الحجز ملغي مسبقاً');
  res.json({ booking: shapeBooking(await supplierAction(b, 'cancel', req.user.id), req.user) });
}));
app.post('/api/bookings/:id/email', need('voucher'), wrap(async (req, res) => {
  const b = shapeBooking(ownBooking(req), req.user, { api: true });
  if (!b.customer.email) throw fail(400, 'لا يوجد بريد للعميل');
  const ok = await mail.send(b.customer.email, `قسيمة حجز فندق ${b.ref}`, voucherEmail(b));
  if (!ok) throw fail(400, 'البريد غير مضبوط في النظام بعد (SMTP)');
  res.json({ ok: true });
}));
function voucherEmail(b) {
  const c = setting('company');
  return `<div dir="rtl" style="font-family:Tahoma,Arial">
  <h2>${c.name} — قسيمة حجز فندق</h2><p>رقم الحجز: <b>${b.ref}</b> · رقم تأكيد الفندق: ${b.hotelConf || '—'}</p>
  <p><b>${b.hotel.name}</b> ${b.hotel.stars ? '· ' + b.hotel.stars + ' نجوم' : ''}<br>${b.hotel.address || ''}</p>
  <p>الدخول: ${b.checkin} ${b.hotel.checkinTime ? 'من ' + b.hotel.checkinTime : ''}<br>الخروج: ${b.checkout} ${b.hotel.checkoutTime ? 'حتى ' + b.hotel.checkoutTime : ''} · ${b.nights} ليالٍ</p>
  <p>الغرفة: ${b.roomName} · ${b.board}<br>النزلاء: ${b.guests.map(g => g.first + ' ' + g.last).join('، ')}</p>
  <p>سياسة الإلغاء: ${b.cancelPolicy}</p><p>للاستفسار: ${c.phone || ''} ${c.email || ''}</p></div>`;
}

// ---------- الشركات الموردة ----------
const shapeSup = (s, u) => ({ id: s.id, name: s.name, type: s.type, typeLabel: TYPES[s.type]?.label, env: s.env, endpoint: s.endpoint, username: s.username, hasPassword: !!s.password_enc,
  timeoutSec: s.timeout_sec, active: !!s.active, lastTest: s.last_test, lastTestOk: s.last_test_ok,
  hotels: db.prepare('SELECT COUNT(*) c FROM supplier_hotels WHERE supplier_id=?').get(s.id).c,
  bookings: db.prepare('SELECT COUNT(*) c FROM bookings WHERE supplier_id=?').get(s.id).c,
  ...(can(u, 'accounts_view') ? { marginType: s.margin_type, marginValue: s.margin_value } : {}) });
app.get('/api/suppliers', need('suppliers_view', 'accounts_view'), (req, res) => res.json({ suppliers: db.prepare('SELECT * FROM suppliers ORDER BY id').all().map(s => shapeSup(s, req.user)) }));
app.post('/api/suppliers', need('suppliers_edit'), wrap(async (req, res) => {
  const b = req.body || {}; if (!b.name || !TYPES[b.type]) throw fail(400, 'اكتب اسم الشركة واختر نوع الربط');
  const r = db.prepare('INSERT INTO suppliers(name,type,env,endpoint,username,password_enc,timeout_sec,active) VALUES(?,?,?,?,?,?,?,0)')
    .run(b.name.trim(), b.type, b.env || 'uat', b.endpoint || '', b.username || '', encrypt(b.password || ''), Math.min(8, Math.max(1, +b.timeoutSec || 8)));
  audit(req.user.id, 'supplier_add', { id: r.lastInsertRowid, name: b.name }); res.json({ id: r.lastInsertRowid });
}));
app.put('/api/suppliers/:id', need('suppliers_edit'), wrap(async (req, res) => {
  const s = db.prepare('SELECT * FROM suppliers WHERE id=?').get(+req.params.id); if (!s) throw fail(404, 'غير موجودة');
  const b = req.body || {};
  db.prepare('UPDATE suppliers SET name=?, env=?, endpoint=?, username=?, password_enc=?, timeout_sec=? WHERE id=?').run(
    (b.name || s.name).trim(), b.env || s.env, b.endpoint ?? s.endpoint, b.username ?? s.username, b.password ? encrypt(b.password) : s.password_enc, Math.min(8, Math.max(1, +b.timeoutSec || s.timeout_sec)), s.id);
  audit(req.user.id, 'supplier_edit', { id: s.id }); res.json({ ok: true });
}));
app.put('/api/suppliers/:id/margin', need('margin_edit'), wrap(async (req, res) => {
  const t = req.body?.type; if (!['default', 'percent', 'fixed_booking', 'fixed_night'].includes(t)) throw fail(400, 'نوع غير صحيح');
  db.prepare('UPDATE suppliers SET margin_type=?, margin_value=? WHERE id=?').run(t, Math.max(0, +req.body.value || 0), +req.params.id);
  audit(req.user.id, 'supplier_margin', { id: +req.params.id, ...req.body }); res.json({ ok: true });
}));
app.post('/api/suppliers/:id/toggle', need('suppliers_toggle'), wrap(async (req, res) => {
  const s = db.prepare('SELECT * FROM suppliers WHERE id=?').get(+req.params.id); if (!s) throw fail(404, 'غير موجودة');
  db.prepare('UPDATE suppliers SET active=? WHERE id=?').run(s.active ? 0 : 1, s.id);
  audit(req.user.id, s.active ? 'supplier_suspend' : 'supplier_activate', { id: s.id }); res.json({ active: !s.active });
}));
app.post('/api/suppliers/:id/test', need('suppliers_edit'), wrap(async (req, res) => {
  const s = db.prepare('SELECT * FROM suppliers WHERE id=?').get(+req.params.id); if (!s) throw fail(404, 'غير موجودة');
  let r; try { r = await adapter(s).test(); } catch (e) { r = { ok: false, message: e.message }; }
  db.prepare("UPDATE suppliers SET last_test=datetime('now'), last_test_ok=? WHERE id=?").run(r.ok ? 1 : 0, s.id);
  res.json(r);
}));
app.post('/api/suppliers/:id/sync', need('suppliers_edit'), wrap(async (req, res) => {
  const s = db.prepare('SELECT * FROM suppliers WHERE id=?').get(+req.params.id); const a = adapter(s);
  if (!a.syncHotels) return res.json({ ok: true, message: 'هذا المورّد لا يحتاج تحديث قائمة الفنادق' });
  const r = await a.syncHotels(); res.json({ ok: true, message: `تم تحديث ${r.count} فندق` });
}));

// ---------- الحسابات ----------
app.get('/api/accounts/settings', need('accounts_view'), (req, res) => res.json({ margin: setting('margin'), bonus: setting('bonus'), fx: setting('fx', {}) }));
app.put('/api/accounts/margin', need('margin_edit'), wrap(async (req, res) => {
  const { type, value } = req.body || {}; if (!['percent', 'fixed_booking', 'fixed_night'].includes(type)) throw fail(400, 'نوع غير صحيح');
  setSetting('margin', { type, value: Math.max(0, +value || 0) }); audit(req.user.id, 'margin', req.body); res.json({ ok: true });
}));
app.put('/api/accounts/fx', need('margin_edit'), wrap(async (req, res) => {
  const fx = {}; for (const [k, v] of Object.entries(req.body || {})) if (/^[A-Z]{3}$/.test(k) && +v > 0) fx[k] = +v;
  setSetting('fx', fx); audit(req.user.id, 'fx', fx); res.json({ ok: true });
}));
app.put('/api/accounts/bonus', need('bonus_edit'), wrap(async (req, res) => {
  const { type, value } = req.body || {}; if (!['percent_profit', 'fixed', 'none'].includes(type)) throw fail(400, 'نوع غير صحيح');
  setSetting('bonus', { type, value: Math.max(0, +value || 0) }); audit(req.user.id, 'bonus_default', req.body); res.json({ ok: true });
}));
app.put('/api/accounts/bonus/:userId', need('bonus_edit'), wrap(async (req, res) => {
  const { type, value } = req.body || {}; if (!['default', 'percent_profit', 'fixed', 'none'].includes(type)) throw fail(400, 'نوع غير صحيح');
  db.prepare('UPDATE users SET bonus_type=?, bonus_value=? WHERE id=?').run(type, Math.max(0, +value || 0), +req.params.userId);
  audit(req.user.id, 'bonus_user', { userId: +req.params.userId, ...req.body }); res.json({ ok: true });
}));
app.get('/api/accounts/employees', need('accounts_view', 'bonus_edit'), (req, res) => {
  res.json({ employees: db.prepare('SELECT u.id,u.name,u.bonus_type,u.bonus_value,r.name role FROM users u JOIN roles r ON r.id=u.role_id ORDER BY u.name').all() });
});
function report(from, to) {
  return db.prepare(`SELECT COALESCE(u.name, 'الموقع الإلكتروني') name, COUNT(*) n, SUM(b.sell) sales, SUM(b.cost) cost, SUM(b.margin) profit, SUM(b.bonus) bonus
    FROM bookings b LEFT JOIN users u ON u.id=b.user_id
    WHERE b.status IN ('confirmed','pending') AND date(b.created_at) BETWEEN ? AND ? GROUP BY b.user_id ORDER BY sales DESC`).all(from, to)
    .map(r => ({ ...r, sales: r3(r.sales), cost: r3(r.cost), profit: r3(r.profit), bonus: r3(r.bonus), net: r3(r.profit - r.bonus) }));
}
app.get('/api/accounts/report', need('reports'), (req, res) => {
  const from = isDate(req.query.from) ? req.query.from : '2000-01-01'; const to = isDate(req.query.to) ? req.query.to : '2999-12-31';
  const rows = report(from, to);
  if (req.query.format === 'csv') {
    const lines = [['الموظف', 'عدد الحجوزات', 'المبيعات', 'التكلفة', 'الربح', 'المكافأة', 'صافي الربح'], ...rows.map(r => [r.name, r.n, r.sales, r.cost, r.profit, r.bonus, r.net])];
    res.set('Content-Type', 'text/csv; charset=utf-8'); res.set('Content-Disposition', `attachment; filename="report-${from}-${to}.csv"`);
    return res.send('﻿' + lines.map(l => l.map(v => `"${String(v ?? '').replace(/"/g, '""')}"`).join(',')).join('\n'));
  }
  res.json({ rows });
});

// ---------- الموظفون ----------
const shapeUser = u => ({ id: u.id, name: u.name, username: u.username, civilId: u.civil_id, email: u.email, phone: u.phone, roleId: u.role_id, role: u.role_name, active: !!u.active, lastLogin: u.last_login, fixed: !!u.role_fixed });
app.get('/api/users', need('users_view', 'users_edit', 'password_reset'), (req, res) => res.json({ users: db.prepare('SELECT u.*, r.name role_name, r.fixed role_fixed FROM users u JOIN roles r ON r.id=u.role_id ORDER BY u.id').all().map(shapeUser) }));
function validUser(b, id) {
  const civil = String(b.civilId || '').trim(); const email = String(b.email || '').trim();
  if (!b.name || !b.username) throw fail(400, 'اكتب الاسم واسم المستخدم');
  if (!/^\d{12}$/.test(civil)) throw fail(400, 'الرقم المدني لازم يكون 12 رقماً');
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw fail(400, 'البريد الإلكتروني غير صحيح');
  if (db.prepare('SELECT id FROM users WHERE civil_id=? AND id<>?').get(civil, id || 0)) throw fail(400, 'الرقم المدني مسجّل لموظف آخر');
  if (db.prepare('SELECT id FROM users WHERE username=? AND id<>?').get(b.username.trim(), id || 0)) throw fail(400, 'اسم المستخدم مستخدم');
  if (!db.prepare('SELECT id FROM roles WHERE id=?').get(+b.roleId)) throw fail(400, 'اختر الصفة');
  return { civil, email };
}
const tempPass = () => 'Qh' + token(4) + '!';
app.post('/api/users', need('users_edit'), wrap(async (req, res) => {
  const b = req.body || {}; const { civil, email } = validUser(b);
  const role = db.prepare('SELECT * FROM roles WHERE id=?').get(+b.roleId);
  if (role.fixed && !req.user.role_fixed) throw fail(403, 'فقط المدير يضيف مديراً');
  const pass = b.password && b.password.length >= 8 ? b.password : tempPass();
  const r = db.prepare('INSERT INTO users(name,username,civil_id,email,phone,role_id,pass_hash,must_change) VALUES(?,?,?,?,?,?,?,1)')
    .run(b.name.trim(), b.username.trim(), civil, email, String(b.phone || ''), role.id, bcrypt.hashSync(pass, 10));
  const sent = await mail.send(email, 'حسابك في نظام حجز الفنادق', `<div dir="rtl">مرحباً ${b.name}،<br>اسم المستخدم: <b>${b.username}</b><br>الرقم السري المؤقت: <b>${pass}</b><br>غيّره عند أول دخول.</div>`);
  audit(req.user.id, 'user_add', { id: r.lastInsertRowid }); res.json({ id: r.lastInsertRowid, tempPassword: sent ? null : pass, emailed: sent });
}));
app.put('/api/users/:id', need('users_edit'), wrap(async (req, res) => {
  const u = loadUser(+req.params.id); if (!u) throw fail(404, 'غير موجود');
  if (u.role_fixed && !req.user.role_fixed) throw fail(403, 'لا يمكنك تعديل حساب المدير');
  const b = { ...shapeUser(u), ...req.body }; const { civil, email } = validUser(b, u.id);
  const role = db.prepare('SELECT * FROM roles WHERE id=?').get(+b.roleId);
  if (role.fixed && !req.user.role_fixed) throw fail(403, 'فقط المدير يعيّن مديراً');
  if (u.role_fixed && !role.fixed && db.prepare('SELECT COUNT(*) c FROM users u JOIN roles r ON r.id=u.role_id WHERE r.fixed=1 AND u.active=1').get().c <= 1) throw fail(400, 'لازم يبقى مدير واحد على الأقل');
  db.prepare('UPDATE users SET name=?, username=?, civil_id=?, email=?, phone=?, role_id=? WHERE id=?').run(b.name.trim(), b.username.trim(), civil, email, String(b.phone || ''), role.id, u.id);
  audit(req.user.id, 'user_edit', { id: u.id }); res.json({ ok: true });
}));
app.post('/api/users/:id/toggle', need('users_edit'), wrap(async (req, res) => {
  const u = loadUser(+req.params.id); if (!u) throw fail(404, 'غير موجود');
  if (u.id === req.user.id) throw fail(400, 'لا يمكنك إيقاف حسابك');
  if (u.role_fixed && !req.user.role_fixed) throw fail(403, 'لا يمكنك إيقاف المدير');
  db.prepare('UPDATE users SET active=? WHERE id=?').run(u.active ? 0 : 1, u.id);
  if (u.active) db.prepare('DELETE FROM sessions WHERE user_id=?').run(u.id);
  audit(req.user.id, u.active ? 'user_suspend' : 'user_activate', { id: u.id }); res.json({ active: !u.active });
}));
async function resetPassword(u, byId) {
  const pass = tempPass();
  db.prepare('UPDATE users SET pass_hash=?, must_change=1 WHERE id=?').run(bcrypt.hashSync(pass, 10), u.id);
  db.prepare('DELETE FROM sessions WHERE user_id=?').run(u.id);
  const sent = await mail.send(u.email, 'رقم سري مؤقت — نظام حجز الفنادق', `<div dir="rtl">مرحباً ${u.name}،<br>الرقم السري المؤقت: <b>${pass}</b><br>يُطلب منك تغييره عند الدخول.</div>`);
  audit(byId, 'password_reset', { userId: u.id, emailed: sent });
  return { emailed: sent, tempPassword: sent ? null : pass };
}
app.post('/api/users/:id/reset-password', need('password_reset'), wrap(async (req, res) => {
  const u = loadUser(+req.params.id); if (!u) throw fail(404, 'غير موجود');
  if (u.role_fixed && !req.user.role_fixed) throw fail(403, 'لا يمكنك إعادة رقم المدير');
  res.json(await resetPassword(u, req.user.id));
}));
app.get('/api/password-requests', need('password_reset'), (req, res) => res.json({ requests: db.prepare(`SELECT p.*, u.name, u.email, u.civil_id ucivil FROM password_requests p JOIN users u ON u.id=p.user_id WHERE p.status='pending' ORDER BY p.id DESC`).all() }));
app.post('/api/password-requests/:id/:action', need('password_reset'), wrap(async (req, res) => {
  const p = db.prepare("SELECT * FROM password_requests WHERE id=? AND status='pending'").get(+req.params.id); if (!p) throw fail(404, 'الطلب غير موجود');
  let out = { ok: true };
  if (req.params.action === 'approve') {
    const u = loadUser(p.user_id); if (u.role_fixed && !req.user.role_fixed) throw fail(403, 'لا يمكنك إعادة رقم المدير');
    out = await resetPassword(u, req.user.id);
  } else if (req.params.action !== 'reject') throw fail(400, 'إجراء غير صحيح');
  db.prepare("UPDATE password_requests SET status=?, handled_by=?, handled_at=datetime('now') WHERE id=?").run(req.params.action === 'approve' ? 'approved' : 'rejected', req.user.id, p.id);
  res.json(out);
}));

// ---------- الصفات والصلاحيات ----------
app.get('/api/roles', need('roles_edit', 'users_view', 'users_edit'), (req, res) => res.json({ roles: db.prepare('SELECT r.*, (SELECT COUNT(*) FROM users u WHERE u.role_id=r.id) users FROM roles r ORDER BY r.fixed DESC, r.id').all().map(r => ({ id: r.id, name: r.name, fixed: !!r.fixed, users: r.users, perms: r.fixed ? KEYS : JSON.parse(r.perms) })), catalog: ALL_PERMS }));
app.post('/api/roles', need('roles_edit'), wrap(async (req, res) => {
  const name = String(req.body?.name || '').trim(); if (!name) throw fail(400, 'اكتب اسم الصفة');
  if (db.prepare('SELECT id FROM roles WHERE name=?').get(name)) throw fail(400, 'الصفة موجودة');
  const r = db.prepare("INSERT INTO roles(name,perms) VALUES(?,'[]')").run(name); audit(req.user.id, 'role_add', { name }); res.json({ id: r.lastInsertRowid });
}));
app.put('/api/roles', need('roles_edit'), wrap(async (req, res) => {
  const upd = db.prepare('UPDATE roles SET perms=? WHERE id=? AND fixed=0');
  db.transaction(() => { for (const r of req.body?.roles || []) upd.run(JSON.stringify((r.perms || []).filter(p => KEYS.includes(p))), +r.id); })();
  audit(req.user.id, 'roles_edit', {}); res.json({ ok: true });
}));
app.delete('/api/roles/:id', need('roles_edit'), wrap(async (req, res) => {
  const r = db.prepare('SELECT * FROM roles WHERE id=?').get(+req.params.id); if (!r || r.fixed) throw fail(400, 'لا يمكن حذف هذه الصفة');
  if (db.prepare('SELECT COUNT(*) c FROM users WHERE role_id=?').get(r.id).c) throw fail(400, 'الصفة مستخدمة لموظفين، انقلهم لصفة ثانية أولاً');
  db.prepare('DELETE FROM roles WHERE id=?').run(r.id); res.json({ ok: true });
}));

// ---------- مفاتيح API للموقع ----------
app.get('/api/api-keys', need('api_keys'), (req, res) => res.json({ keys: db.prepare('SELECT id,name,key_tail,active,created_at FROM api_keys ORDER BY id DESC').all() }));
app.post('/api/api-keys', need('api_keys'), wrap(async (req, res) => {
  const name = String(req.body?.name || '').trim() || 'alqalaatravels.net';
  const key = 'qh_live_' + token(24);
  db.prepare('INSERT INTO api_keys(name,key_hash,key_tail) VALUES(?,?,?)').run(name, sha(key), key.slice(-4));
  audit(req.user.id, 'api_key_add', { name }); res.json({ key, note: 'انسخ المفتاح الآن، لن يظهر مرة أخرى' });
}));
app.post('/api/api-keys/:id/toggle', need('api_keys'), wrap(async (req, res) => {
  db.prepare('UPDATE api_keys SET active=1-active WHERE id=?').run(+req.params.id); res.json({ ok: true });
}));

// ---------- API للموقع (بمفتاح X-API-Key) — سعر البيع فقط، بدون اسم الشركة ----------
const v1 = express.Router();
v1.use((req, res, next) => {
  const k = req.get('X-API-Key'); const row = k && db.prepare('SELECT * FROM api_keys WHERE key_hash=? AND active=1').get(sha(k));
  if (!row) return res.status(401).json({ error: 'invalid api key' });
  req.apiKeyId = row.id; next();
});
v1.post('/hotels/search', wrap(async (req, res) => res.json(await searchAll(cleanQuery(req.body || {}), { apiKeyId: req.apiKeyId }))));
v1.post('/hotels/rules', wrap(async (req, res) => res.json(await runRules(req.body?.token, { apiKeyId: req.apiKeyId }))));
v1.post('/hotels/book', wrap(async (req, res) => res.json({ booking: shapeBooking(await doBook(req.body || {}, { apiKeyId: req.apiKeyId }), null, { api: true }) })));
v1.get('/bookings/:ref', wrap(async (req, res) => {
  const b = db.prepare('SELECT * FROM bookings WHERE ref=? AND api_key_id=?').get(req.params.ref, req.apiKeyId); if (!b) throw fail(404, 'not found');
  res.json({ booking: shapeBooking(b, null, { api: true }) });
}));
v1.post('/bookings/:ref/cancel', wrap(async (req, res) => {
  const b = db.prepare('SELECT * FROM bookings WHERE ref=? AND api_key_id=?').get(req.params.ref, req.apiKeyId); if (!b) throw fail(404, 'not found');
  res.json({ booking: shapeBooking(await supplierAction(b, 'cancel', null), null, { api: true }) });
}));
app.use('/api/v1', v1);

// ---------- الواجهة ----------
app.use(express.static(path.join(__dirname, '..', 'public'), { index: 'index.html', maxAge: '1h' }));
app.get(/^\/(?!api).*/, (req, res) => res.sendFile(path.join(__dirname, '..', 'public', 'index.html')));

// تنظيف دوري للجلسات والعروض المنتهية
setInterval(() => { db.prepare('DELETE FROM sessions WHERE expires_at<?').run(now()); db.prepare('DELETE FROM quotes WHERE expires_at<?').run(now() - 3600e3); }, 30 * 60e3).unref();

module.exports = app;
