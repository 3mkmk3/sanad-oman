// دالة خادمة عامة — تستقبل طلب تسجيل نشاط تجاري وتحفظه في قاعدة البيانات
import { lpush, rateLimit } from './_kv.js';

function clean(v, max) {
  return typeof v === 'string' ? v.trim().slice(0, max) : '';
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const b = req.body || {};
  const name    = clean(b.name, 150);
  const cat     = clean(b.cat, 60);
  const type    = clean(b.type, 60);
  const area    = clean(b.area, 100);
  const phone   = clean(b.phone, 20);
  const wa      = clean(b.wa, 20);
  const hours   = clean(b.hours, 60);
  const desc    = clean(b.desc, 500);
  // نقبل روابط الخرائط التي تبدأ بـ http/https فقط
  let map = clean(b.map, 300);
  if (map && !/^https?:\/\//i.test(map)) map = '';
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
