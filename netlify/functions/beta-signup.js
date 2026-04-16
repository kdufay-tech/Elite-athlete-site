// netlify/functions/beta-signup.js
// Validates beta invite code → grants 90-day Elite access via subscriptions table

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Authorization, Content-Type',
  'Content-Type': 'application/json',
};

export default async (req) => {
  if (req.method === 'OPTIONS') return new Response('', { status: 200, headers: CORS });
  if (req.method !== 'POST') return new Response('Method Not Allowed', { status: 405, headers: CORS });

  const authHeader = req.headers.get('authorization') || '';
  if (!authHeader.startsWith('Bearer '))
    return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401, headers: CORS });

  const token       = authHeader.replace('Bearer ', '');
  const supabaseUrl = process.env.SUPABASE_URL;
  const serviceKey  = process.env.SUPABASE_SERVICE_KEY;

  // Verify the calling user
  const userRes = await fetch(`${supabaseUrl}/auth/v1/user`, {
    headers: { apikey: serviceKey, Authorization: `Bearer ${token}` },
  });
  if (!userRes.ok)
    return new Response(JSON.stringify({ error: 'Invalid token' }), { status: 401, headers: CORS });
  const authUser = await userRes.json();

  const { code } = await req.json();
  if (!code)
    return new Response(JSON.stringify({ error: 'Beta code required' }), { status: 400, headers: CORS });

  // Look up the code (service role bypasses RLS)
  const codeRes = await fetch(
    `${supabaseUrl}/rest/v1/beta_codes?code=eq.${encodeURIComponent(code.trim().toUpperCase())}&active=eq.true`,
    { headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}` } }
  );
  const codes = codeRes.ok ? await codeRes.json() : [];
  if (!codes.length)
    return new Response(JSON.stringify({ error: 'Invalid or inactive beta code' }), { status: 404, headers: CORS });

  const betaCode = codes[0];

  // Check max_uses
  if (betaCode.max_uses !== null && betaCode.uses >= betaCode.max_uses)
    return new Response(JSON.stringify({ error: 'Beta code has reached its usage limit' }), { status: 409, headers: CORS });

  // Check if user already has an active subscription (don't downgrade paid users)
  const existingRes = await fetch(
    `${supabaseUrl}/rest/v1/subscriptions?user_id=eq.${authUser.id}`,
    { headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}` } }
  );
  const existing = existingRes.ok ? await existingRes.json() : [];
  const hasPaid = existing.some(s => s.status === 'active' && !s.stripe_customer_id?.startsWith('beta'));
  if (hasPaid)
    return new Response(JSON.stringify({ error: 'You already have an active subscription' }), { status: 409, headers: CORS });

  // Already redeemed a beta code
  const hasBeta = existing.some(s => s.plan_name === 'beta_elite');
  if (hasBeta)
    return new Response(JSON.stringify({ error: 'You have already redeemed a beta code' }), { status: 409, headers: CORS });

  // Grant beta_elite access
  const betaExpiresAt = new Date(Date.now() + betaCode.duration_days * 24 * 60 * 60 * 1000).toISOString();
  const upsertRes = await fetch(`${supabaseUrl}/rest/v1/subscriptions`, {
    method: 'POST',
    headers: {
      apikey: serviceKey, Authorization: `Bearer ${serviceKey}`,
      'Content-Type': 'application/json', Prefer: 'resolution=merge-duplicates',
    },
    body: JSON.stringify({
      user_id: authUser.id, status: 'active', plan_name: 'beta_elite',
      billing_interval: 'beta', beta_expires_at: betaExpiresAt,
      stripe_customer_id: `beta_${betaCode.code}`,
      stripe_subscription_id: `beta_${authUser.id.slice(0,8)}`,
      updated_at: new Date().toISOString(),
    }),
  });
  if (!upsertRes.ok)
    return new Response(JSON.stringify({ error: 'Failed to activate beta access' }), { status: 500, headers: CORS });

  // Increment code usage count
  await fetch(`${supabaseUrl}/rest/v1/beta_codes?id=eq.${betaCode.id}`, {
    method: 'PATCH',
    headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ uses: betaCode.uses + 1 }),
  });

  return new Response(JSON.stringify({
    ok: true,
    message: `Beta access activated — ${betaCode.duration_days} days of Elite access`,
    expires_at: betaExpiresAt,
    code_label: betaCode.label,
  }), { status: 200, headers: CORS });
};
