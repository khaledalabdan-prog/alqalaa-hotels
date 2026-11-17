// كل الصلاحيات في النظام. المدير (fixed) يملكها كلها دائماً.
const ALL_PERMS = [
  { group: 'البحث والحجز', items: [
    ['search', 'البحث عن الفنادق'], ['book', 'إنشاء حجز'], ['cancel', 'إلغاء حجز'],
    ['bookings_own', 'عرض حجوزاته فقط'], ['bookings_all', 'عرض حجوزات كل الموظفين'] ] },
  { group: 'القسائم', items: [
    ['voucher', 'قسيمة العميل (طباعة وإرسال)'], ['supplier_view', 'بيانات الشركة المورّدة بعد الحجز'] ] },
  { group: 'الحسابات', items: [
    ['accounts_view', 'عرض سعر التكلفة وهامش الربح'], ['margin_edit', 'تعديل هامش الربح'],
    ['bonus_edit', 'تحديد مكافآت الموظفين'], ['reports', 'تقرير المحاسب والتصدير'],
    ['rebook', 'صيّاد الأسعار: عرض فرص التوفير وإعادة الحجز'] ] },
  { group: 'الشركات الموردة', items: [
    ['suppliers_view', 'عرض الشركات'], ['suppliers_edit', 'إضافة وتعديل شركة وبيانات الربط'],
    ['suppliers_toggle', 'تفعيل وإيقاف شركة'], ['api_keys', 'مفاتيح API للموقع'] ] },
  { group: 'الموظفون والصلاحيات', items: [
    ['users_view', 'عرض الموظفين'], ['users_edit', 'إضافة وتعديل وإيقاف موظف'],
    ['password_reset', 'استقبال طلبات استرجاع الرقم السري وإعادته'], ['roles_edit', 'تعديل الصفات والصلاحيات'] ] },
];
const KEYS = ALL_PERMS.flatMap(g => g.items.map(i => i[0]));
const DEFAULT_ROLES = [
  { name: 'مدير', fixed: true, perms: KEYS },
  { name: 'محاسب', perms: ['search', 'bookings_own', 'bookings_all', 'voucher', 'supplier_view', 'accounts_view', 'margin_edit', 'bonus_edit', 'reports', 'rebook'] },
  { name: 'موظف حجوزات', perms: ['search', 'book', 'bookings_own', 'voucher', 'supplier_view'] },
];
module.exports = { ALL_PERMS, KEYS, DEFAULT_ROLES };
