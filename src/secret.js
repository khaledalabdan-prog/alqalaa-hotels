// تشفير الأرقام السرية للشركات الموردة داخل قاعدة البيانات (AES-256-GCM) بمفتاح APP_SECRET
const crypto = require('crypto');
function key() {
  const s = process.env.APP_SECRET || 'dev-only-secret-change-me';
  return crypto.createHash('sha256').update(s).digest();
}
function encrypt(text) {
  if (!text) return '';
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv('aes-256-gcm', key(), iv);
  const enc = Buffer.concat([c.update(String(text), 'utf8'), c.final()]);
  return [iv, c.getAuthTag(), enc].map(b => b.toString('base64')).join('.');
}
function decrypt(blob) {
  if (!blob) return '';
  const [iv, tag, enc] = blob.split('.').map(s => Buffer.from(s, 'base64'));
  const d = crypto.createDecipheriv('aes-256-gcm', key(), iv);
  d.setAuthTag(tag);
  return Buffer.concat([d.update(enc), d.final()]).toString('utf8');
}
const token = (n = 32) => crypto.randomBytes(n).toString('hex');
const sha = s => crypto.createHash('sha256').update(s).digest('hex');
module.exports = { encrypt, decrypt, token, sha };
