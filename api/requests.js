// دالة خادمة — يستخدمها المشرف فقط لعرض كل طلبات التسجيل
import { lrangeAll } from './_kv.js';
import { isAuthorized } from './_auth.js';

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }
  if (!isAuthorized(req)) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const requests = await lrangeAll('sanad:requests');
    return res.status(200).json({ requests });
  } catch (err) {
    return res.status(502).json({ error: 'Storage error' });
  }
}
