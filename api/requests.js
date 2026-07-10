// دالة خادمة — يستخدمها المشرف فقط لعرض كل طلبات التسجيل
import { lrangeAll, get, rateLimit } from './_kv.js';
import { isAuthorized } from './_auth.js';

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // حماية من تخمين كلمة المرور: 15 محاولة خاطئة تقفل الدخول ساعة كاملة
  const ip = ((req.headers['x-forwarded-for'] || '').split(',')[0] || '').trim() || 'unknown';
  try {
    if ((Number(await get(`sanad:rl:login:${ip}`)) || 0) >= 15) {
      return res.status(429).json({ error: 'Too many attempts' });
    }
  } catch (err) {}

  if (!isAuthorized(req)) {
    try { await rateLimit(`sanad:rl:login:${ip}`, 9999, 3600); } catch (err) {}
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const requests = await lrangeAll('sanad:requests');
    return res.status(200).json({ requests });
  } catch (err) {
    return res.status(502).json({ error: 'Storage error' });
  }
}
