// دالة خادمة — للمشرف فقط: إزالة نشاط تم قبوله سابقاً من القائمة العامة
import { lrangeAll, lset, del, lpush } from './_kv.js';
import { isAuthorized } from './_auth.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }
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
