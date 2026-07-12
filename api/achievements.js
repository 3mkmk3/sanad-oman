// دالة خادمة — إنجازات محافظة البريمي (طرق، بنية تحتية، مرافق...)، يديرها المشرف
// GET بدون تحقق: يعيد الإنجازات النشطة فقط ليراها كل الزوار
// GET ?all=1 (مشرف فقط): كل الإنجازات لإدارتها
// POST (مشرف فقط): إضافة إنجاز جديد
// DELETE ?id=... (مشرف فقط): حذف إنجاز
import { lrangeAll, lpush, del } from './_kv.js';
import { isAuthorized } from './_auth.js';

const CATEGORIES = ['طرق', 'بنية تحتية', 'مرافق عامة', 'تعليم وصحة', 'بيئة', 'مشاريع أخرى'];

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

export default async function handler(req, res) {
  if (req.method === 'GET') {
    try {
      const items = (await lrangeAll('sanad:achievements'))
        .sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
      if (req.query.all) {
        if (!isAuthorized(req)) {
          return res.status(401).json({ error: 'Unauthorized' });
        }
        return res.status(200).json({ achievements: items });
      }
      return res.status(200).json({ achievements: items.filter(a => a.active !== false) });
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
    const stat = clean(b.stat, 30);
    const photo = cleanPhoto(b.photo);
    const category = CATEGORIES.includes(b.category) ? b.category : 'مشاريع أخرى';
    if (!title || !desc) {
      return res.status(400).json({ error: 'Missing required fields' });
    }
    const achievement = {
      id: Date.now().toString(36) + Math.random().toString(36).slice(2, 8),
      title, desc, category, stat, photo, active: true,
      createdAt: Date.now(),
      date: new Date().toLocaleDateString('ar-OM')
    };
    try {
      await lpush('sanad:achievements', JSON.stringify(achievement));
      return res.status(200).json({ ok: true, achievement });
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
      const items = await lrangeAll('sanad:achievements');
      const remaining = items.filter(a => a.id !== id);
      if (remaining.length === items.length) {
        return res.status(404).json({ error: 'Not found' });
      }
      await del('sanad:achievements');
      for (let i = remaining.length - 1; i >= 0; i--) {
        await lpush('sanad:achievements', JSON.stringify(remaining[i]));
      }
      return res.status(200).json({ ok: true });
    } catch (err) {
      return res.status(502).json({ error: 'Storage error' });
    }
  }

  return res.status(405).json({ error: 'Method not allowed' });
}
