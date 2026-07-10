// دالة خادمة — "اسأل سند": مساعد ذكي يفهم طلب المستخدم بلغة طبيعية
// ويقترح أماكن حقيقية من قاعدة البيانات مع سبب مختصر، بدل تصفح الأقسام يدوياً
import { lrangeAll, rateLimit } from './_kv.js';
import { BASE_PLACES } from './_places.js';

const REPLY_SCHEMA = {
  type: 'object',
  properties: {
    reply: { type: 'string' },
    place_ids: { type: 'array', items: { type: 'string' } }
  },
  required: ['reply', 'place_ids'],
  additionalProperties: false
};

function clean(v, max) {
  return typeof v === 'string' ? v.trim().slice(0, max) : '';
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const b = req.body || {};
  const message = clean(b.message, 300);
  if (!message) {
    return res.status(400).json({ error: 'Invalid request' });
  }
  // نأخذ فقط آخر 6 رسائل من المحادثة كسياق — يكفي للفهم ويبقي التكلفة منخفضة
  const history = (Array.isArray(b.history) ? b.history : [])
    .filter(h => h && (h.role === 'user' || h.role === 'assistant') && typeof h.content === 'string')
    .slice(-6)
    .map(h => ({ role: h.role, content: clean(h.content, 300) }));

  if (!process.env.ANTHROPIC_API_KEY) {
    return res.status(500).json({ error: 'ANTHROPIC_API_KEY is not set' });
  }

  const ip = ((req.headers['x-forwarded-for'] || '').split(',')[0] || '').trim() || 'unknown';
  try {
    if (!(await rateLimit(`sanad:rl:ask:${ip}`, 30, 3600))) {
      return res.status(429).json({ error: 'Too many requests' });
    }
  } catch (err) {}

  // كل الأماكن: الثابتة في التطبيق + المسجلة المعتمدة من قاعدة البيانات
  let placesList = [...BASE_PLACES];
  try {
    placesList = placesList.concat(await lrangeAll('sanad:places'));
  } catch (err) {}

  // متوسط التقييمات لكل مكان — حتى يرشّح المساعد الأعلى تقييماً
  const ratings = {};
  try {
    for (const r of await lrangeAll('sanad:reviews')) {
      const s = ratings[r.placeId] || (ratings[r.placeId] = { sum: 0, count: 0 });
      s.sum += r.stars;
      s.count++;
    }
  } catch (err) {}
  const ratingText = id => {
    const s = ratings[String(id)];
    return s ? `⭐${(s.sum / s.count).toFixed(1)}(${s.count})` : '-';
  };

  const placesText = placesList.slice(0, 250)
    .map(p => `${p.id}|${p.name}|${p.cat}|${p.type}|${p.area}|${p.hours}|${p.status}|${ratingText(p.id)}`)
    .join('\n');

  // الوقت الحالي في عُمان — حتى يعرف المساعد المفتوح الآن من ساعات العمل
  let timeStr = '';
  try {
    timeStr = new Intl.DateTimeFormat('ar-OM', {
      timeZone: 'Asia/Muscat', weekday: 'long', hour: 'numeric', minute: '2-digit', hour12: true
    }).format(new Date());
  } catch (err) {}

  const system = `أنت "سند" — مساعد ذكي محلي داخل تطبيق "سند عمان" لسكان وزوار ولاية البريمي.
${timeStr ? `الوقت الآن في عُمان: ${timeStr}. استخدمه لتقدير الأماكن المفتوحة حالياً من ساعات عملها، ونبّه المستخدم إذا كان المكان مغلقاً الآن.` : ''}
مهمتك: افهم طلب المستخدم (خدمة، مكان، أو نصيحة) وردّ برسالة عربية ودودة ومختصرة (سطران إلى ثلاثة كحد أقصى).
إن وجدت أماكن مناسبة من القائمة أدناه اذكرها بالاسم في ردك وضع معرّفاتها (id) في place_ids (بحد أقصى 3، الأنسب أولاً).
عند تساوي الخيارات قدّم الأعلى تقييماً من الزوار (عمود التقييم الأخير)، واذكر التقييم إن كان مميزاً.
إن لم تجد شيئاً مناسباً في القائمة اعتذر بصدق واترك place_ids فارغة — لا تخترع أماكن أو أرقام هواتف غير موجودة في القائمة.

الأماكن المتوفرة (id|الاسم|القسم|النوع|المنطقة|الساعات|الحالة|التقييم):
${placesText}`;

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
        max_tokens: 500,
        thinking: { type: 'disabled' },
        system,
        output_config: { format: { type: 'json_schema', schema: REPLY_SCHEMA } },
        messages: [...history, { role: 'user', content: message }]
      })
    });

    const data = await r.json();
    if (!r.ok || data.stop_reason === 'refusal') {
      return res.status(502).json({ error: 'AI service error' });
    }
    const text = (data.content || []).filter(x => x.type === 'text').map(x => x.text).join('');
    const parsed = JSON.parse(text);

    const validIds = new Set(placesList.map(p => String(p.id)));
    const placeIds = (parsed.place_ids || []).map(String).filter(id => validIds.has(id)).slice(0, 3);

    return res.status(200).json({ reply: parsed.reply, placeIds });
  } catch (err) {
    return res.status(502).json({ error: 'Upstream error' });
  }
}
