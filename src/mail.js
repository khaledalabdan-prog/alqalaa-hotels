// إرسال البريد عبر SMTP (مثل Zoho Mail). إذا ما تم ضبطه يرجع false.
const nodemailer = require('nodemailer');
let tx = null;
function transport() {
  if (tx) return tx;
  if (!process.env.SMTP_HOST) return null;
  tx = nodemailer.createTransport({
    host: process.env.SMTP_HOST, port: +(process.env.SMTP_PORT || 465), secure: (process.env.SMTP_PORT || '465') === '465',
    auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
  });
  return tx;
}
async function send(to, subject, html) {
  const t = transport();
  if (!t || !to) return false;
  try { await t.sendMail({ from: process.env.MAIL_FROM || process.env.SMTP_USER, to, subject, html }); return true; }
  catch (e) { console.error('mail error', e.message); return false; }
}
module.exports = { send, configured: () => !!process.env.SMTP_HOST };
