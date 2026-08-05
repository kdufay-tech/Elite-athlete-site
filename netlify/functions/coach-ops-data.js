// netlify/functions/coach-ops-data.js
// Coach Ops panel data — admin-gated read of KPI snapshots + run audit log.
// Mirrors admin-data.js auth pattern. Read-only.

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

  const get = async (path) => {
    const r = await fetch(`${supabaseUrl}/rest/v1/${path}`, {
      headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}` },
    });
    return r.ok ? r.json() : [];
  };

  const snapshots = await get('kpi_snapshots?select=id,week_start,captured_at,metrics,digest&order=week_start.desc&limit=12');
  const runs      = await get('coach_ops_runs?select=id,run_type,status,started_at,finished_at,detail,created_at&order=created_at.desc&limit=10');

  return new Response(JSON.stringify({
    latest: snapshots[0] || null,
    snapshots,
    runs,
  }), { status: 200, headers: CORS });
};
