// تحقق من كلمة مرور المشرف على الخادم فقط — لا تُرسل أبداً للمتصفح
export function isAuthorized(req) {
  const provided = req.headers['x-admin-password'];
  const expected = process.env.ADMIN_PASSWORD;
  return Boolean(expected) && provided === expected;
}
