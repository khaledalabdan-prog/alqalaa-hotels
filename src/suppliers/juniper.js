// ربط Juniper (JP WebService) — SOAP/XML عبر HTTPS.
// ملاحظة مهمة: هذا الملف مكتوب حسب توثيق Juniper العام، ويُضبط نهائياً أثناء التجربة
// على الحساب التجريبي (UAT) باستخدام ملف SoapUI من عطوني، ثم الاعتماد (Certification).
//
// التسلسل: HotelAvail (بحث بأكواد الفنادق، حتى 500) ← HotelBookingRules (السعر النهائي + BookingCode صالح 10 دقائق)
//          ← HotelBooking (تأكيد فوري، Locator) ← ReadBooking / CancelBooking
const { XMLParser } = require('fast-xml-parser');
const { db } = require('../db');
const { decrypt } = require('../secret');

const NS = 'http://www.juniper.es/webservice/2007/';
const parser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: '@', removeNSPrefix: true });
const esc = s => String(s ?? '').replace(/[<>&"']/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&apos;' }[c]));
const arr = x => (x == null ? [] : Array.isArray(x) ? x : [x]);

module.exports = function juniperSupplier(sup) {
  const email = sup.username;
  const password = () => decrypt(sup.password_enc);
  const timeoutMs = Math.min(8, sup.timeout_sec || 8) * 1000;
  const base = (sup.endpoint || '').replace(/\/+$/, '');

  async function call(service, op, inner) {
    if (!base || !email || !sup.password_enc) throw new Error('بيانات الربط غير مكتملة (العنوان أو البريد أو الرقم السري)');
    const body = `<?xml version="1.0" encoding="utf-8"?>
<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" xmlns="${NS}">
<soapenv:Body><${op}>${inner}</${op}></soapenv:Body></soapenv:Envelope>`;
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), timeoutMs + 2000);
    try {
      const res = await fetch(`${base}/${service}`, {
        method: 'POST', signal: ctrl.signal,
        headers: { 'Content-Type': 'text/xml; charset=utf-8', SOAPAction: `${NS}${op}`, 'Accept-Encoding': 'gzip' },
        body,
      });
      const text = await res.text();
      const json = parser.parse(text);
      const env = json.Envelope?.Body || {};
      const fault = env.Fault;
      if (fault) throw new Error('Juniper: ' + (fault.faultstring || 'SOAP Fault'));
      const resp = Object.values(env)[0] || {};
      const rs = Object.values(resp).find(v => v && typeof v === 'object') || resp;
      const errs = arr(rs.Errors?.Error);
      if (errs.length) throw new Error('Juniper: ' + errs.map(e => e['@Text'] || e['#text'] || e['@Code']).join(' | '));
      return { rs, raw: text, req: body };
    } finally { clearTimeout(t); }
  }
  const login = () => `<Login Email="${esc(email)}" Password="${esc(password())}"/>`;

  function paxXml(rooms, guests) {
    let id = 0; const paxes = []; const dist = [];
    rooms.forEach((r, ri) => {
      const ids = [];
      for (let a = 0; a < r.adults; a++) { id++; ids.push(id); const g = guests?.[ri]?.[a];
        paxes.push(`<Pax IdPax="${id}">${g ? `<Name>${esc(g.first)}</Name><Surname>${esc(g.last)}</Surname>` : ''}<Age>30</Age></Pax>`); }
      for (const age of r.children || []) { id++; ids.push(id); paxes.push(`<Pax IdPax="${id}"><Age>${+age}</Age></Pax>`); }
      dist.push(`<RelPaxDist><RelPaxes>${ids.map(i => `<RelPax IdPax="${i}"/>`).join('')}</RelPaxes></RelPaxDist>`);
    });
    return { paxes: `<Paxes>${paxes.join('')}</Paxes>`, dist: `<RelPaxesDist>${dist.join('')}</RelPaxesDist>` };
  }
  const seg = q => `<SearchSegmentsHotels><SearchSegmentHotels Start="${q.checkin}" End="${q.checkout}"/><CountryOfResidence>${esc(q.residence || 'KW')}</CountryOfResidence>`;

  function cancelText(cp) {
    if (!cp) return { refundable: false, text: 'غير قابل للاسترداد (لم تصل سياسة الإلغاء من المورّد).' };
    if (cp['@NonRefundable'] === 'true') return { refundable: false, text: 'غير قابل للاسترداد.' };
    const rules = arr(cp.PolicyRules?.Rule);
    const first = rules.find(r => +r['@FixedPrice'] > 0 || +r['@PercentPrice'] > 0 || +r['@Nights'] > 0);
    const date = (first?.['@DateFrom'] || first?.['@DateTo'] || '').slice(0, 10);
    return { refundable: true, text: cp.Description || (date ? `إلغاء مجاني قبل ${date} (مع هامش أمان 12 ساعة)، بعدها تطبّق رسوم الإلغاء.` : 'يطبّق المورّد رسوم إلغاء حسب سياسته.') };
  }

  return {
    async test() {
      // طلب خفيف للتأكد من صحة البيانات والسماح لعنوان IP
      await call('webservice/JP/Operations/StaticDataTransactions.asmx', 'ZoneList', `<ZoneListRQ Version="1.1" Language="en">${login()}<ZoneListRequest ProductType="HOT"/></ZoneListRQ>`);
      return { ok: true, message: 'تم الاتصال بنجاح' };
    },
    // تحديث قائمة الفنادق (البيانات الثابتة) — مرة كل 15 يوماً على الأقل
    async syncHotels() {
      let page = 1, total = 0, token = '';
      const up = db.prepare(`INSERT INTO supplier_hotels(supplier_id,code,name,city,stars,address,updated_at) VALUES(?,?,?,?,?,?,datetime('now'))
        ON CONFLICT(supplier_id,code) DO UPDATE SET name=excluded.name, city=excluded.city, stars=excluded.stars, address=excluded.address, updated_at=excluded.updated_at`);
      do {
        const { rs } = await call('webservice/JP/Operations/StaticDataTransactions.asmx', 'HotelPortfolio',
          `<HotelPortfolioRQ Version="1.1" Language="en" ${token ? `Token="${esc(token)}"` : ''} RecordsPerPage="500">${login()}</HotelPortfolioRQ>`);
        const list = arr(rs.HotelPortfolio?.Hotel);
        const tx = db.transaction(() => { for (const h of list) up.run(sup.id, h['@JPCode'] || h['@Code'], h.Name, h.Zone?.Name || h.City?.Name || '', parseInt(h.HotelCategory?.['#text'] || h.HotelCategory) || null, h.Address || ''); });
        tx(); total += list.length;
        token = rs.HotelPortfolio?.['@NextToken'] || '';
        page++;
      } while (token && page < 400);
      return { count: total };
    },
    async search(q) {
      const codes = db.prepare('SELECT code FROM supplier_hotels WHERE supplier_id=? AND (city=? COLLATE NOCASE OR city=? COLLATE NOCASE) LIMIT 500').all(sup.id, q.city, q.cityEn || q.city).map(r => r.code);
      if (!codes.length) return [];
      const { paxes, dist } = paxXml(q.rooms);
      const { rs } = await call('webservice/JP/Operations/AvailTransactions.asmx', 'HotelAvail',
        `<HotelAvailRQ Version="1.1" Language="${q.lang || 'en'}">${login()}${paxes}<HotelRequest>${seg(q)}<HotelCodes>${codes.map(c => `<HotelCode>${esc(c)}</HotelCode>`).join('')}</HotelCodes></SearchSegmentsHotels>${dist}</HotelRequest><AdvancedOptions><ShowHotelInfo>true</ShowHotelInfo><ShowCancellationPolicies>true</ShowCancellationPolicies><TimeOut>${timeoutMs}</TimeOut></AdvancedOptions></HotelAvailRQ>`);
      return arr(rs.Results?.HotelResult).map(hr => ({
        hotelCode: hr['@Code'] || hr['@JPCode'], hotelName: hr.HotelInfo?.Name, stars: parseInt(hr.HotelInfo?.HotelCategory?.['#text'] || hr.HotelInfo?.HotelCategory) || null,
        city: q.city, area: hr.HotelInfo?.Address || '', image: hr.HotelInfo?.Images?.Image?.[0] || '',
        checkinTime: '', checkoutTime: '',
        options: arr(hr.HotelOptions?.HotelOption).map(o => {
          const price = o.Prices?.Price || {}; const tf = price.TotalFixAmounts || {};
          const c = cancelText(o.CancellationPolicy);
          return { optionId: `${sup.id}|${o['@RatePlanCode']}`, ratePlanCode: o['@RatePlanCode'],
            roomName: arr(o.HotelRooms?.HotelRoom).map(r => r.Name).join(' + '), board: o.Board?.['#text'] || o.Board || '',
            refundable: c.refundable, cancelPolicy: c.text,
            cost: +(tf['@Nett'] || tf['@Gross'] || 0), currency: price['@Currency'] || 'EUR' };
        }),
      }));
    },
    async rules(optionId, q) {
      const rate = optionId.split('|').slice(1).join('|');
      const { rs } = await call('webservice/JP/Operations/CheckTransactions.asmx', 'HotelBookingRules',
        `<HotelBookingRulesRQ Version="1.1" Language="${q.lang || 'en'}">${login()}<HotelBookingRulesRequest><HotelOption RatePlanCode="${esc(rate)}"/>${seg(q)}</SearchSegmentsHotels></HotelBookingRulesRequest><AdvancedOptions><ShowBreakdownPrice>true</ShowBreakdownPrice></AdvancedOptions></HotelBookingRulesRQ>`);
      const ho = arr(rs.Results?.HotelResult)[0]?.HotelOptions?.HotelOption;
      const opt = arr(ho)[0] || {};
      const price = opt.PriceInformation?.Prices?.Price || {}; const tf = price.TotalFixAmounts || {};
      const hi = opt.PriceInformation?.HotelContent || {};
      const c = cancelText(opt.CancellationPolicy);
      return {
        bookingCode: opt.BookingCode?.['#text'] || opt.BookingCode, ratePlanCode: rate,
        cost: +(tf['@Nett'] || tf['@Gross'] || 0), currency: price['@Currency'] || 'EUR',
        refundable: c.refundable, cancelPolicy: c.text,
        roomName: arr(opt.PriceInformation?.HotelRooms?.HotelRoom).map(r => r.Name).join(' + '),
        board: opt.PriceInformation?.Board?.['#text'] || '',
        // اسم الفندق وعنوانه وتصنيفه من رد Juniper نفسه (شرط الاعتماد)
        hotel: { code: hi['@Code'], name: hi.HotelName, stars: parseInt(hi.HotelCategory?.['#text'] || hi.HotelCategory) || null,
          address: hi.Address?.Address || '', city: q.city, phone: '', checkinTime: '', checkoutTime: '', description: '', facilities: [] },
        requiredFields: arr(opt.HotelRequiredFields?.HotelBooking ? ['HotelRequiredFields'] : []),
      };
    },
    async book(bookingCode, b) {
      const { paxes } = paxXml(b.rooms, b.guestsByRoom);
      const hb = await call('webservice/JP/Operations/BookTransactions.asmx', 'HotelBooking',
        `<HotelBookingRQ Version="1.1" Language="${b.lang || 'en'}">${login()}${paxes}<Holder><RelPax IdPax="1"/></Holder><ExternalBookingReference>${esc(b.ref)}</ExternalBookingReference><Comments><Comment Type="HOT">${esc(b.notes || '')}</Comment></Comments><Elements><HotelElement><BookingCode>${esc(bookingCode)}</BookingCode><RelPaxesDist>${paxXml(b.rooms).dist.replace(/<\/?RelPaxesDist>/g, '')}</RelPaxesDist><HotelBookingInfo Start="${b.checkin}" End="${b.checkout}"><Price><PriceRange Minimum="${(b.cost * 0.75).toFixed(2)}" Maximum="${(b.cost * 2).toFixed(2)}" Currency="${esc(b.currency)}"/></Price><HotelCode>${esc(b.hotelCode)}</HotelCode></HotelBookingInfo></HotelElement></Elements></HotelBookingRQ>`);
      const r = arr(hb.rs.Reservations?.Reservation)[0] || {};
      const st = r['@Status'];
      return { locator: r['@Locator'], hotelConf: '', status: st === 'OK' ? 'confirmed' : (st === 'CAN' || st === 'CAC') ? 'cancelled' : st ? 'pending' : 'failed', raw: st, xml: { req: hb.req.replace(/Password="[^"]*"/, 'Password="***"'), res: hb.raw } };
    },
    async read(locator) {
      const { rs } = await call('webservice/JP/Operations/CheckTransactions.asmx', 'ReadBooking',
        `<ReadRQ Version="1.1" Language="en">${login()}<ReadRequest ReservationLocator="${esc(locator)}"/></ReadRQ>`);
      const st = arr(rs.Reservations?.Reservation)[0]?.['@Status'];
      return { status: st === 'OK' ? 'confirmed' : (st === 'CAN' || st === 'CAC') ? 'cancelled' : 'pending', raw: st };
    },
    async cancel(locator) {
      const { rs } = await call('webservice/JP/Operations/BookTransactions.asmx', 'CancelBooking',
        `<CancelRQ Version="1.1" Language="en">${login()}<CancelRequest ReservationLocator="${esc(locator)}"/></CancelRQ>`);
      const st = arr(rs.Reservations?.Reservation)[0]?.['@Status'] || rs['@Status'];
      return { status: (st === 'CAN' || st === 'CAC') ? 'cancelled' : 'pending', raw: st };
    },
  };
};
