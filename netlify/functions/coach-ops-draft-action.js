// netlify/functions/coach-ops-draft-action.js
// Coach Ops - Phase 2: manage a draft in the approval queue (admin-gated).
// Actions: update (edit subject/body/meta), approve, reject, delete, mark_sent.
// None of these send email; sending is done client-side via marketing-blast
// after approval, then mark_sent records the result here.

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Authorization, Content-Type',
  'Content-Type': 'application/json',
};

const SUPABASE_URL = process.env.SUPABASE_URL;
const SERVICE_KEY  = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY;
const ADMIN_EMAIL  = process.env.ADMIN_EMAIL || 'kiszo@taratechent.com';

async function patch(id, fields) {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/coach_ops_drafts?id=eq.${id}`, {
    method: 'PATCH',
    headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}`, 'Content-Type': 'application/json', Prefer: 'return=representation' },
    body: JSON.stringify(fields),
  });
  return r;
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

    let body = {};
    try { body = await req.json(); } catch (_) {}
    const { id, action } = body;
    if (!id || !action) return new Response(JSON.stringify({ error: 'id and action required' }), { status: 400, headers: CORS });

    let res;
    if (action === 'update') {
      const fields = {};
      if (typeof body.subject === 'string') fields.subject = body.subject;
      if (typeof body.body === 'string') fields.body = body.body;
      if (body.meta && typeof body.meta === 'object') fields.meta = body.meta;
      if (!Object.keys(fields).length) return new Response(JSON.stringify({ error: 'nothing to update' }), { status: 400, headers: CORS });
      res = await patch(id, fields);
    } else if (action === 'approve') {
      res = await patch(id, { status: 'approved', approved_at: new Date().toISOString() });
    } else if (action === 'reject') {
      res = await patch(id, { status: 'rejected' });
    } else if (action === 'mark_sent') {
      res = await patch(id, { status: 'sent', sent_at: new Date().toISOString(), sent_result: body.result || {} });
    } else if (action === 'delete') {
      res = await fetch(`${SUPABASE_URL}/rest/v1/coach_ops_drafts?id=eq.${id}`, {
        method: 'DELETE',
        headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` },
      });
      if (!res.ok) { const e = await res.text().catch(()=> ''); return new Response(JSON.stringify({ error: 'delete failed', detail: e.slice(0,200) }), { status: 500, headers: CORS }); }
      return new Response(JSON.stringify({ ok: true, deleted: id }), { status: 200, headers: CORS });
    } else {
      return new Response(JSON.stringify({ error: 'unknown action' }), { status: 400, headers: CORS });
    }

    if (!res.ok) { const e = await res.text().catch(()=> ''); return new Response(JSON.stringify({ error: 'update failed', detail: e.slice(0,200) }), { status: 500, headers: CORS }); }
    const rows = await res.json().catch(()=> []);
    return new Response(JSON.stringify({ ok: true, draft: rows[0] || null }), { status: 200, headers: CORS });
  } catch (e) {
    return new Response(JSON.stringify({ error: String((e && e.message) || e) }), { status: 500, headers: CORS });
  }
};
