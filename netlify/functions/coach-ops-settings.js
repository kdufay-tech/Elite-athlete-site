// netlify/functions/coach-ops-settings.js
// Coach Ops - operating mode (Manual vs Automatic) + guardrails.
// GET: return the single settings row. POST: update it. Admin-gated.
// The auto-runner (coach-ops-auto) reads this row server-side to decide
// whether to generate/approve/send on its schedule. Manual is the default
// and the kill switch: mode='manual' makes the runner a no-op.

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Authorization, Content-Type',
  'Content-Type': 'application/json',
};

const SUPABASE_URL = process.env.SUPABASE_URL;
const SERVICE_KEY  = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY;
const ADMIN_EMAIL  = process.env.ADMIN_EMAIL || 'kiszo@taratechent.com';

const KNOWN_KINDS = ['reengagement', 'coach_outreach', 'content', 'lifecycle'];

async function readSettings() {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/coach_ops_settings?id=eq.1&select=*`, {
    headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` },
  });
  const rows = r.ok ? await r.json() : [];
  return rows[0] || null;
}

export default async (req) => {
  if (req.method === 'OPTIONS') return new Response('', { status: 204, headers: CORS });
  try {
    if (!SUPABASE_URL || !SERVICE_KEY) {
      return new Response(JSON.stringify({ error: 'Server not configured' }), { status: 500, headers: CORS });
    }
    const token = (req.headers.get('authorization') || '').replace('Bearer ', '').trim();
    const ur = token ? await fetch(`${SUPABASE_URL}/auth/v1/user`, { headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${token}` } }) : null;
    const u = ur && ur.ok ? await ur.json() : null;
    if (!u || u.email !== ADMIN_EMAIL) {
      return new Response(JSON.stringify({ error: 'Admin access required' }), { status: 403, headers: CORS });
    }

    if (req.method === 'GET') {
      const s = await readSettings();
      return new Response(JSON.stringify({ ok: true, settings: s }), { status: 200, headers: CORS });
    }

    if (req.method !== 'POST') {
      return new Response(JSON.stringify({ error: 'Method not allowed' }), { status: 405, headers: CORS });
    }

    let body = {};
    try { body = await req.json(); } catch (_) {}

    const fields = { updated_at: new Date().toISOString() };
    if (body.mode === 'manual' || body.mode === 'auto') fields.mode = body.mode;
    if (typeof body.auto_approve === 'boolean') fields.auto_approve = body.auto_approve;
    if (typeof body.auto_send === 'boolean') fields.auto_send = body.auto_send;
    if (Array.isArray(body.auto_kinds)) fields.auto_kinds = body.auto_kinds.filter(k => KNOWN_KINDS.includes(k));
    if (Number.isInteger(body.daily_send_cap) && body.daily_send_cap >= 0) fields.daily_send_cap = body.daily_send_cap; // 0 = unlimited

    // Convenience: flipping to auto with no explicit flags = full auto (their chosen default)
    if (fields.mode === 'auto' && body.auto_approve === undefined && body.auto_send === undefined) {
      fields.auto_approve = true;
      fields.auto_send = true;
      if (!Array.isArray(body.auto_kinds)) fields.auto_kinds = KNOWN_KINDS.slice();
    }
    // Flipping to manual is the kill switch: stop approving and sending automatically.
    if (fields.mode === 'manual') {
      fields.auto_approve = false;
      fields.auto_send = false;
    }

    const r = await fetch(`${SUPABASE_URL}/rest/v1/coach_ops_settings?id=eq.1`, {
      method: 'PATCH',
      headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}`, 'Content-Type': 'application/json', Prefer: 'return=representation' },
      body: JSON.stringify(fields),
    });
    if (!r.ok) { const e = await r.text().catch(()=> ''); return new Response(JSON.stringify({ error: 'update failed', detail: e.slice(0,200) }), { status: 500, headers: CORS }); }
    const rows = await r.json().catch(()=> []);
    return new Response(JSON.stringify({ ok: true, settings: rows[0] || null }), { status: 200, headers: CORS });
  } catch (e) {
    return new Response(JSON.stringify({ error: String((e && e.message) || e) }), { status: 500, headers: CORS });
  }
};
