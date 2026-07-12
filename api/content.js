// دالة خادمة موحّدة للمحتوى الذي يديره المشرف: تنبيهات البريمي وإنجازات المحافظة
// (دمج alerts.js + achievements.js لتقليل عدد الدوال الخادمة تحت حد خطة Vercel المجانية)
// ?type=alert (افتراضي) أو ?type=achievement يحدد أي قائمة نتعامل معها
// GET بدون تحقق: العناصر النشطة فقط
// GET ?all=1 (مشرف فقط): كل العناصر
// POST (مشرف فقط): إضافة عنصر جديد
// DELETE ?id=... (مشرف فقط): حذف عنصر
import { lrangeAll, lpush, del } from './_kv.js';
import { isAuthorized } from './_auth.js';

const ALERT_LEVELS = ['طوارئ', 'مهم', 'معلومة'];
const ACHIEVEMENT_CATEGORIES = ['طرق', 'بنية تحتية', 'مرافق عامة', 'تعليم وصحة', 'بيئة', 'مشاريع أخرى'];

function clean(v, max) {
  return typeof v === 'string' ? v.trim().slice(0, max) : '';
}

function cleanPhoto(v) {
  const photo = clean(v, 250000);
  if (!photo) return '';
  if (/^https?:\/\//i.test(photo)) return photo.slice(0, 500);
  if (/^data:image\/(?:png|jpe?g|webp);base64,[a-z0-9+/=]+$/i.test(photo) && photo.length <= 240000) {
    return photo;
  }
  return '';
}

function resolveType(value) {
  return value === 'achievement' ? 'achievement' : 'alert';
}

function storageKey(type) {
  return type === 'achievement' ? 'sanad:achievements' : 'sanad:alerts';
}

function responseKey(type) {
  return type === 'achievement' ? 'achievements' : 'alerts';
}

function buildItem(type, b) {
  const title = clean(b.title, 100);
  const desc = clean(b.desc, 400);
  if (!title || !desc) return null;

  const base = {
    id: Date.now().toString(36) + Math.random().toString(36).slice(2, 8),
    title, desc, active: true,
    createdAt: Date.now(),
    date: new Date().toLocaleDateString('ar-OM')
  };

  if (type === 'achievement') {
    return {
      ...base,
      category: ACHIEVEMENT_CATEGORIES.includes(b.category) ? b.category : 'مشاريع أخرى',
      stat: clean(b.stat, 30),
      photo: cleanPhoto(b.photo)
    };
  }
  return {
    ...base,
    level: ALERT_LEVELS.includes(b.level) ? b.level : 'معلومة'
  };
}

export default async function handler(req, res) {
  const type = resolveType(req.query.type || (req.body && req.body.type));
  const key = storageKey(type);
  const respKey = responseKey(type);

  if (req.method === 'GET') {
    try {
      const items = (await lrangeAll(key))
        .sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
      if (req.query.all) {
        if (!isAuthorized(req)) {
          return res.status(401).json({ error: 'Unauthorized' });
        }
        return res.status(200).json({ [respKey]: items });
      }
      return res.status(200).json({ [respKey]: items.filter(a => a.active !== false) });
    } catch (err) {
      return res.status(502).json({ error: 'Storage error' });
    }
  }

  if (req.method === 'POST') {
    if (!isAuthorized(req)) {
      return res.status(401).json({ error: 'Unauthorized' });
    }
    const item = buildItem(type, req.body || {});
    if (!item) {
      return res.status(400).json({ error: 'Missing required fields' });
    }
    try {
      await lpush(key, JSON.stringify(item));
      return res.status(200).json({ ok: true, [type]: item });
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
      const items = await lrangeAll(key);
      const remaining = items.filter(a => a.id !== id);
      if (remaining.length === items.length) {
        return res.status(404).json({ error: 'Not found' });
      }
      await del(key);
      for (let i = remaining.length - 1; i >= 0; i--) {
        await lpush(key, JSON.stringify(remaining[i]));
      }
      return res.status(200).json({ ok: true });
    } catch (err) {
      return res.status(502).json({ error: 'Storage error' });
    }
  }

  return res.status(405).json({ error: 'Method not allowed' });
}
