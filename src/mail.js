// إرسال البريد عبر SMTP (Zoho Mail). يقبل SMTP_URL (نفس متغير موقع السفريات)
// أو SMTP_HOST/SMTP_PORT/SMTP_USER/SMTP_PASS. إذا ما تم ضبطه يرجع false.
const nodemailer = require('nodemailer');
let tx = null;
function transport() {
  if (tx) return tx;
  if (process.env.SMTP_URL) tx = nodemailer.createTransport(process.env.SMTP_URL);
  else if (process.env.SMTP_HOST) tx = nodemailer.createTransport({
    host: process.env.SMTP_HOST, port: +(process.env.SMTP_PORT || 465), secure: (process.env.SMTP_PORT || '465') === '465',
    auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
  });
  return tx;
}
function fromAddr() {
  if (process.env.MAIL_FROM) return process.env.MAIL_FROM;
  if (process.env.SMTP_USER) return process.env.SMTP_USER;
  try { const u = new URL(process.env.SMTP_URL); return `سفريات القلعة للسياحة والسفر <${decodeURIComponent(u.username)}>`; } catch { return undefined; }
}
async function send(to, subject, html) {
  const t = transport();
  if (!t || !to) return false;
  try { await t.sendMail({ from: fromAddr(), to, subject, html }); return true; }
  catch (e) { console.error('mail error', e.message); return false; }
}
module.exports = { send, configured: () => !!(process.env.SMTP_URL || process.env.SMTP_HOST) };
