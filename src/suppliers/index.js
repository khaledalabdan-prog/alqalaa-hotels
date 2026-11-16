const mock = require('./mock');
const juniper = require('./juniper');
const TYPES = { mock: { label: 'مورّد تجريبي', make: mock }, juniper: { label: 'Juniper · JP WebService (SOAP/XML)', make: juniper } };
function adapter(sup) {
  const t = TYPES[sup.type];
  if (!t) throw new Error('نوع ربط غير معروف: ' + sup.type);
  return t.make(sup);
}
module.exports = { adapter, TYPES, MOCK_CITIES: mock.CITIES };
