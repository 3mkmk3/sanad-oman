// دالة خادمة — تعيد التقييمات لكل الزوار، وتتيح للمشرف حذف تقييم مسيء
// GET بدون معاملات: ملخص (متوسط + عدد) لكل الأماكن
// GET ?place=id: التقييمات الكاملة لمكان واحد
// GET ?all=1 (مشرف فقط): كل التقييمات للمراجعة
// POST {id} (مشرف فقط): حذف تقييم
import { lrangeAll, lpush, del } from './_kv.js';
import { isAuthorized } from './_auth.js';

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

  return res.status(405).json({ error: 'Method not allowed' });
}
