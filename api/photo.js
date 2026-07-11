// دالة خادمة — تجلب صورة حقيقية للمكان من Google Places API (صور خرائط قوقل الرسمية)
// تحتاج متغير البيئة GOOGLE_MAPS_API_KEY — بدونه تعيد 404 ويعرض التطبيق الحرف الأول كالسابق
// المفتاح لا يظهر أبداً للمتصفح، والنتائج تُخزّن مؤقتاً في Redis لتقليل التكلفة
import { get, setex } from './_kv.js';

function clean(value, limit = 300) {
  return String(value || '').trim().slice(0, limit);
}

function queryFromMapUrl(value) {
  try {
    const url = new URL(value);
    return clean(url.searchParams.get('query') || url.searchParams.get('q') || '', 220);
  } catch (err) {
    return '';
  }
}

export default async function handler(req, res) {
  const q = clean(req.query.q, 140);
  const mapQuery = queryFromMapUrl(clean(req.query.map, 500));
  const searchText = clean(mapQuery || q, 220);
  if (!searchText) {
    return res.status(400).json({ error: 'Missing q' });
  }

  const key = process.env.GOOGLE_MAPS_API_KEY;
  if (!key) {
    return res.status(404).json({ error: 'Photos not configured' });
  }

  const cacheKey = 'sanad:photo:' + encodeURIComponent(searchText.toLowerCase());
  try {
    const cached = await get(cacheKey);
    if (cached === 'none') {
      return res.status(404).json({ error: 'No photo' });
    }
    if (cached) {
      res.setHeader('Cache-Control', 'public, max-age=43200, s-maxage=43200');
      res.setHeader('Location', cached);
      return res.status(302).end();
    }
  } catch (err) {}

  try {
    // 1) البحث عن المكان في خرائط قوقل باستخدام رابط الخريطة إن توفر لدقة أعلى
    const sr = await fetch('https://places.googleapis.com/v1/places:searchText', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Goog-Api-Key': key,
        'X-Goog-FieldMask': 'places.photos'
      },
      body: JSON.stringify({
        textQuery: `${searchText} البريمي عمان`,
        pageSize: 1,
        languageCode: 'ar',
        regionCode: 'OM'
      })
    });
    const sdata = await sr.json();
    const foundPlace = sdata.places && sdata.places[0] ? sdata.places[0] : null;
    let photoName =
      foundPlace && foundPlace.photos && foundPlace.photos[0]
        ? foundPlace.photos[0].name
        : '';

    if (!photoName && foundPlace && foundPlace.name) {
      const detailsUrl = new URL(`https://places.googleapis.com/v1/${foundPlace.name}`);
      detailsUrl.searchParams.set('languageCode', 'ar');
      detailsUrl.searchParams.set('regionCode', 'OM');
      const dr = await fetch(detailsUrl, {
        headers: {
          'X-Goog-Api-Key': key,
          'X-Goog-FieldMask': 'photos'
        }
      });
      if (dr.ok) {
        const ddata = await dr.json();
        photoName = ddata.photos && ddata.photos[0] ? ddata.photos[0].name : '';
      }
    }

    if (!photoName) {
      try { await setex(cacheKey, 86400, 'none'); } catch (err) {}
      return res.status(404).json({ error: 'No photo' });
    }

    // 2) جلب رابط الصورة الفعلي (بدون كشف المفتاح للمتصفح)
    const mr = await fetch(
      `https://places.googleapis.com/v1/${photoName}/media?maxWidthPx=800&skipHttpRedirect=true&key=${key}`
    );
    const mdata = await mr.json();
    const uri = mdata.photoUri || '';
    if (!uri) {
      try { await setex(cacheKey, 86400, 'none'); } catch (err) {}
      return res.status(404).json({ error: 'No photo' });
    }

    try { await setex(cacheKey, 43200, uri); } catch (err) {}
    res.setHeader('Cache-Control', 'public, max-age=43200, s-maxage=43200');
    res.setHeader('Location', uri);
    return res.status(302).end();
  } catch (err) {
    return res.status(502).json({ error: 'Photo service error' });
  }
}
