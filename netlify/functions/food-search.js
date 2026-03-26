// Food search proxy — USDA FoodData Central, server-side
// Netlify Functions v2 (export default) — required for ESM projects ("type":"module")
// Env var: USDA_API_KEY
// Reliability: AbortController timeout on outbound fetch, graceful error bodies

const ALLOWED_ORIGINS = [
  'https://the-elite-athlete.netlify.app',
  'http://localhost:5173',
  'http://localhost:8888',
];

const rateLimitMap = new Map();
const RATE_LIMIT = 60;
const RATE_WINDOW_MS = 60 * 1000;

function checkRateLimit(ip) {
  const now = Date.now();
  const entry = rateLimitMap.get(ip) || { count: 0, windowStart: now };
  if (now - entry.windowStart > RATE_WINDOW_MS) {
    entry.count = 1; entry.windowStart = now;
  } else { entry.count++; }
  rateLimitMap.set(ip, entry);
  return entry.count > RATE_LIMIT;
}

export default async (req) => {
  const origin = req.headers.get('origin') || '';
  const corsOrigin = ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0];
  const cors = {
    'Access-Control-Allow-Origin': corsOrigin,
    'Access-Control-Allow-Headers': 'Content-Type',
    'Content-Type': 'application/json',
  };

  if (req.method === 'OPTIONS') return new Response('', { status: 204, headers: cors });

  const clientIp = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown';
  if (checkRateLimit(clientIp))
    return new Response(JSON.stringify({ error: 'Rate limit exceeded. Please wait a moment.' }), { status: 429, headers: cors });

  const reqUrl = new URL(req.url);
  const query = reqUrl.searchParams.get('query') || '';
  if (!query.trim())
    return new Response(JSON.stringify({ error: 'Missing query parameter.' }), { status: 400, headers: cors });

  const apiKey = process.env.USDA_API_KEY || 'DEMO_KEY';

  // AbortController: kill outbound USDA fetch if it takes > 12s
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 12000);

  try {
    const usdaUrl =
      `https://api.nal.usda.gov/fdc/v1/foods/search` +
      `?query=${encodeURIComponent(query)}&pageSize=25&api_key=${apiKey}`;

    const resp = await fetch(usdaUrl, { signal: controller.signal });
    clearTimeout(timeoutId);

    if (!resp.ok) {
      const errText = await resp.text().catch(() => '');
      console.error(`USDA ${resp.status}:`, errText.substring(0, 120));
      return new Response(
        JSON.stringify({ error: `USDA API error (${resp.status}). Try again.`, foods: [] }),
        { status: 502, headers: cors }
      );
    }

    const data = await resp.json();
    return new Response(JSON.stringify(data), { status: 200, headers: cors });

  } catch (err) {
    clearTimeout(timeoutId);
    const isTimeout = err.name === 'AbortError';
    console.error('Food search error:', isTimeout ? 'USDA fetch timed out' : err.message);
    return new Response(
      JSON.stringify({
        error: isTimeout
          ? 'Food search timed out — USDA API is slow. Try again.'
          : 'Food search unavailable. Check your connection.',
        foods: [],
      }),
      { status: 504, headers: cors }
    );
  }
};
