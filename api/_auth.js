// تحقق من كلمة مرور المشرف على الخادم فقط — لا تُرسل أبداً للمتصفح
// المتصفح يرسلها مُرمّزة بـ base64 (UTF-8) في ترويسة x-admin-password،
// لأن ترويسات HTTP لا تقبل الأحرف العربية أو الرموز مباشرةً (تفشل قبل الإرسال).

// هل كلمة مرور المشرف مضبوطة أصلاً على الخادم؟ (لتمييز "غير مضبوطة" عن "خاطئة")
export function adminConfigured() {
  return Boolean(process.env.ADMIN_PASSWORD && process.env.ADMIN_PASSWORD.trim());
}

function decodeProvided(raw) {
  if (!raw) return '';
  try {
    return Buffer.from(String(raw), 'base64').toString('utf8');
  } catch (err) {
    return '';
  }
}

export function isAuthorized(req) {
  const expected = (process.env.ADMIN_PASSWORD || '').trim();
  if (!expected) return false;
  const provided = decodeProvided(req.headers['x-admin-password']).trim();
  return provided.length > 0 && provided === expected;
}
