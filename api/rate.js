// دالة خادمة عامة — تستقبل تقييم زائر (نجوم + رأي اختياري) وتحفظه في قاعدة البيانات
import { lpush, rateLimit } from './_kv.js';

function clean(v, max) {
  return typeof v === 'string' ? v.trim().slice(0, max) : '';
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const b = req.body || {};
  const placeId = clean(String(b.placeId ?? ''), 40);
  const stars = Number(b.stars);
  const comment = clean(b.comment, 300);
  const name = clean(b.name, 50) || 'زائر';

  if (!placeId || !Number.isInteger(stars) || stars < 1 || stars > 5) {
    return res.status(400).json({ error: 'Invalid request' });
  }

  const ip = ((req.headers['x-forwarded-for'] || '').split(',')[0] || '').trim() || 'unknown';
  try {
    if (!(await rateLimit(`sanad:rl:rate:${ip}`, 10, 3600))) {
      return res.status(429).json({ error: 'Too many requests' });
    }
    // تقييم واحد لكل مكان من نفس الزائر كل 24 ساعة
    if (!(await rateLimit(`sanad:rl:rate:${ip}:${placeId}`, 1, 86400))) {
      return res.status(409).json({ error: 'Already rated' });
    }
  } catch (err) {}

  const review = {
    id: Date.now().toString(36) + Math.random().toString(36).slice(2, 8),
    placeId, stars, comment, name,
    date: new Date().toISOString().slice(0, 10)
  };

  try {
    await lpush('sanad:reviews', JSON.stringify(review));
    return res.status(200).json({ ok: true });
  } catch (err) {
    return res.status(502).json({ error: 'Storage error' });
  }
}
