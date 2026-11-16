// قاعدة البيانات: SQLite (ملف واحد). المسار من DB_PATH، وعلى Render يُفضّل قرص دائم مثل /var/data/hotels.db
const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');
const bcrypt = require('bcryptjs');
const { ALL_PERMS, DEFAULT_ROLES } = require('./perms');

const DB_PATH = process.env.DB_PATH || path.join(__dirname, '..', 'data', 'hotels.db');
fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
CREATE TABLE IF NOT EXISTS roles (
  id INTEGER PRIMARY KEY, name TEXT NOT NULL UNIQUE, perms TEXT NOT NULL DEFAULT '[]', fixed INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY, name TEXT NOT NULL, username TEXT NOT NULL UNIQUE COLLATE NOCASE,
  civil_id TEXT NOT NULL UNIQUE, email TEXT NOT NULL, phone TEXT DEFAULT '',
  role_id INTEGER NOT NULL REFERENCES roles(id), active INTEGER NOT NULL DEFAULT 1,
  pass_hash TEXT NOT NULL, must_change INTEGER NOT NULL DEFAULT 1,
  bonus_type TEXT DEFAULT 'default', bonus_value REAL DEFAULT 0,
  last_login TEXT, created_at TEXT DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS sessions (
  token TEXT PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS suppliers (
  id INTEGER PRIMARY KEY, name TEXT NOT NULL, type TEXT NOT NULL, env TEXT DEFAULT 'uat',
  endpoint TEXT DEFAULT '', username TEXT DEFAULT '', password_enc TEXT DEFAULT '',
  timeout_sec INTEGER DEFAULT 8, margin_type TEXT DEFAULT 'default', margin_value REAL DEFAULT 0,
  active INTEGER NOT NULL DEFAULT 1, last_test TEXT, last_test_ok INTEGER,
  created_at TEXT DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS supplier_hotels (
  supplier_id INTEGER NOT NULL REFERENCES suppliers(id) ON DELETE CASCADE, code TEXT NOT NULL,
  name TEXT, city TEXT, stars INTEGER, address TEXT, updated_at TEXT DEFAULT (datetime('now')),
  PRIMARY KEY (supplier_id, code)
);
CREATE INDEX IF NOT EXISTS ix_sh_city ON supplier_hotels(supplier_id, city);
CREATE TABLE IF NOT EXISTS settings ( key TEXT PRIMARY KEY, value TEXT );
CREATE TABLE IF NOT EXISTS quotes (
  token TEXT PRIMARY KEY, data TEXT NOT NULL, user_id INTEGER, api_key_id INTEGER, expires_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS bookings (
  id INTEGER PRIMARY KEY, ref TEXT UNIQUE, created_at TEXT DEFAULT (datetime('now')),
  user_id INTEGER REFERENCES users(id), source TEXT DEFAULT 'staff', api_key_id INTEGER,
  supplier_id INTEGER REFERENCES suppliers(id), supplier_name TEXT, supplier_locator TEXT, hotel_conf TEXT,
  status TEXT NOT NULL, supplier_status TEXT,
  hotel_code TEXT, hotel_name TEXT, hotel_stars INTEGER, hotel_address TEXT, hotel_city TEXT, hotel_phone TEXT,
  checkin TEXT, checkout TEXT, nights INTEGER, checkin_time TEXT, checkout_time TEXT,
  room_name TEXT, board TEXT, rooms_json TEXT, guests_json TEXT, nationality TEXT,
  cancel_policy TEXT, refundable INTEGER,
  customer_name TEXT, customer_phone TEXT, customer_email TEXT, notes TEXT, collection TEXT,
  currency TEXT DEFAULT 'KWD', cost REAL, margin REAL, sell REAL, margin_desc TEXT,
  bonus REAL DEFAULT 0, bonus_desc TEXT, cancelled_at TEXT, log TEXT DEFAULT '[]'
);
CREATE INDEX IF NOT EXISTS ix_book_created ON bookings(created_at);
CREATE TABLE IF NOT EXISTS password_requests (
  id INTEGER PRIMARY KEY, user_id INTEGER REFERENCES users(id) ON DELETE CASCADE, ident TEXT, civil_id TEXT,
  matched INTEGER, status TEXT DEFAULT 'pending', created_at TEXT DEFAULT (datetime('now')),
  handled_by INTEGER, handled_at TEXT
);
CREATE TABLE IF NOT EXISTS api_keys (
  id INTEGER PRIMARY KEY, name TEXT NOT NULL, key_hash TEXT NOT NULL, key_tail TEXT, active INTEGER DEFAULT 1,
  created_at TEXT DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS audit (
  id INTEGER PRIMARY KEY, at TEXT DEFAULT (datetime('now')), user_id INTEGER, action TEXT, detail TEXT
);
`);

function setting(key, def) {
  const r = db.prepare('SELECT value FROM settings WHERE key=?').get(key);
  return r ? JSON.parse(r.value) : def;
}
function setSetting(key, value) {
  db.prepare('INSERT INTO settings(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').run(key, JSON.stringify(value));
}
function audit(userId, action, detail) {
  db.prepare('INSERT INTO audit(user_id,action,detail) VALUES(?,?,?)').run(userId || null, action, typeof detail === 'string' ? detail : JSON.stringify(detail || {}));
}

// البيانات الأولى عند أول تشغيل فقط
function seed() {
  if (db.prepare('SELECT COUNT(*) c FROM roles').get().c === 0) {
    const ins = db.prepare('INSERT INTO roles(name,perms,fixed) VALUES(?,?,?)');
    for (const r of DEFAULT_ROLES) ins.run(r.name, JSON.stringify(r.perms), r.fixed ? 1 : 0);
  }
  if (db.prepare('SELECT COUNT(*) c FROM users').get().c === 0) {
    const mgr = db.prepare("SELECT id FROM roles WHERE fixed=1").get();
    const pass = process.env.ADMIN_PASSWORD || 'Admin@12345';
    db.prepare(`INSERT INTO users(name,username,civil_id,email,phone,role_id,pass_hash,must_change)
      VALUES(?,?,?,?,?,?,?,1)`).run(
      process.env.ADMIN_NAME || 'المدير', process.env.ADMIN_USERNAME || 'admin',
      process.env.ADMIN_CIVIL_ID || '000000000000', process.env.ADMIN_EMAIL || 'admin@alqalaatravels.net', '',
      mgr.id, bcrypt.hashSync(pass, 10));
  }
  if (db.prepare('SELECT COUNT(*) c FROM suppliers').get().c === 0) {
    db.prepare("INSERT INTO suppliers(name,type,env,active) VALUES('عطوني','juniper','uat',0)").run();
    db.prepare("INSERT INTO suppliers(name,type,env,active) VALUES('مورّد تجريبي أ','mock','test',1)").run();
    db.prepare("INSERT INTO suppliers(name,type,env,active) VALUES('مورّد تجريبي ب','mock','test',1)").run();
  }
  if (setting('margin') === undefined) setSetting('margin', { type: 'percent', value: 8 });
  if (setting('bonus') === undefined) setSetting('bonus', { type: 'percent_profit', value: 10 });
  if (setting('company') === undefined) setSetting('company', {
    name: 'سفريات القلعة للسياحة والسفر', nameEn: 'Al Qalaa Travels', phone: '', email: 'booking@alqalaatravels.net', website: 'alqalaatravels.net'
  });
}
seed();

module.exports = { db, setting, setSetting, audit, ALL_PERMS };
