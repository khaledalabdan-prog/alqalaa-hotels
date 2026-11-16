// مورّد تجريبي: يحاكي ردود شركة فنادق حتى تصل بيانات الربط الفعلية.
// الفنادق والأسعار هنا وهمية للتجربة فقط.
const crypto = require('crypto');
const CITIES = {
  'مكة المكرمة': [
    ['MK01', 'فندق الصفوة التجريبي', 5, 'أجياد · 300 م من الحرم'],
    ['MK02', 'فندق برج النخبة التجريبي', 5, 'العزيزية · 900 م من الحرم'],
    ['MK03', 'فندق دار الضيافة التجريبي', 4, 'الششة · 2.1 كم من الحرم'],
    ['MK04', 'فندق الريان التجريبي', 3, 'المسفلة · 1.4 كم من الحرم'] ],
  'المدينة المنورة': [
    ['MD01', 'فندق النور التجريبي', 5, 'المنطقة المركزية الشمالية'],
    ['MD02', 'فندق طيبة التجريبي', 4, 'المنطقة المركزية الجنوبية'] ],
  'دبي': [
    ['DX01', 'فندق مرسى الخليج التجريبي', 5, 'دبي مارينا'],
    ['DX02', 'فندق داون تاون التجريبي', 4, 'وسط مدينة دبي'],
    ['DX03', 'فندق ديرة التجريبي', 3, 'ديرة'] ],
  'إسطنبول': [
    ['IS01', 'فندق البوسفور التجريبي', 5, 'بشكتاش'],
    ['IS02', 'فندق السلطان أحمد التجريبي', 4, 'السلطان أحمد'] ],
  'القاهرة': [
    ['CA01', 'فندق النيل التجريبي', 5, 'جاردن سيتي'],
    ['CA02', 'فندق الأهرامات التجريبي', 4, 'الجيزة'] ],
  'الكويت': [
    ['KW01', 'فندق الخليج التجريبي', 5, 'شرق'],
    ['KW02', 'فندق السالمية التجريبي', 4, 'السالمية'] ],
  'لندن': [
    ['LN01', 'فندق هايد بارك التجريبي', 5, 'نايتسبريدج'],
    ['LN02', 'فندق إدجوار التجريبي', 4, 'إدجوار رود'] ],
};
const ROOMS = [
  ['غرفة مزدوجة قياسية', 'إفطار', 1.0],
  ['غرفة مزدوجة بإطلالة', 'إفطار', 1.25],
  ['غرفة ثلاثية', 'بدون وجبات', 1.15],
  ['جناح عائلي', 'نصف إقامة', 1.9],
];
function h(s) { return parseInt(crypto.createHash('md5').update(s).digest('hex').slice(0, 8), 16); }
function nightsBetween(a, b) { return Math.max(1, Math.round((new Date(b) - new Date(a)) / 864e5)); }
function addDays(d, n) { const x = new Date(d); x.setDate(x.getDate() + n); return x.toISOString().slice(0, 10); }

module.exports = function mockSupplier(sup) {
  const seed = sup.id;
  return {
    cities: () => Object.keys(CITIES),
    async test() { return { ok: true, message: 'المورّد التجريبي يعمل' }; },
    async search(q) {
      const list = CITIES[q.city] || [];
      const nights = nightsBetween(q.checkin, q.checkout);
      const pax = q.rooms.reduce((a, r) => a + r.adults + (r.children || []).length, 0);
      const out = [];
      for (const [code, name, stars, area] of list) {
        if (h(seed + code) % 7 === 0) continue; // بعض الفنادق غير متوفرة لدى هذا المورد
        const base = 18 + stars * 9 + (h(code) % 15);
        const options = [];
        ROOMS.forEach(([room, board, f], i) => {
          if (h(seed + code + i + q.checkin) % 4 === 0) return;
          const refundable = h(code + i) % 3 !== 0;
          const perNight = base * f * (1 + (h(seed + code + room) % 13) / 100) * (1 + (pax - 2) * 0.12);
          const cost = Math.round(perNight * nights * q.rooms.length * 1000) / 1000;
          const deadline = addDays(q.checkin, -(5 + (h(code + i) % 4))).split('-').reverse().join('/');
          options.push({
            optionId: `${sup.id}|${code}|${i}|${q.checkin}|${q.checkout}`,
            roomName: room, board, refundable, cost, currency: 'KWD',
            cancelPolicy: refundable ? `إلغاء مجاني قبل ${deadline}، بعدها تُخصم قيمة ليلة واحدة.` : 'غير قابل للاسترداد: لا يُسترد المبلغ عند الإلغاء.',
          });
        });
        if (!options.length) continue;
        out.push({ hotelCode: code, hotelName: name, stars, city: q.city, area, checkinTime: '15:00', checkoutTime: '12:00', options });
      }
      return out;
    },
    async rules(optionId, q) {
      const [, code, i, checkin, checkout] = optionId.split('|');
      const hotels = await this.search({ ...q, checkin, checkout });
      const hotel = hotels.find(x => x.hotelCode === code);
      const opt = hotel && hotel.options.find(o => o.optionId === optionId);
      if (!opt) throw new Error('الغرفة لم تعد متاحة');
      return {
        bookingCode: 'MOCK-' + crypto.randomBytes(6).toString('hex'),
        cost: opt.cost, currency: 'KWD', refundable: opt.refundable, cancelPolicy: opt.cancelPolicy,
        roomName: opt.roomName, board: opt.board,
        hotel: { name: hotel.hotelName, stars: hotel.stars, address: hotel.area + '، ' + hotel.city, city: hotel.city,
          phone: '', checkinTime: hotel.checkinTime, checkoutTime: hotel.checkoutTime,
          description: 'وصف تجريبي للفندق. في الربط الفعلي يصل الوصف والصور من الشركة المورّدة.',
          facilities: ['واي فاي مجاني', 'مطعم', 'خدمة الغرف', 'مكيف'] },
        requiredFields: [],
      };
    },
    async book(bookingCode) {
      return { locator: 'MK' + (h(bookingCode) % 900000 + 100000), hotelConf: 'HC' + (h('c' + bookingCode) % 90000 + 10000), status: 'confirmed', raw: 'OK' };
    },
    async read(locator) { return { status: 'confirmed', raw: 'OK' }; },
    async cancel(locator) { return { status: 'cancelled', raw: 'CAN' }; },
  };
};
module.exports.CITIES = Object.keys(CITIES);
