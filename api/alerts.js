// دالة خادمة — تنبيهات البريمي، يديرها المشرف
// GET بدون تحقق: يعيد التنبيهات النشطة فقط ليراها كل الزوار
// GET ?all=1 (مشرف فقط): كل التنبيهات (نشطة ومؤرشفة) لإدارتها
// POST (مشرف فقط): إضافة تنبيه جديد
// DELETE ?id=... (مشرف فقط): حذف تنبيه
import { lrangeAll, lpush, del } from './_kv.js';
import { isAuthorized } from './_auth.js';

const LEVELS = ['طوارئ', 'مهم', 'معلومة'];

function clean(v, max) {
  return typeof v === 'string' ? v.trim().slice(0, max) : '';
}

export default async function handler(req, res) {
  if (req.method === 'GET') {
    try {
      const alerts = (await lrangeAll('sanad:alerts'))
        .sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
      if (req.query.all) {
        if (!isAuthorized(req)) {
          return res.status(401).json({ error: 'Unauthorized' });
        }
        return res.status(200).json({ alerts });
      }
      return res.status(200).json({ alerts: alerts.filter(a => a.active !== false) });
    } catch (err) {
      return res.status(502).json({ error: 'Storage error' });
    }
  }

  if (req.method === 'POST') {
    if (!isAuthorized(req)) {
      return res.status(401).json({ error: 'Unauthorized' });
    }
    const b = req.body || {};
    const title = clean(b.title, 100);
    const desc = clean(b.desc, 400);
    const level = LEVELS.includes(b.level) ? b.level : 'معلومة';
    if (!title || !desc) {
      return res.status(400).json({ error: 'Missing required fields' });
    }
    const alert = {
      id: Date.now().toString(36) + Math.random().toString(36).slice(2, 8),
      title, desc, level, active: true,
      createdAt: Date.now(),
      date: new Date().toLocaleDateString('ar-OM')
    };
    try {
      await lpush('sanad:alerts', JSON.stringify(alert));
      return res.status(200).json({ ok: true, alert });
    } catch (err) {
      return res.status(502).json({ error: 'Storage error' });
    }
  }

  if (req.method === 'DELETE') {
    if (!isAuthorized(req)) {
      return res.status(401).json({ error: 'Unauthorized' });
    }
    const id = clean(req.query.id, 40);
    if (!id) {
      return res.status(400).json({ error: 'Invalid request' });
    }
    try {
      const alerts = await lrangeAll('sanad:alerts');
      const remaining = alerts.filter(a => a.id !== id);
      if (remaining.length === alerts.length) {
        return res.status(404).json({ error: 'Not found' });
      }
      await del('sanad:alerts');
      for (let i = remaining.length - 1; i >= 0; i--) {
        await lpush('sanad:alerts', JSON.stringify(remaining[i]));
      }
      return res.status(200).json({ ok: true });
    } catch (err) {
      return res.status(502).json({ error: 'Storage error' });
    }
  }

  return res.status(405).json({ error: 'Method not allowed' });
}
