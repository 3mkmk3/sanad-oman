// دالة خادمة — يستخدمها المشرف فقط لقبول أو رفض طلب تسجيل
import { lrangeAll, lset, lpush } from './_kv.js';
import { isAuthorized } from './_auth.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }
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
