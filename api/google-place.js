import { get, setex } from './_kv.js';

const PLACE_ID_TTL_SECONDS = 60 * 60 * 24 * 30;

function clean(value, limit = 300) {
  return String(value || '').trim().slice(0, limit);
}

function localizedText(value) {
  if (!value) return '';
  if (typeof value === 'string') return value;
  return value.text || '';
}

function safeUrl(value) {
  const url = String(value || '');
  return /^https?:\/\//i.test(url) ? url : '';
}

function queryFromMapUrl(value) {
  try {
    const url = new URL(value);
    return clean(url.searchParams.get('query') || url.searchParams.get('q') || '', 220);
  } catch (err) {
    return '';
  }
}

async function cachedPlaceName(cacheKey) {
  try {
    const cached = await get(cacheKey);
    return typeof cached === 'string' && cached.startsWith('places/') ? cached : '';
  } catch (err) {
    return '';
  }
}

async function rememberPlaceName(cacheKey, placeName) {
  try {
    await setex(cacheKey, PLACE_ID_TTL_SECONDS, placeName);
  } catch (err) {}
}

function normalizeReview(review) {
  const author = review.authorAttribution || {};
  return {
    authorName: clean(author.displayName || 'مستخدم Google', 80),
    authorUri: safeUrl(author.uri),
    authorPhotoUri: safeUrl(author.photoUri),
    rating: Number(review.rating) || 0,
    text: localizedText(review.text),
    relativeTime: clean(review.relativePublishTimeDescription || '', 80),
    googleMapsUri: safeUrl(review.googleMapsUri),
    flagContentUri: safeUrl(review.flagContentUri)
  };
}

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const key = process.env.GOOGLE_MAPS_API_KEY;
  if (!key) {
    return res.status(404).json({ error: 'Google Places is not configured' });
  }

  const rawQuery = clean(req.query.q, 140);
  const mapQuery = queryFromMapUrl(clean(req.query.map, 500));
  const searchText = clean(mapQuery || rawQuery, 220);
  if (!searchText) {
    return res.status(400).json({ error: 'Missing q' });
  }

  const cacheKey = 'sanad:gpid:' + encodeURIComponent(searchText.toLowerCase());
  let placeName = await cachedPlaceName(cacheKey);

  try {
    if (!placeName) {
      const search = await fetch('https://places.googleapis.com/v1/places:searchText', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Goog-Api-Key': key,
          'X-Goog-FieldMask': 'places.name'
        },
        body: JSON.stringify({
          textQuery: `${searchText} البريمي عمان`,
          pageSize: 1,
          languageCode: 'ar',
          regionCode: 'OM'
        })
      });

      if (!search.ok) {
        return res.status(502).json({ error: 'Google search failed' });
      }

      const searchData = await search.json();
      placeName = searchData.places && searchData.places[0] && searchData.places[0].name;
      if (!placeName || !placeName.startsWith('places/')) {
        return res.status(404).json({ error: 'Place not found' });
      }
      await rememberPlaceName(cacheKey, placeName);
    }

    const details = await fetch(`https://places.googleapis.com/v1/${placeName}`, {
      headers: {
        'X-Goog-Api-Key': key,
        'X-Goog-FieldMask': [
          'id',
          'displayName',
          'rating',
          'userRatingCount',
          'googleMapsUri',
          'reviews',
          'iconMaskBaseUri',
          'iconBackgroundColor'
        ].join(',')
      }
    });

    if (!details.ok) {
      return res.status(502).json({ error: 'Google details failed' });
    }

    const place = await details.json();
    const payload = {
      source: 'Google Maps',
      name: localizedText(place.displayName),
      rating: typeof place.rating === 'number' ? Number(place.rating.toFixed(1)) : null,
      userRatingCount: Number(place.userRatingCount) || 0,
      googleMapsUri: safeUrl(place.googleMapsUri),
      iconMaskBaseUri: safeUrl(place.iconMaskBaseUri),
      iconBackgroundColor: clean(place.iconBackgroundColor, 20),
      reviews: Array.isArray(place.reviews) ? place.reviews.slice(0, 5).map(normalizeReview) : []
    };

    res.setHeader('Cache-Control', 'no-store');
    return res.status(200).json(payload);
  } catch (err) {
    return res.status(502).json({ error: 'Google Places service error' });
  }
}
