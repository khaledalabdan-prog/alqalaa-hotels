const { setting } = require('./db');
const r3 = n => Math.round((+n + Number.EPSILON) * 1000) / 1000;

// تحويل عملة المورّد إلى الدينار الكويتي حسب أسعار الصرف اللي يحددها المدير/المحاسب
function toKWD(amount, currency) {
  if (!currency || currency === 'KWD') return r3(amount);
  const fx = setting('fx', {});
  const rate = +fx[currency];
  if (!rate) return null; // عملة بلا سعر صرف: الخيار لا يُعرض
  return r3(amount * rate);
}
function marginRule(sup) {
  if (sup && sup.margin_type && sup.margin_type !== 'default') return { type: sup.margin_type, value: +sup.margin_value || 0 };
  return setting('margin', { type: 'percent', value: 0 });
}
function marginDesc(m) {
  return m.type === 'percent' ? `${m.value}%` : m.type === 'fixed_night' ? `${m.value} د.ك لكل ليلة` : `${m.value} د.ك لكل حجز`;
}
function price(costKWD, sup, nights, rooms = 1) {
  const m = marginRule(sup);
  let margin = m.type === 'percent' ? costKWD * m.value / 100 : m.type === 'fixed_night' ? m.value * nights * rooms : m.value;
  margin = r3(margin);
  return { cost: r3(costKWD), margin, sell: r3(costKWD + margin), marginDesc: marginDesc(m) };
}
function bonusFor(user, profit) {
  let b = user && user.bonus_type && user.bonus_type !== 'default' ? { type: user.bonus_type, value: +user.bonus_value || 0 } : setting('bonus', { type: 'percent_profit', value: 0 });
  if (b.type === 'none') return { bonus: 0, desc: 'بدون مكافأة' };
  if (b.type === 'fixed') return { bonus: r3(b.value), desc: `${b.value} د.ك لكل حجز` };
  return { bonus: r3(Math.max(0, profit) * b.value / 100), desc: `${b.value}% من الربح` };
}
module.exports = { r3, toKWD, price, bonusFor, marginDesc };
