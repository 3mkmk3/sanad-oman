// طبقة تخزين بسيطة تتصل بـ Upstash Redis عبر REST API (بدون أي حزمة خارجية)
// تحتاج متغيرات البيئة: KV_REST_API_URL و KV_REST_API_TOKEN

const BASE = process.env.KV_REST_API_URL;
const TOKEN = process.env.KV_REST_API_TOKEN;

async function command(args) {
  if (!BASE || !TOKEN) {
    throw new Error('KV_REST_API_URL / KV_REST_API_TOKEN غير مضبوطة');
  }
  const r = await fetch(BASE, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${TOKEN}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(args)
  });
  const data = await r.json();
  if (data.error) throw new Error(data.error);
  return data.result;
}

export function lpush(key, value) {
  return command(['LPUSH', key, value]);
}

export async function lrangeAll(key) {
  const result = await command(['LRANGE', key, '0', '-1']);
  return (result || []).map(v => JSON.parse(v));
}

export function lset(key, index, value) {
  return command(['LSET', key, String(index), value]);
}
