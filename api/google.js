// دالة خادمة موحّدة لتكامل Google Places — تدمج جلب الصور وجلب التقييم/المراجعات
// (كانتا ملفين منفصلين؛ دُمجتا لتقليل عدد الدوال الخادمة تحت حد خطة Vercel المجانية)
// ?type=photo → صورة حقيقية للمكان (تحويلة 302 لرابط الصورة)
// ?type=place (افتراضي) → تقييم Google وعدد المراجعات ونصوصها وهاتف وساعات العمل
import { get, setex, rateLimit } from './_kv.js';

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

// ===== صورة المكان =====

async function legacyPhotoUri(key, placeId) {
  try {
    const detailsUrl = new URL('https://maps.googleapis.com/maps/api/place/details/json');
    detailsUrl.searchParams.set('place_id', placeId);
    detailsUrl.searchParams.set('fields', 'photo');
    detailsUrl.searchParams.set('language', 'ar');
    detailsUrl.searchParams.set('key', key);

    const details = await fetch(detailsUrl);
    if (!details.ok) return '';
    const data = await details.json();
    const ref = data.status === 'OK' && data.result && data.result.photos && data.result.photos[0]
      ? data.result.photos[0].photo_reference
      : '';
    if (!ref) return '';

    const photoUrl = new URL('https://maps.googleapis.com/maps/api/place/photo');
    photoUrl.searchParams.set('maxwidth', '800');
    photoUrl.searchParams.set('photo_reference', ref);
    photoUrl.searchParams.set('key', key);
    const photo = await fetch(photoUrl, { redirect: 'manual' });
    return photo.headers.get('location') || '';
  } catch (err) {
    return '';
  }
}

async function handlePhoto(req, res, key, searchText) {
  const cacheKey = 'sanad:photo:v3:' + encodeURIComponent(searchText.toLowerCase());
  if (!req.query.debug) {
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
  }

  // نعيد استخدام معرّف المكان المخزن من طلبات النوع "place" لتوفير حصة البحث اليومية
  const gpidKey = 'sanad:gpid:' + encodeURIComponent(searchText.toLowerCase());
  let cachedName = '';
  try {
    const g = await get(gpidKey);
    if (typeof g === 'string' && g.startsWith('places/')) cachedName = g;
  } catch (err) {}

  try {
    let foundPlace = cachedName ? { name: cachedName, id: cachedName.slice(7), photos: null } : null;

    if (!foundPlace) {
      const sr = await fetch('https://places.googleapis.com/v1/places:searchText', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Goog-Api-Key': key,
          'X-Goog-FieldMask': 'places.id,places.name,places.photos'
        },
        body: JSON.stringify({
          textQuery: `${searchText} البريمي عمان`,
          pageSize: 1,
          languageCode: 'ar',
          regionCode: 'OM'
        })
      });
      const sdata = await sr.json();
      if (!sr.ok) {
        if (req.query.debug) {
          return res.status(200).json({ step: 'search', status: sr.status, error: sdata.error || null });
        }
        return res.status(502).json({ error: 'Search failed' });
      }
      foundPlace = sdata.places && sdata.places[0] ? sdata.places[0] : null;
      if (foundPlace && typeof foundPlace.name === 'string' && foundPlace.name.startsWith('places/')) {
        try { await setex(gpidKey, PLACE_ID_TTL_SECONDS, foundPlace.name); } catch (err) {}
      }
    }

    let photoName =
      foundPlace && foundPlace.photos && foundPlace.photos[0]
        ? foundPlace.photos[0].name
        : '';

    if (!photoName && foundPlace && foundPlace.name) {
      const detailsUrl = new URL(`https://places.googleapis.com/v1/${foundPlace.name}`);
      detailsUrl.searchParams.set('languageCode', 'ar');
      detailsUrl.searchParams.set('regionCode', 'OM');
      const dr = await fetch(detailsUrl, {
        headers: { 'X-Goog-Api-Key': key, 'X-Goog-FieldMask': 'photos' }
      });
      if (dr.ok) {
        const ddata = await dr.json();
        photoName = ddata.photos && ddata.photos[0] ? ddata.photos[0].name : '';
      }
    }

    if (!photoName && foundPlace && foundPlace.id) {
      const legacyUri = await legacyPhotoUri(key, foundPlace.id);
      if (legacyUri) {
        try { await setex(cacheKey, 43200, legacyUri); } catch (err) {}
        res.setHeader('Cache-Control', 'public, max-age=43200, s-maxage=43200');
        res.setHeader('Location', legacyUri);
        return res.status(302).end();
      }
    }

    if (!photoName) {
      if (req.query.debug) {
        return res.status(200).json({
          step: 'no-photo',
          placeFound: !!foundPlace,
          placeName: foundPlace ? foundPlace.name : '',
          photosInSearch: foundPlace && foundPlace.photos ? foundPlace.photos.length : 0
        });
      }
      try { await setex(cacheKey, 86400, 'none'); } catch (err) {}
      return res.status(404).json({ error: 'No photo' });
    }

    const mr = await fetch(
      `https://places.googleapis.com/v1/${photoName}/media?maxWidthPx=800&skipHttpRedirect=true&key=${key}`
    );
    const mdata = await mr.json();
    const uri = mdata.photoUri || '';
    if (!uri) {
      if (req.query.debug) {
        return res.status(200).json({ step: 'media', status: mr.status, error: mdata.error || null });
      }
      if (mr.ok) {
        try { await setex(cacheKey, 86400, 'none'); } catch (err) {}
      }
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

// ===== تقييم ومراجعات المكان =====

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

function normalizeLegacyReview(review, placeUrl) {
  return {
    authorName: clean(review.author_name || 'مستخدم Google', 80),
    authorUri: safeUrl(review.author_url),
    authorPhotoUri: safeUrl(review.profile_photo_url),
    rating: Number(review.rating) || 0,
    text: clean(review.text, 1200),
    relativeTime: clean(review.relative_time_description || '', 80),
    googleMapsUri: placeUrl,
    flagContentUri: ''
  };
}

async function legacyDetails(key, placeId) {
  try {
    const url = new URL('https://maps.googleapis.com/maps/api/place/details/json');
    url.searchParams.set('place_id', placeId);
    url.searchParams.set('fields', 'name,rating,user_ratings_total,reviews,url');
    url.searchParams.set('language', 'ar');
    url.searchParams.set('reviews_sort', 'newest');
    url.searchParams.set('reviews_no_translations', 'false');
    url.searchParams.set('key', key);

    const response = await fetch(url);
    if (!response.ok) return { status: 'HTTP_' + response.status, result: null };
    const data = await response.json();
    return {
      status: data.status || '',
      errorMessage: clean(data.error_message || '', 200),
      result: data.status === 'OK' && data.result ? data.result : null
    };
  } catch (err) {
    return { status: 'FETCH_ERROR', result: null };
  }
}

async function handlePlace(req, res, key, searchText) {
  // نعيد النتيجة المخزنة (12 ساعة) بدل استدعاء Google في كل زيارة — توفير كبير في التكلفة
  const payloadKey = 'sanad:gplace:v3:' + encodeURIComponent(searchText.toLowerCase());
  if (!req.query.debug) {
    try {
      const cachedPayload = await get(payloadKey);
      if (cachedPayload) {
        res.setHeader('Cache-Control', 'public, max-age=1800, s-maxage=3600');
        return res.status(200).json(JSON.parse(cachedPayload));
      }
    } catch (err) {}
  }

  // حد أقصى لاستدعاءات Google غير المخزنة لكل زائر — حماية لرصيدك من الإسراف
  const ip = ((req.headers['x-forwarded-for'] || '').split(',')[0] || '').trim() || 'unknown';
  try {
    if (!(await rateLimit(`sanad:rl:gplace:${ip}`, 60, 3600))) {
      return res.status(429).json({ error: 'Too many requests' });
    }
  } catch (err) {}

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

    const detailsUrl = new URL(`https://places.googleapis.com/v1/${placeName}`);
    detailsUrl.searchParams.set('languageCode', 'ar');
    detailsUrl.searchParams.set('regionCode', 'OM');

    const details = await fetch(detailsUrl, {
      headers: {
        'X-Goog-Api-Key': key,
        'X-Goog-FieldMask': [
          'id',
          'displayName',
          'rating',
          'userRatingCount',
          'googleMapsUri',
          'reviews',
          'nationalPhoneNumber',
          'internationalPhoneNumber',
          'regularOpeningHours.weekdayDescriptions',
          'iconMaskBaseUri',
          'iconBackgroundColor'
        ].join(',')
      }
    });

    if (!details.ok) {
      return res.status(502).json({ error: 'Google details failed' });
    }

    const place = await details.json();
    const newReviews = Array.isArray(place.reviews) ? place.reviews.slice(0, 5).map(normalizeReview) : [];
    let rating = typeof place.rating === 'number' ? Number(place.rating.toFixed(1)) : null;
    let userRatingCount = Number(place.userRatingCount) || 0;
    let googleMapsUri = safeUrl(place.googleMapsUri);
    let reviews = newReviews;
    let legacyStatus = '';
    let legacyError = '';

    if (!reviews.length && place.id) {
      const legacy = await legacyDetails(key, place.id);
      legacyStatus = legacy ? legacy.status : '';
      legacyError = legacy ? legacy.errorMessage || '' : '';
      if (legacy && legacy.result) {
        if (typeof legacy.result.rating === 'number') rating = Number(legacy.result.rating.toFixed(1));
        userRatingCount = Number(legacy.result.user_ratings_total) || userRatingCount;
        googleMapsUri = safeUrl(legacy.result.url) || googleMapsUri;
        reviews = Array.isArray(legacy.result.reviews)
          ? legacy.result.reviews.slice(0, 5).map(review => normalizeLegacyReview(review, googleMapsUri))
          : reviews;
      }
    }

    const payload = {
      source: 'Google Maps',
      name: localizedText(place.displayName),
      rating,
      userRatingCount,
      googleMapsUri,
      phone: clean(place.nationalPhoneNumber || place.internationalPhoneNumber || '', 25),
      openingHours: place.regularOpeningHours && Array.isArray(place.regularOpeningHours.weekdayDescriptions)
        ? place.regularOpeningHours.weekdayDescriptions.slice(0, 7).map(d => clean(d, 80))
        : [],
      iconMaskBaseUri: safeUrl(place.iconMaskBaseUri),
      iconBackgroundColor: clean(place.iconBackgroundColor, 20),
      reviews,
      reviewsUnavailableReason: !reviews.length && userRatingCount
        ? (legacyStatus === 'REQUEST_DENIED' ? 'legacy_api_disabled' : 'not_returned_by_google')
        : ''
    };
    try { await setex(payloadKey, 43200, JSON.stringify(payload)); } catch (err) {}

    if (req.query.debug) {
      payload.debug = {
        newReviewCount: newReviews.length,
        legacyStatus,
        legacyError,
        finalReviewCount: reviews.length
      };
    }

    res.setHeader('Cache-Control', 'public, max-age=1800, s-maxage=3600');
    return res.status(200).json(payload);
  } catch (err) {
    return res.status(502).json({ error: 'Google Places service error' });
  }
}

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const type = req.query.type === 'photo' ? 'photo' : 'place';
  const q = clean(req.query.q, 140);
  const mapQuery = queryFromMapUrl(clean(req.query.map, 500));
  const searchText = clean(mapQuery || q, 220);
  if (!searchText) {
    return res.status(400).json({ error: 'Missing q' });
  }

  const key = process.env.GOOGLE_MAPS_API_KEY;
  if (!key) {
    return res.status(404).json({ error: type === 'photo' ? 'Photos not configured' : 'Google Places is not configured' });
  }

  if (type === 'photo') {
    return handlePhoto(req, res, key, searchText);
  }
  return handlePlace(req, res, key, searchText);
}
