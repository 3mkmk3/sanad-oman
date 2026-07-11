// دالة خادمة على Vercel — تبني موجّه الرحلة على الخادم ثم تتصل بـ Claude API
// المفتاح السري يُقرأ من متغير البيئة ANTHROPIC_API_KEY ولا يظهر أبداً للمتصفح
// الموجّه يُبنى هنا من خيارات محددة فقط، فلا يمكن لأي زائر استخدام المفتاح لأغراض أخرى
import { lrangeAll, rateLimit } from './_kv.js';

const DAYS = [1, 2, 3, 5];
const TRIPS = ['عائلة', 'أصدقاء', 'منفرد'];
const INTERESTS = ['تاريخ وتراث', 'طبيعة وجبال', 'مطاعم وأكل', 'تسوق', 'عائلة وأطفال', 'استراحة وهدوء'];

const BASE_TOUR = ['Buraimi National Park', 'Al Khandaq Fort', 'Al Hillah Castle', 'Falaj Saraa', 'منتزه الواحة', 'جامع السلطان قابوس الكبير', 'سوق الجو الشعبي', 'البريمي سيتي سنتر', 'لولو هايبرماركت'];
const BASE_REST = ['Sultan Karak', 'Nafhat Burger', 'رمال ضنك', 'SEKKA77 Restaurant', 'Line Cafe', 'دار الكرك', 'مخبز النيادي الحديث', 'The M Sweets'];

// مخطط JSON يضمن أن يعيد النموذج جدولاً صالحاً دائماً (structured outputs)
const PLAN_SCHEMA = {
  type: 'object',
  properties: {
    title: { type: 'string' },
    summary: { type: 'string' },
    days: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          day: { type: 'integer' },
          title: { type: 'string' },
          activities: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                time: { type: 'string' },
                place: { type: 'string' },
                desc: { type: 'string' }
              },
              required: ['time', 'place', 'desc'],
              additionalProperties: false
            }
          }
        },
        required: ['day', 'title', 'activities'],
        additionalProperties: false
      }
    }
  },
  required: ['title', 'summary', 'days'],
  additionalProperties: false
};

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const b = req.body || {};
  const days = Number(b.days);
  const trip = b.trip;
  const interests = Array.isArray(b.interests) ? b.interests.filter(i => INTERESTS.includes(i)) : [];
  if (!DAYS.includes(days) || !TRIPS.includes(trip) || !interests.length) {
    return res.status(400).json({ error: 'Invalid request' });
  }

  if (!process.env.ANTHROPIC_API_KEY) {
    return res.status(500).json({ error: 'ANTHROPIC_API_KEY is not set' });
  }

  const ip = ((req.headers['x-forwarded-for'] || '').split(',')[0] || '').trim() || 'unknown';
  try {
    if (!(await rateLimit(`sanad:rl:plan:${ip}`, 20, 3600))) {
      return res.status(429).json({ error: 'Too many requests' });
    }
  } catch (err) {}

  // نضيف الأنشطة المعتمدة من قاعدة البيانات إلى قوائم الأماكن
  const tour = [...BASE_TOUR];
  const rest = [...BASE_REST];
  try {
    for (const p of await lrangeAll('sanad:places')) {
      const name = typeof p.name === 'string' ? p.name.slice(0, 150) : '';
      if (!name) continue;
      if (p.cat === 'السياحة والترفيه') tour.push(name);
      if (p.cat === 'المطاعم والمقاهي') rest.push(name);
    }
  } catch (err) {}

  const prompt = `أنت مرشد سياحي خبير في البريمي، سلطنة عُمان.
خطط رحلة مدتها ${days} ${days === 1 ? 'يوم' : 'أيام'}، نوع الرحلة: ${trip}، الاهتمامات: ${interests.join('، ')}.
الأماكن السياحية المتاحة: ${tour.join('، ')}.
المطاعم والمقاهي: ${rest.join('، ')}.
أنشئ جدولاً واقعياً من ${days} ${days === 1 ? 'يوم' : 'أيام'} بالضبط، مع 3-5 أنشطة لكل يوم بأوقات مناسبة، واستخدم الأماكن المذكورة قدر الإمكان.`;

  try {
    const r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: 'claude-sonnet-5',
        max_tokens: 2500,
        thinking: { type: 'disabled' },
        output_config: { format: { type: 'json_schema', schema: PLAN_SCHEMA } },
        messages: [{ role: 'user', content: prompt }]
      })
    });

    const data = await r.json();
    if (!r.ok || data.stop_reason === 'refusal') {
      return res.status(502).json({ error: 'AI service error' });
    }
    const text = (data.content || []).filter(x => x.type === 'text').map(x => x.text).join('');
    const plan = JSON.parse(text);
    return res.status(200).json({ plan });
  } catch (err) {
    return res.status(502).json({ error: 'Upstream error' });
  }
}
