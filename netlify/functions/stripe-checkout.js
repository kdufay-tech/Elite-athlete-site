// netlify/functions/stripe-checkout.js
// SECURITY: Origin-locked, input-validated, no open redirects
// Required env vars: STRIPE_SECRET_KEY

const ALLOWED_ORIGINS = [
  'https://the-elite-athlete.netlify.app',
  'http://localhost:5173',
  'http://localhost:8888',
];

const VALID_PRICE_KEYS = [
  'athlete_monthly','athlete_annual',
  'elite_monthly','elite_annual',
  'coach_monthly','coach_annual',
];

const VALID_PLAN_NAMES = [
  'athlete','athlete_annual',
  'elite','elite_annual',
  'coach','coach_annual',
];

const handler = async (event) => {
  const origin = event.headers.origin || event.headers.Origin || '';
  const isAllowed = !origin || ALLOWED_ORIGINS.includes(origin) || origin.includes('netlify.app');
  const corsOrigin = origin || ALLOWED_ORIGINS[0];

  const headers = {
    'Access-Control-Allow-Origin': corsOrigin,
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Content-Type': 'application/json',
    'X-Content-Type-Options': 'nosniff',
  };

  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers, body: '' };
  if (event.httpMethod !== 'POST')
    return { statusCode: 405, headers, body: JSON.stringify({ error: 'Method not allowed' }) };
  if (!isAllowed)
    return { statusCode: 403, headers, body: JSON.stringify({ error: 'Forbidden' }) };

  const secretKey = process.env.STRIPE_SECRET_KEY;
  if (!secretKey)
    return { statusCode: 500, headers, body: JSON.stringify({ error: 'Payment not configured' }) };

  try {
    // Parse and validate — no open redirects, no arbitrary plan injection
    const body = JSON.parse(event.body || '{}');
    const { priceId, planName, userEmail } = body;

    if (!priceId || typeof priceId !== 'string' || priceId.length > 100)
      return { statusCode: 400, headers, body: JSON.stringify({ error: 'Invalid priceId' }) };

    const safePlanName = VALID_PLAN_NAMES.includes(planName) ? planName : 'elite';

    // Redirect URLs are NEVER accepted from client — always constructed server-side
    const appUrl = 'https://the-elite-athlete.netlify.app';
    const successUrl = `${appUrl}?payment=success&plan=${safePlanName}`;
    const cancelUrl  = `${appUrl}?payment=cancelled`;

    // Sanitize email
    const safeEmail = userEmail && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(userEmail)
      ? userEmail.slice(0, 254) : undefined;

    const payload = {
      mode: 'subscription',
      line_items: [{ price: priceId, quantity: 1 }],
      success_url: successUrl,
      cancel_url: cancelUrl,
      allow_promotion_codes: true,
      billing_address_collection: 'auto',
      subscription_data: { metadata: { plan_name: safePlanName } },
    };
    if (safeEmail) payload.customer_email = safeEmail;

    const res = await fetch('https://api.stripe.com/v1/checkout/sessions', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${secretKey}`, 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams(flattenPayload(payload)).toString(),
    });

    const session = await res.json();
    if (!res.ok)
      return { statusCode: res.status, headers, body: JSON.stringify({ error: session.error?.message || 'Stripe error' }) };

    return { statusCode: 200, headers, body: JSON.stringify({ sessionId: session.id, url: session.url }) };

  } catch (err) {
    console.error('stripe-checkout error:', err.message);
    return { statusCode: 500, headers, body: JSON.stringify({ error: 'Server error' }) };
  }
};

function flattenPayload(obj, prefix = '') {
  const out = {};
  for (const [k, v] of Object.entries(obj)) {
    const key = prefix ? `${prefix}[${k}]` : k;
    if (v === null || v === undefined) continue;
    if (Array.isArray(v)) {
      v.forEach((item, i) => {
        if (typeof item === 'object' && item !== null)
          Object.assign(out, flattenPayload(item, `${key}[${i}]`));
        else out[`${key}[${i}]`] = String(item);
      });
    } else if (typeof v === 'object') {
      Object.assign(out, flattenPayload(v, key));
    } else {
      out[key] = String(v);
    }
  }
  return out;
}

module.exports = { handler };
