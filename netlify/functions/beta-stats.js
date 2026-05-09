// netlify/functions/beta-stats.js
// Public endpoint — returns current beta signup count and max cap for landing page counter

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Content-Type': 'application/json',
};

export default async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });

  const supabaseUrl = process.env.SUPABASE_URL;
  const serviceKey  = process.env.SUPABASE_SERVICE_ROLE_KEY;

  try {
    // Get total active beta users
    const countRes = await fetch(
      `${supabaseUrl}/rest/v1/subscriptions?status=eq.active&beta_expires_at=not.is.null&select=id`,
      { headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}`, Prefer: 'count=exact' } }
    );
    const total = parseInt(countRes.headers?.get('content-range')?.split('/')[1] || '0');

    // Get max cap from settings
    const settingsRes = await fetch(
      `${supabaseUrl}/rest/v1/app_settings?key=eq.beta_max_users`,
      { headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}` } }
    );
    const settings = settingsRes.ok ? await settingsRes.json() : [];
    const max = settings[0] ? parseInt(settings[0].value) : 500;

    return new Response(JSON.stringify({
      total,
      max,
      remaining: Math.max(0, max - total),
      beta_full: total >= max,
    }), { status: 200, headers: CORS });

  } catch (err) {
    return new Response(JSON.stringify({ total: 0, max: 500, remaining: 500, beta_full: false }), { status: 200, headers: CORS });
  }
};
