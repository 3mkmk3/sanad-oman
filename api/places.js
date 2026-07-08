// دالة خادمة عامة — تعيد الأنشطة التجارية التي تمت الموافقة عليها ليراها كل الزوار
import { lrangeAll } from './_kv.js';

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const places = await lrangeAll('sanad:places');
    return res.status(200).json({ places });
  } catch (err) {
    return res.status(502).json({ error: 'Storage error' });
  }
}
