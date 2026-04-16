// netlify/functions/admin-action.js
// ESM — grant or revoke Elite access for any user by email (admin only)

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
  const ADMIN_EMAIL = process.env.ADMIN_EMAIL;
  const supabaseUrl = process.env.SUPABASE_URL;
  const serviceKey  = process.env.SUPABASE_SERVICE_KEY;

  // Verify admin
  const userRes = await fetch(`${supabaseUrl}/auth/v1/user`, {
    headers: { apikey: serviceKey, Authorization: `Bearer ${token}` },
  });
  if (!userRes.ok) return new Response(JSON.stringify({ error: 'Invalid token' }), { status: 401, headers: CORS });
  const caller = await userRes.json();
  if (caller.email !== ADMIN_EMAIL)
    return new Response(JSON.stringify({ error: 'Forbidden' }), { status: 403, headers: CORS });

  const body = await req.json();
  const { action, email } = body;
  if (!action) return new Response(JSON.stringify({ error: 'action required' }), { status: 400, headers: CORS });

  // Code management actions — no user lookup needed
  if (action === 'create_beta_code') {
    const newCode = (body.code || '').trim().toUpperCase();
    if (!newCode) return new Response(JSON.stringify({ error: 'code required' }), { status: 400, headers: CORS });
    const res = await fetch(`${supabaseUrl}/rest/v1/beta_codes`, {
      method: 'POST',
      headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}`, 'Content-Type': 'application/json', Prefer: 'return=representation' },
      body: JSON.stringify({ code: newCode, label: body.label || newCode, max_uses: body.max_uses || null, duration_days: body.duration_days || 90, active: true }),
    });
    if (!res.ok) return new Response(JSON.stringify({ error: await res.text() }), { status: 500, headers: CORS });
    return new Response(JSON.stringify({ ok: true, message: `Beta code ${newCode} created` }), { status: 200, headers: CORS });
  }

  if (action === 'toggle_beta_code') {
    if (!body.code_id) return new Response(JSON.stringify({ error: 'code_id required' }), { status: 400, headers: CORS });
    const res = await fetch(`${supabaseUrl}/rest/v1/beta_codes?id=eq.${body.code_id}`, {
      method: 'PATCH',
      headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ active: body.active }),
    });
    if (!res.ok) return new Response(JSON.stringify({ error: await res.text() }), { status: 500, headers: CORS });
    return new Response(JSON.stringify({ ok: true, message: `Code ${body.active ? 'activated' : 'deactivated'}` }), { status: 200, headers: CORS });
  }

  // User-targeting actions — require email
  if (!email) return new Response(JSON.stringify({ error: 'email required' }), { status: 400, headers: CORS });

  // Look up target user by email via auth admin API
  const authRes = await fetch(
    `${supabaseUrl}/auth/v1/admin/users?per_page=1000`,
    { headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}` } }
  );
  const authData  = await authRes.json();
  const authUsers = authData.users || authData;
  const target    = Array.isArray(authUsers)
    ? authUsers.find(u => u.email?.toLowerCase() === email.toLowerCase())
    : null;

  if (!target)
    return new Response(JSON.stringify({ error: `No user found with email: ${email}` }), { status: 404, headers: CORS });

  const userId = target.id;

  if (action === 'grant') {
    // Upsert active Elite subscription (test record — 1 year from now)
    const periodEnd = new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString();
    const res = await fetch(`${supabaseUrl}/rest/v1/subscriptions`, {
      method: 'POST',
      headers: {
        apikey: serviceKey, Authorization: `Bearer ${serviceKey}`,
        'Content-Type': 'application/json',
        Prefer: 'resolution=merge-duplicates',
      },
      body: JSON.stringify({
        user_id: userId, status: 'active', plan_name: 'Elite Membership',
        billing_interval: 'month', current_period_end: periodEnd,
        stripe_customer_id: 'test_admin_grant',
        stripe_subscription_id: `test_${userId.slice(0,8)}`,
        updated_at: new Date().toISOString(),
      }),
    });
    if (!res.ok) return new Response(JSON.stringify({ error: await res.text() }), { status: 500, headers: CORS });
    return new Response(JSON.stringify({ ok: true, message: `Elite access granted to ${email}` }), { status: 200, headers: CORS });
  }

  if (action === 'revoke') {
    const res = await fetch(
      `${supabaseUrl}/rest/v1/subscriptions?user_id=eq.${userId}`,
      {
        method: 'PATCH',
        headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'inactive', updated_at: new Date().toISOString() }),
      }
    );
    if (!res.ok) return new Response(JSON.stringify({ error: await res.text() }), { status: 500, headers: CORS });
    return new Response(JSON.stringify({ ok: true, message: `Access revoked for ${email}` }), { status: 200, headers: CORS });
  }

  return new Response(JSON.stringify({ error: 'Unknown action' }), { status: 400, headers: CORS });
};
