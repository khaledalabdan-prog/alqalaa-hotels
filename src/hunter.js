// صيّاد الأسعار: يراقب الحجوزات القابلة للإلغاء المجاني، ويبحث عن نفس الغرفة بسعر تكلفة أرخص
// عند كل الشركات المفعّلة. إذا وُجد توفير يستاهل، تظهر «فرصة توفير» للمحاسب والمدير.
// إعادة الحجز: نحجز الجديد أولاً، ولما يتأكد نلغي القديم، فالعميل لا يبقى بدون غرفة.
const { db, setting, setSetting, audit } = require('./db');
const { adapter } = require('./suppliers');
const { r3, toKWD } = require('./pricing');
const mail = require('./mail');

const SAFETY_MS = 12 * 3600e3; // هامش أمان قبل نهاية الإلغاء المجاني
const norm = s => String(s || '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '');
const now = () => Date.now();
const parseUntil = s => { if (!s) return null; const t = Date.parse(s.length === 10 ? s + 'T00:00:00' : s); return isNaN(t) ? null : t; };

function bookingQuery(b) {
  if (b.query_json) { try { return JSON.parse(b.query_json); } catch (e) { } }
  return { city: b.hotel_city, checkin: b.checkin, checkout: b.checkout, rooms: JSON.parse(b.rooms_json || '[]'), residence: b.residence || 'KW', nationality: b.nationality, lang: 'en' };
}
function watchable(b) {
  const until = parseUntil(b.free_cancel_until);
  return b.status === 'confirmed' && b.refundable && until && until - SAFETY_MS > now() && b.checkin > new Date().toISOString().slice(0, 10);
}
function watchedList() {
  return db.prepare("SELECT * FROM bookings WHERE status='confirmed' AND refundable=1 AND free_cancel_until IS NOT NULL ORDER BY checkin").all().filter(watchable);
}

// يبحث عند كل الشركات عن نفس الفندق والغرفة والوجبات (قابلة للإلغاء)، ويرجع أرخص تكلفة
async function bestOffer(b) {
  const q = bookingQuery(b);
  const sups = db.prepare('SELECT * FROM suppliers WHERE active=1').all();
  const hk = norm(b.hotel_name), rk = norm(b.room_name), bk = norm(b.board);
  let best = null;
  await Promise.all(sups.map(async s => {
    try {
      const hotels = await Promise.race([adapter(s).search(q), new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), (Math.min(8, s.timeout_sec || 8) + 2) * 1000))]);
      const h = hotels.find(x => norm(x.hotelName) === hk);
      if (!h) return;
      for (const o of h.options) {
        if (!o.refundable || norm(o.roomName) !== rk || norm(o.board) !== bk) continue;
        const until = parseUntil(o.freeCancelUntil);
        if (!until || until - SAFETY_MS <= now()) continue; // لازم الحجز الجديد بعد قابل للإلغاء المجاني
        const kwd = toKWD(o.cost, o.currency); if (kwd == null) continue;
        if (!best || kwd < best.cost) best = { supplier: s, option: o, cost: kwd, q, hotelCode: h.hotelCode };
      }
    } catch (e) { console.error('hunter search', s.name, e.message); }
  }));
  return best;
}

async function notify(opps) {
  if (!opps.length) return;
  const to = db.prepare('SELECT u.email, r.perms, r.fixed FROM users u JOIN roles r ON r.id=u.role_id WHERE u.active=1').all()
    .filter(u => u.fixed || JSON.parse(u.perms).includes('rebook')).map(u => u.email);
  const rows = opps.map(o => `<li>${o.ref} — ${o.hotel}: توفير <b>${o.saving.toFixed(3)} د.ك</b></li>`).join('');
  for (const e of to) mail.send(e, `صيّاد الأسعار: ${opps.length} فرصة توفير جديدة`, `<div dir="rtl">وجد صيّاد الأسعار أسعاراً أرخص لهذه الحجوزات:<ul>${rows}</ul>افتح «فرص التوفير» في نظام الفنادق لإعادة الحجز.</div>`);
}

async function checkBooking(b, minSaving) {
  const best = await bestOffer(b);
  db.prepare("UPDATE bookings SET last_watch=datetime('now') WHERE id=?").run(b.id);
  const open = db.prepare("SELECT * FROM price_opps WHERE booking_id=? AND status='open'").get(b.id);
  const saving = best ? r3(b.cost - best.cost) : 0;
  if (!best || saving < minSaving) {
    if (open) db.prepare("UPDATE price_opps SET status='expired', handled_at=datetime('now'), note='السعر رجع أو لم يعد التوفير كافياً' WHERE id=?").run(open.id);
    return null;
  }
  const optJson = JSON.stringify({ optionId: best.option.optionId, hotelCode: best.hotelCode, q: best.q });
  if (open) {
    db.prepare('UPDATE price_opps SET found_at=datetime(\'now\'), supplier_id=?, supplier_name=?, option_json=?, new_cost=?, saving=?, new_free_cancel=?, new_cancel_policy=?, old_cost=? WHERE id=?')
      .run(best.supplier.id, best.supplier.name, optJson, best.cost, saving, best.option.freeCancelUntil, best.option.cancelPolicy, b.cost, open.id);
    return { id: open.id, isNew: open.saving < saving - 0.0005, ref: b.ref, hotel: b.hotel_name, saving };
  }
  const r = db.prepare(`INSERT INTO price_opps(booking_id,supplier_id,supplier_name,option_json,room_name,board,old_cost,new_cost,saving,new_free_cancel,new_cancel_policy,old_supplier,old_locator)
    VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(b.id, best.supplier.id, best.supplier.name, optJson, b.room_name, b.board, b.cost, best.cost, saving, best.option.freeCancelUntil, best.option.cancelPolicy, b.supplier_name, b.supplier_locator);
  return { id: r.lastInsertRowid, isNew: true, ref: b.ref, hotel: b.hotel_name, saving };
}

let running = false;
async function runAll(by) {
  if (running) return { busy: true };
  running = true;
  try {
    const cfg = setting('watch', { enabled: true, intervalHours: 6, minSaving: 5 });
    // الفرص المفتوحة لحجوزات خرجت من المراقبة (ألغيت أو انتهى الإلغاء المجاني) تنتهي
    for (const o of db.prepare("SELECT p.id, b.* FROM price_opps p JOIN bookings b ON b.id=p.booking_id WHERE p.status='open'").all())
      if (!watchable(o)) db.prepare("UPDATE price_opps SET status='expired', handled_at=datetime('now'), note='انتهت مدة الإلغاء المجاني أو تغيّرت حالة الحجز' WHERE booking_id=? AND status='open'").run(o.id);
    const list = watchedList();
    const found = [];
    for (const b of list) { const r = await checkBooking(b, +cfg.minSaving || 0); if (r) found.push(r); }
    const fresh = found.filter(f => f.isNew);
    await notify(fresh);
    setSetting('watch_last', { at: new Date().toISOString(), checked: list.length, found: found.length });
    if (by) audit(by, 'hunter_run', { checked: list.length, found: found.length });
    return { checked: list.length, found: found.length, fresh: fresh.length };
  } finally { running = false; }
}

// إعادة الحجز: فحص جديد ← شروط ← حجز جديد ← إلغاء القديم
async function rebook(oppId, userId) {
  const opp = db.prepare("SELECT * FROM price_opps WHERE id=? AND status='open'").get(oppId);
  if (!opp) throw Object.assign(new Error('الفرصة غير موجودة أو تمت معالجتها'), { status: 404 });
  const b = db.prepare('SELECT * FROM bookings WHERE id=?').get(opp.booking_id);
  if (!watchable(b)) throw Object.assign(new Error('الحجز لم يعد ضمن مدة الإلغاء المجاني الآمنة'), { status: 409 });
  const best = await bestOffer(b);
  const saving = best ? r3(b.cost - best.cost) : 0;
  if (!best || saving <= 0) {
    db.prepare("UPDATE price_opps SET status='expired', handled_at=datetime('now'), note='السعر الأرخص لم يعد متاحاً' WHERE id=?").run(opp.id);
    throw Object.assign(new Error('السعر الأرخص لم يعد متاحاً. الحجز الحالي باقٍ كما هو.'), { status: 409 });
  }
  const sup = best.supplier;
  const rules = await adapter(sup).rules(best.option.optionId, best.q);
  const newCost = toKWD(rules.cost, rules.currency);
  if (newCost == null || newCost >= b.cost) throw Object.assign(new Error('السعر النهائي من الشركة لم يعد أرخص. الحجز الحالي باقٍ كما هو.'), { status: 409 });
  if (!rules.refundable) throw Object.assign(new Error('الغرفة الجديدة لم تعد قابلة للإلغاء المجاني. لم نُعد الحجز.'), { status: 409 });
  const rooms = JSON.parse(b.rooms_json || '[]'); const guests = JSON.parse(b.guests_json || '[]');
  const guestsByRoom = []; let gi = 0; rooms.forEach(r => { guestsByRoom.push(guests.slice(gi, gi + r.adults)); gi += r.adults; });
  let res;
  try { res = await adapter(sup).book(rules.bookingCode, { ref: b.ref + '-R' + ((b.rebooks || 0) + 1), rooms, guestsByRoom, checkin: b.checkin, checkout: b.checkout, hotelCode: best.hotelCode, cost: rules.cost, currency: rules.currency, notes: b.notes, lang: best.q.lang }); }
  catch (e) { res = { status: 'failed', raw: e.message }; }
  if (res.status !== 'confirmed') {
    if (res.locator) { try { await adapter(sup).cancel(res.locator); } catch (e) { } }
    db.prepare("UPDATE price_opps SET note=? WHERE id=?").run('محاولة فاشلة: الحجز الجديد لم يتأكد (' + (res.raw || res.status) + ')', opp.id);
    throw Object.assign(new Error('الحجز الجديد لم يتأكد من الشركة، فبقي الحجز الحالي كما هو.'), { status: 409 });
  }
  // الجديد مؤكد: نلغي القديم
  const oldSup = db.prepare('SELECT * FROM suppliers WHERE id=?').get(b.supplier_id);
  let oldCancelled = false, cancelErr = '';
  try { const c = await adapter(oldSup).cancel(b.supplier_locator); oldCancelled = c.status === 'cancelled'; if (!oldCancelled) cancelErr = c.raw || c.status; }
  catch (e) { cancelErr = e.message; }
  const realSaving = r3(b.cost - newCost);
  const log = JSON.parse(b.log || '[]');
  log.push({ at: new Date().toISOString(), action: 'rebook', by: userId, from: { supplier: b.supplier_name, locator: b.supplier_locator, cost: b.cost }, to: { supplier: sup.name, locator: res.locator, cost: newCost }, oldCancelled, cancelErr });
  db.prepare(`UPDATE bookings SET supplier_id=?, supplier_name=?, supplier_locator=?, hotel_conf=?, supplier_status=?, cost=?, margin=?, savings=COALESCE(savings,0)+?, rebooks=COALESCE(rebooks,0)+1,
    free_cancel_until=?, cancel_policy=?, log=? WHERE id=?`).run(sup.id, sup.name, res.locator, res.hotelConf || b.hotel_conf, String(res.raw || 'OK'), newCost, r3(b.sell - newCost), realSaving,
    rules.freeCancelUntil || opp.new_free_cancel, rules.cancelPolicy || b.cancel_policy, JSON.stringify(log), b.id);
  db.prepare("UPDATE price_opps SET status=?, handled_by=?, handled_at=datetime('now'), new_cost=?, saving=?, new_locator=?, note=? WHERE id=?")
    .run(oldCancelled ? 'done' : 'cancel_failed', userId, newCost, realSaving, res.locator, oldCancelled ? '' : 'تنبيه: الحجز القديم لم يُلغَ تلقائياً — ألغه يدوياً لدى ' + b.supplier_name + ' (' + b.supplier_locator + '): ' + cancelErr, opp.id);
  audit(userId, 'rebook', { ref: b.ref, saving: realSaving, oldCancelled });
  return { ok: true, saving: realSaving, oldCancelled, ref: b.ref, oldLocator: b.supplier_locator, oldSupplier: b.supplier_name };
}

module.exports = function mount(app, { need, wrap, fail, can, shapeBooking }) {
  const P = need('rebook');
  app.get('/api/hunter', P, (req, res) => {
    const month = new Date().toISOString().slice(0, 7);
    const opps = db.prepare(`SELECT p.*, b.ref, b.hotel_name, b.hotel_city, b.checkin, b.checkout, b.customer_name, b.free_cancel_until, b.sell
      FROM price_opps p JOIN bookings b ON b.id=p.booking_id WHERE p.status='open' ORDER BY p.saving DESC`).all();
    const history = db.prepare(`SELECT p.*, b.ref, b.hotel_name, b.customer_name, u.name handler FROM price_opps p JOIN bookings b ON b.id=p.booking_id LEFT JOIN users u ON u.id=p.handled_by
      WHERE p.status IN ('done','cancel_failed','dismissed') ORDER BY p.handled_at DESC LIMIT 50`).all();
    const sum = db.prepare("SELECT COUNT(*) n, COALESCE(SUM(saving),0) s FROM price_opps WHERE status IN ('done','cancel_failed') AND substr(handled_at,1,7)=?").get(month);
    const total = db.prepare("SELECT COUNT(*) n, COALESCE(SUM(saving),0) s FROM price_opps WHERE status IN ('done','cancel_failed')").get();
    const watched = watchedList().map(b => ({ id: b.id, ref: b.ref, hotel: b.hotel_name, city: b.hotel_city, checkin: b.checkin, freeCancelUntil: b.free_cancel_until, cost: b.cost, lastWatch: b.last_watch }));
    res.json({ settings: setting('watch'), last: setting('watch_last', null), opps, history, month: { n: sum.n, saving: r3(sum.s) }, total: { n: total.n, saving: r3(total.s) }, watched });
  });
  app.put('/api/hunter/settings', P, wrap(async (req, res) => {
    const b = req.body || {};
    const cfg = { enabled: !!b.enabled, intervalHours: Math.min(48, Math.max(1, +b.intervalHours || 6)), minSaving: Math.max(0, +b.minSaving || 0) };
    setSetting('watch', cfg); audit(req.user.id, 'hunter_settings', cfg); res.json({ settings: cfg });
  }));
  app.post('/api/hunter/run', P, wrap(async (req, res) => res.json(await runAll(req.user.id))));
  app.post('/api/hunter/:id/rebook', P, wrap(async (req, res) => res.json(await rebook(+req.params.id, req.user.id))));
  app.post('/api/hunter/:id/dismiss', P, wrap(async (req, res) => {
    db.prepare("UPDATE price_opps SET status='dismissed', handled_by=?, handled_at=datetime('now') WHERE id=? AND status='open'").run(req.user.id, +req.params.id);
    res.json({ ok: true });
  }));

  // التشغيل التلقائي: نفحص كل 15 دقيقة هل حان موعد الجولة
  const tick = async () => {
    const cfg = setting('watch', { enabled: true, intervalHours: 6 });
    if (!cfg.enabled) return;
    const last = setting('watch_last', null);
    if (last && Date.now() - Date.parse(last.at) < cfg.intervalHours * 3600e3) return;
    try { await runAll(null); } catch (e) { console.error('hunter', e.message); }
  };
  setTimeout(tick, 60e3).unref();
  setInterval(tick, 15 * 60e3).unref();
};
module.exports.runAll = runAll;
