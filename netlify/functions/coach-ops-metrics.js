// netlify/functions/coach-ops-metrics.js
// Admin-gated read of per-tranche delivery funnel (from the tranche_metrics view).
// Coach tranches only (sport is not null). Read-only. Mirrors coach-ops-data auth.

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Authorization, Content-Type',
  'Content-Type': 'application/json',
};

export default async (req) => {
  if (req.method === 'OPTIONS') return new Response('', { status: 200, headers: CORS });
  if (req.method !== 'GET') return new Response('Method Not Allowed', { status: 405, headers: CORS });

  const authHeader = req.headers.get('authorization') || '';
  if (!authHeader.startsWith('Bearer ')) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401, headers: CORS });
  }
  const token       = authHeader.replace('Bearer ', '');
  const ADMIN_EMAIL = process.env.ADMIN_EMAIL;
  const supabaseUrl = process.env.SUPABASE_URL;
  const serviceKey  = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY;
  if (!supabaseUrl || !serviceKey) {
    return new Response(JSON.stringify({ error: 'Server not configured' }), { status: 500, headers: CORS });
  }

  const userRes = await fetch(`${supabaseUrl}/auth/v1/user`, {
    headers: { apikey: serviceKey, Authorization: `Bearer ${token}` },
  });
  if (!userRes.ok) return new Response(JSON.stringify({ error: 'Invalid token' }), { status: 401, headers: CORS });
  const userJson = await userRes.json();
  if (userJson.email !== ADMIN_EMAIL) {
    return new Response(JSON.stringify({ error: 'Forbidden' }), { status: 403, headers: CORS });
  }

  // Coach tranches only (sport present). Webhook went live 2026-08-12 00:18 UTC;
  // tranches sent before that have no tracked delivery/open events (Resend dashboard
  // holds their true numbers) — the UI flags this.
  const WEBHOOK_LIVE = '2026-08-12T00:18:00Z';
  const r = await fetch(
    `${supabaseUrl}/rest/v1/tranche_metrics?sport=not.is.null&select=*`,
    { headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}` } }
  );
  const rows = r.ok ? await r.json() : [];
  const tranches = rows.map((t) => ({ ...t, tracked: new Date(t.sent_at) >= new Date(WEBHOOK_LIVE) }));

  return new Response(JSON.stringify({ tranches, webhook_live: WEBHOOK_LIVE }), { status: 200, headers: CORS });
};
