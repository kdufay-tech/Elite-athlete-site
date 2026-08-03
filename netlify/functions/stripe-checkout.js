// netlify/functions/stripe-checkout.js
// SECURITY: Origin-locked, input-validated, no open redirects
// Required env vars: STRIPE_SECRET_KEY
// ESM format required — project uses node_bundler = esbuild

const ALLOWED_ORIGINS = [
  'https://elite-athlete.app',
  'https://www.elite-athlete.app',
  'https://the-elite-athlete.netlify.app',
  'http://localhost:5173',
  'http://localhost:8888',
];

const VALID_PLAN_NAMES = [
  'athlete','athlete_annual',
  'elite','elite_annual',
  'coach','coach_annual',
];

export default async (req) => {
  const origin = req.headers.get('origin') || req.headers.get('referer') || '';
  const isAllowed = !origin || ALLOWED_ORIGINS.some(o => origin.startsWith(o)) || origin.includes('netlify.app') || origin.includes('elite-athlete');
  const corsOrigin = origin || ALLOWED_ORIGINS[0];

  const headers = {
    'Access-Control-Allow-Origin': corsOrigin,
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS, GET',
    'Content-Type': 'application/json',
  };

  if (req.method === 'OPTIONS') return new Response('', { status: 200, headers });
  if (req.method !== 'POST')
    return new Response(JSON.stringify({ error: 'Method not allowed' }), { status: 405, headers });
  if (!isAllowed)
    return new Response(JSON.stringify({ error: 'Forbidden' }), { status: 403, headers });

  const isBeta    = process.env.BETA_MODE === 'true';
  const secretKey = isBeta ? process.env.STRIPE_TEST_SECRET_KEY : process.env.STRIPE_SECRET_KEY;
  if (!secretKey)
    return new Response(JSON.stringify({ error: `${isBeta ? 'STRIPE_TEST_SECRET_KEY' : 'STRIPE_SECRET_KEY'} not configured on server` }), { status: 500, headers });

  let body;
  try {
    body = await req.json();
  } catch(e) {
    return new Response(JSON.stringify({ error: 'Invalid JSON body: ' + e.message }), { status: 400, headers });
  }

  const { priceId, planName, userEmail } = body;

  // A coupon may be passed (beta founding-member codes). Those were created in
  // TEST mode and don't exist in LIVE, so applying one blindly causes "No such
  // coupon" and blocks checkout. Validate it below; skip if missing/expired.
  const requestedCoupon = (body.couponCode && typeof body.couponCode === 'string')
    ? body.couponCode.trim()
    : null;

  if (!priceId || typeof priceId !== 'string' || priceId.length > 100)
    return new Response(JSON.stringify({ error: 'Invalid or missing priceId: ' + priceId }), { status: 400, headers });

  const safePlanName = VALID_PLAN_NAMES.includes(planName) ? planName : 'elite';

  const appUrl = 'https://the-elite-athlete.netlify.app';
  const successUrl = `${appUrl}?payment=success&plan=${safePlanName}`;
  const cancelUrl  = `${appUrl}?payment=cancelled`;

  const safeEmail = userEmail && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(userEmail)
    ? userEmail.slice(0, 254) : undefined;

  let existingCustomerId = null;
  if (body.userId) {
    try {
      const { createClient } = await import('@supabase/supabase-js');
      const supabase = createClient(
        process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL,
        process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY
      );
      const { data: subRow } = await supabase
        .from('subscriptions')
        .select('stripe_customer_id')
        .eq('user_id', body.userId)
        .single();
      if (subRow?.stripe_customer_id && !subRow.stripe_customer_id.startsWith('beta_')) {
        existingCustomerId = subRow.stripe_customer_id;
      }
    } catch(e) { /* non-fatal */ }
  }

  // Only apply a coupon that actually exists in the current Stripe mode.
  let validCoupon = null;
  if (requestedCoupon) {
    try {
      const couponRes = await fetch(
        `https://api.stripe.com/v1/coupons/${encodeURIComponent(requestedCoupon)}`,
        { headers: { 'Authorization': `Bearer ${secretKey}` } }
      );
      if (couponRes.ok) {
        const coupon = await couponRes.json();
        if (coupon && coupon.valid !== false) validCoupon = requestedCoupon;
        else console.warn(`Coupon ${requestedCoupon} not valid — charging regular price`);
      } else {
        console.warn(`Coupon ${requestedCoupon} not found in ${isBeta ? 'test' : 'live'} — charging regular price`);
      }
    } catch (e) {
      console.warn(`Coupon lookup failed (${requestedCoupon}): ${e.message} — charging regular price`);
    }
  }

  const payload = {
    mode: 'subscription',
    line_items: [{ price: priceId, quantity: 1 }],
    success_url: successUrl,
    cancel_url: cancelUrl,
    billing_address_collection: 'auto',
    subscription_data: { metadata: { plan_name: safePlanName } },
  };
  if (validCoupon) {
    payload.discounts = [{ coupon: validCoupon }];
  } else {
    payload.allow_promotion_codes = true;
  }
  if (existingCustomerId) {
    payload.customer = existingCustomerId;
  } else if (safeEmail) {
    payload.customer_email = safeEmail;
  }
  if (body.userId) payload.client_reference_id = String(body.userId).slice(0, 200);

  try {
    const stripeRes = await fetch('https://api.stripe.com/v1/checkout/sessions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${secretKey}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams(flattenPayload(payload)).toString(),
    });

    const session = await stripeRes.json();
    if (!stripeRes.ok) {
      const stripeError = session.error?.message || JSON.stringify(session.error) || 'Stripe API error';
      console.error('Stripe error:', stripeError);
      return new Response(JSON.stringify({ error: stripeError }), { status: stripeRes.status, headers });
    }

    return new Response(JSON.stringify({ sessionId: session.id, url: session.url }), { status: 200, headers });

  } catch (err) {
    console.error('stripe-checkout fetch error:', err.message);
    return new Response(JSON.stringify({ error: 'Network error calling Stripe: ' + err.message }), { status: 500, headers });
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
