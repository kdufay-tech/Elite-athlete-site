// AI Coach — Netlify Functions v2 (export default)
// Required: "type":"module" in package.json → v1 handler format causes 404
// Env var: ANTHROPIC_API_KEY
// Reliability: AbortController on Anthropic fetch, empty-message filtering, full error handling

const ALLOWED_ORIGINS = [
  'https://the-elite-athlete.netlify.app',
  'http://localhost:5173',
  'http://localhost:8888',
];

const rateLimitMap = new Map();
const RATE_LIMIT = 30;
const RATE_WINDOW_MS = 60 * 1000;

function checkRateLimit(ip) {
  const now = Date.now();
  const entry = rateLimitMap.get(ip) || { count: 0, windowStart: now };
  if (now - entry.windowStart > RATE_WINDOW_MS) {
    entry.count = 1; entry.windowStart = now;
  } else { entry.count++; }
  rateLimitMap.set(ip, entry);
  if (rateLimitMap.size > 500) {
    for (const [k, v] of rateLimitMap)
      if (now - v.windowStart > RATE_WINDOW_MS * 2) rateLimitMap.delete(k);
  }
  return entry.count > RATE_LIMIT;
}

export default async (req) => {
  const origin = req.headers.get('origin') || '';
  const isAllowed = !origin || ALLOWED_ORIGINS.includes(origin) || origin.includes('netlify.app');
  const corsOrigin = origin || ALLOWED_ORIGINS[0];
  const cors = {
    'Access-Control-Allow-Origin': corsOrigin,
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Content-Type': 'application/json',
  };

  if (req.method === 'OPTIONS') return new Response('', { status: 204, headers: cors });
  if (req.method !== 'POST')
    return new Response(JSON.stringify({ error: 'Method not allowed' }), { status: 405, headers: cors });
  if (!isAllowed)
    return new Response(JSON.stringify({ error: 'Forbidden' }), { status: 403, headers: cors });

  const clientIp = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown';
  if (checkRateLimit(clientIp))
    return new Response(JSON.stringify({ error: 'Too many requests — please wait a moment.' }), { status: 429, headers: cors });

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey)
    return new Response(JSON.stringify({ error: 'AI Coach not configured (missing ANTHROPIC_API_KEY).' }), { status: 500, headers: cors });

  let rawBody = '';
  try {
    rawBody = await req.text();
  } catch (e) {
    return new Response(JSON.stringify({ error: 'Could not read request body.' }), { status: 400, headers: cors });
  }

  if (rawBody.length > 40000)
    return new Response(JSON.stringify({ error: 'Request too large.' }), { status: 413, headers: cors });

  let body;
  try {
    body = JSON.parse(rawBody);
  } catch (e) {
    return new Response(JSON.stringify({ error: 'Invalid JSON body.' }), { status: 400, headers: cors });
  }

  const { system, messages } = body;
  if (!messages || !Array.isArray(messages) || messages.length === 0)
    return new Response(JSON.stringify({ error: 'messages array required.' }), { status: 400, headers: cors });

  // Critical: Anthropic rejects any message with empty string content — filter them out
  const safeMsgs = messages
    .slice(-20)
    .map(m => ({
      role: m.role === 'user' ? 'user' : 'assistant',
      content: (typeof m.content === 'string' ? m.content.trim() : '').slice(0, 4000),
    }))
    .filter(m => m.content.length > 0);  // ← KEY: drop empty messages

  if (safeMsgs.length === 0)
    return new Response(JSON.stringify({ error: 'All messages were empty.' }), { status: 400, headers: cors });

  // Ensure messages alternate correctly (Anthropic requires user/assistant alternation)
  // If last message is assistant, Anthropic will error — guard against this
  if (safeMsgs[safeMsgs.length - 1].role !== 'user') {
    return new Response(JSON.stringify({ error: 'Last message must be from user.' }), { status: 400, headers: cors });
  }

  const safeSystem = (typeof system === 'string' ? system.trim() : '')
    .slice(0, 8000) || 'You are an elite athletic performance coach.';

  // AbortController: kill Anthropic fetch if it takes > 28s
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 28000);

  try {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 1024,
        system: safeSystem,
        messages: safeMsgs,
      }),
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    const data = await response.json();

    if (!response.ok) {
      console.error('Anthropic API error:', response.status, JSON.stringify(data).substring(0, 200));
      return new Response(
        JSON.stringify({ error: data.error?.message || `Anthropic error (${response.status})` }),
        { status: response.status, headers: cors }
      );
    }

    return new Response(JSON.stringify({ content: data.content }), { status: 200, headers: cors });

  } catch (err) {
    clearTimeout(timeoutId);
    const isTimeout = err.name === 'AbortError';
    console.error('Coach error:', isTimeout ? 'Anthropic fetch timed out' : err.message);
    return new Response(
      JSON.stringify({
        error: isTimeout
          ? 'AI Coach timed out — Anthropic API is taking too long. Try again.'
          : `Server error: ${err.message}`,
      }),
      { status: isTimeout ? 504 : 500, headers: cors }
    );
  }
};
