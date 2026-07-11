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
          'reviews.authorAttribution',
          'reviews.rating',
          'reviews.text',
          'reviews.relativePublishTimeDescription',
          'reviews.googleMapsUri',
          'reviews.flagContentUri',
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
      iconMaskBaseUri: safeUrl(place.iconMaskBaseUri),
      iconBackgroundColor: clean(place.iconBackgroundColor, 20),
      reviews,
      reviewsUnavailableReason: !reviews.length && userRatingCount
        ? (legacyStatus === 'REQUEST_DENIED' ? 'legacy_api_disabled' : 'not_returned_by_google')
        : ''
    };
    if (req.query.debug) {
      payload.debug = {
        newReviewCount: newReviews.length,
        legacyStatus,
        legacyError,
        finalReviewCount: reviews.length
      };
    }

    res.setHeader('Cache-Control', 'no-store');
    return res.status(200).json(payload);
  } catch (err) {
    return res.status(502).json({ error: 'Google Places service error' });
  }
}
