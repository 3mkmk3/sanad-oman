// دالة خادمة موحّدة لدورة حياة تسجيل الأنشطة التجارية
// (دمج requests.js + review.js + submit.js + unpublish.js لتقليل عدد الدوال الخادمة)
// GET (مشرف فقط): كل طلبات التسجيل
// POST action=submit (عام): تسجيل نشاط جديد
// POST action=review (مشرف فقط): قبول/رفض طلب
// POST action=unpublish (مشرف فقط): إزالة نشاط معتمد من القائمة العامة
import { lrangeAll, lset, lpush, del, get, rateLimit } from './_kv.js';
import { isAuthorized } from './_auth.js';

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

async function listRequests(req, res) {
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

async function submitRequest(req, res) {
  const b = req.body || {};
  const name    = clean(b.name, 150);
  const cat     = clean(b.cat, 60);
  const type    = clean(b.type, 60);
  const area    = clean(b.area, 100);
  const phone   = clean(b.phone, 20);
  const wa      = clean(b.wa, 20);
  const hours   = clean(b.hours, 60);
  const desc    = clean(b.desc, 500);
  let map = clean(b.map, 300);
  if (map && !/^https?:\/\//i.test(map)) map = '';
  const photo = cleanPhoto(b.photo);
  const owner   = clean(b.owner, 100);
  const contact = clean(b.contact, 20);

  if (!name || !cat || !type || !area || !phone || !hours || !owner || !contact) {
    return res.status(400).json({ error: 'Missing required fields' });
  }

  const ip = ((req.headers['x-forwarded-for'] || '').split(',')[0] || '').trim() || 'unknown';
  try {
    if (!(await rateLimit(`sanad:rl:submit:${ip}`, 5, 3600))) {
      return res.status(429).json({ error: 'Too many requests' });
    }
  } catch (err) {}

  const request = {
    id: Date.now().toString(36) + Math.random().toString(36).slice(2, 8),
    name, cat, type, area, phone, wa, hours,
    map: map || 'https://maps.google.com/?q=' + encodeURIComponent(name + ' البريمي'),
    photo,
    desc: desc || 'نشاط تجاري في البريمي',
    owner, contact,
    status: 'pending',
    date: new Date().toLocaleDateString('ar-OM')
  };

  try {
    await lpush('sanad:requests', JSON.stringify(request));
    return res.status(200).json({ ok: true });
  } catch (err) {
    return res.status(502).json({ error: 'Storage error' });
  }
}

async function reviewRequest(req, res) {
  if (!isAuthorized(req)) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const { id, status } = req.body || {};
  if (!id || !['approved', 'rejected'].includes(status)) {
    return res.status(400).json({ error: 'Invalid request' });
  }

  try {
    const list = await lrangeAll('sanad:requests');
    const idx = list.findIndex(r => r.id === id);
    if (idx === -1) {
      return res.status(404).json({ error: 'Not found' });
    }

    list[idx].status = status;
    await lset('sanad:requests', idx, JSON.stringify(list[idx]));

    if (status === 'approved') {
      const r = list[idx];
      const place = {
        id: 'reg_' + r.id,
        name: r.name, cat: r.cat, type: r.type, area: r.area, hours: r.hours,
        phone: r.phone, wa: r.wa || '', status: '✅ موثق', map: r.map,
        photo: r.photo || '', desc: r.desc
      };
      await lpush('sanad:places', JSON.stringify(place));
    }

    return res.status(200).json({ ok: true });
  } catch (err) {
    return res.status(502).json({ error: 'Storage error' });
  }
}

async function unpublishRequest(req, res) {
  if (!isAuthorized(req)) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const { id } = req.body || {};
  if (!id) {
    return res.status(400).json({ error: 'Invalid request' });
  }

  try {
    const requests = await lrangeAll('sanad:requests');
    const idx = requests.findIndex(r => r.id === id);
    if (idx === -1) {
      return res.status(404).json({ error: 'Not found' });
    }
    if (requests[idx].status !== 'approved') {
      return res.status(400).json({ error: 'Request is not approved' });
    }

    requests[idx].status = 'removed';
    await lset('sanad:requests', idx, JSON.stringify(requests[idx]));

    const places = await lrangeAll('sanad:places');
    const remaining = places.filter(p => p.id !== 'reg_' + id);
    await del('sanad:places');
    for (let i = remaining.length - 1; i >= 0; i--) {
      await lpush('sanad:places', JSON.stringify(remaining[i]));
    }

    return res.status(200).json({ ok: true });
  } catch (err) {
    return res.status(502).json({ error: 'Storage error' });
  }
}

export default async function handler(req, res) {
  if (req.method === 'GET') {
    return listRequests(req, res);
  }

  if (req.method === 'POST') {
    const action = (req.body && req.body.action) || 'submit';
    if (action === 'submit') return submitRequest(req, res);
    if (action === 'review') return reviewRequest(req, res);
    if (action === 'unpublish') return unpublishRequest(req, res);
    return res.status(400).json({ error: 'Unknown action' });
  }

  return res.status(405).json({ error: 'Method not allowed' });
}
