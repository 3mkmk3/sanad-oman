// دالة خادمة موحّدة للتقييمات — تدمج استقبال تقييم زائر جديد وعرض/حذف التقييمات
// (كانتا ملفين منفصلين rate.js + ratings.js؛ دُمجتا لتقليل عدد الدوال الخادمة)
// GET بدون معاملات: ملخص (متوسط + عدد) لكل الأماكن
// GET ?place=id: التقييمات الكاملة لمكان واحد
// GET ?all=1 (مشرف فقط): كل التقييمات للمراجعة
// POST {placeId, stars, ...}: إرسال تقييم جديد (عام، محدود المعدل)
// POST {id}: حذف تقييم (مشرف فقط)
import { lrangeAll, lpush, del, rateLimit } from './_kv.js';
import { isAuthorized } from './_auth.js';

function clean(v, max) {
  return typeof v === 'string' ? v.trim().slice(0, max) : '';
}

async function submitRating(req, res) {
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

async function deleteRating(req, res) {
  if (!isAuthorized(req)) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  const { id } = req.body || {};
  if (!id) {
    return res.status(400).json({ error: 'Invalid request' });
  }
  try {
    const reviews = await lrangeAll('sanad:reviews');
    const remaining = reviews.filter(r => r.id !== id);
    if (remaining.length === reviews.length) {
      return res.status(404).json({ error: 'Not found' });
    }
    await del('sanad:reviews');
    for (let i = remaining.length - 1; i >= 0; i--) {
      await lpush('sanad:reviews', JSON.stringify(remaining[i]));
    }
    return res.status(200).json({ ok: true });
  } catch (err) {
    return res.status(502).json({ error: 'Storage error' });
  }
}

export default async function handler(req, res) {
  if (req.method === 'GET') {
    try {
      const reviews = await lrangeAll('sanad:reviews');

      if (req.query.all) {
        if (!isAuthorized(req)) {
          return res.status(401).json({ error: 'Unauthorized' });
        }
        return res.status(200).json({ reviews });
      }

      if (req.query.place) {
        const list = reviews.filter(r => r.placeId === String(req.query.place));
        const count = list.length;
        const avg = count ? +(list.reduce((s, r) => s + r.stars, 0) / count).toFixed(1) : 0;
        return res.status(200).json({ avg, count, reviews: list.slice(0, 30) });
      }

      const sums = {};
      for (const r of reviews) {
        const s = sums[r.placeId] || (sums[r.placeId] = { sum: 0, count: 0 });
        s.sum += r.stars;
        s.count++;
      }
      const summary = {};
      for (const k in sums) {
        summary[k] = { avg: +(sums[k].sum / sums[k].count).toFixed(1), count: sums[k].count };
      }
      return res.status(200).json({ summary });
    } catch (err) {
      return res.status(502).json({ error: 'Storage error' });
    }
  }

  if (req.method === 'POST') {
    const b = req.body || {};
    // شكل الطلب يحدد النوع: placeId+stars = تقييم جديد، id فقط = حذف
    if (b && b.placeId !== undefined && b.stars !== undefined) {
      return submitRating(req, res);
    }
    if (b && b.id !== undefined) {
      return deleteRating(req, res);
    }
    return res.status(400).json({ error: 'Invalid request' });
  }

  return res.status(405).json({ error: 'Method not allowed' });
}
