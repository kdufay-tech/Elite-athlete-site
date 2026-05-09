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
  const serviceKey  = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY||process.env.SUPABASE_SERVICE_KEY;

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

  // sync_beta_uses — recalculate usage counts from subscriptions table
  if (action === 'sync_beta_uses') {
    // Fetch all beta subscriptions
    const subsRes = await fetch(`${supabaseUrl}/rest/v1/subscriptions?plan_name=eq.beta_elite`, {
      headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}` },
    });
    const subs = subsRes.ok ? await subsRes.json() : [];
    // Count uses per code label (stripe_customer_id stores beta_CODENAME)
    const counts = {};
    for (const s of subs) {
      const raw = s.stripe_customer_id || '';
      const code = raw.startsWith('beta_') ? raw.replace('beta_', '').toUpperCase() : null;
      if (code) counts[code] = (counts[code] || 0) + 1;
    }
    // Fetch all codes
    const codesRes = await fetch(`${supabaseUrl}/rest/v1/beta_codes`, {
      headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}` },
    });
    const codes = codesRes.ok ? await codesRes.json() : [];
    // Patch each code with real count
    let updated = 0;
    for (const c of codes) {
      const realCount = counts[c.code.toUpperCase()] || 0;
      if (c.uses !== realCount) {
        await fetch(`${supabaseUrl}/rest/v1/beta_codes?id=eq.${c.id}`, {
          method: 'PATCH',
          headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}`, 'Content-Type': 'application/json', Prefer: 'return=minimal' },
          body: JSON.stringify({ uses: realCount }),
        });
        updated++;
      }
    }
    return new Response(JSON.stringify({ ok: true, message: `Synced ${updated} code(s). Counts: ${JSON.stringify(counts)}` }), { status: 200, headers: CORS });
  }

  // grant_beta — directly write a beta subscription for an existing user
  // body: { email, beta_type: 'athlete'|'coach', duration_days?: number }
  if (action === 'grant_beta') {
    if (!email) return new Response(JSON.stringify({ error: 'email required' }), { status: 400, headers: CORS });
    const authResBeta = await fetch(`${supabaseUrl}/auth/v1/admin/users?per_page=1000`, {
      headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}` },
    });
    const authDataBeta  = await authResBeta.json();
    const authUsersBeta = authDataBeta.users || authDataBeta;
    const targetBeta    = Array.isArray(authUsersBeta)
      ? authUsersBeta.find(u => u.email?.toLowerCase() === email.toLowerCase())
      : null;
    if (!targetBeta)
      return new Response(JSON.stringify({ error: `No account found for ${email}. The user must sign up first before beta access can be granted.` }), { status: 404, headers: CORS });
    const betaType    = body.beta_type || 'athlete';
    const days        = body.duration_days
      ? parseInt(body.duration_days)
      : betaType === 'coach' ? 45 : 30;
    const betaExpires = new Date(Date.now() + days * 24 * 60 * 60 * 1000).toISOString();
    const res = await fetch(`${supabaseUrl}/rest/v1/subscriptions`, {
      method: 'POST',
      headers: {
        apikey: serviceKey, Authorization: `Bearer ${serviceKey}`,
        'Content-Type': 'application/json', Prefer: 'resolution=merge-duplicates',
      },
      body: JSON.stringify({
        user_id: targetBeta.id, status: 'active', plan_name: 'beta_elite',
        billing_interval: 'beta', beta_expires_at: betaExpires,
        stripe_customer_id: `beta_admin_${betaType}`,
        stripe_subscription_id: `beta_admin_${targetBeta.id.slice(0,8)}`,
        updated_at: new Date().toISOString(),
      }),
    });
    if (!res.ok) return new Response(JSON.stringify({ error: await res.text() }), { status: 500, headers: CORS });
    return new Response(JSON.stringify({ ok: true, message: `Beta access granted to ${email} — ${days} days (${betaType}, expires ${new Date(betaExpires).toLocaleDateString('en-US',{month:'short',day:'numeric',year:'numeric'})})` }), { status: 200, headers: CORS });
  }

  // Bulk delete invites
  if (action === 'bulk_delete_invites') {
    const ids = body.ids;
    if (!ids || !ids.length) return new Response(JSON.stringify({ error: 'ids required' }), { status: 400, headers: CORS });
    const idList = ids.map(id => `"${id}"`).join(',');
    const res = await fetch(
      `${supabaseUrl}/rest/v1/beta_invites?id=in.(${idList})`,
      { method: 'DELETE', headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}`, Prefer: 'return=minimal' } }
    );
    if (!res.ok) {
      const errText = await res.text();
      return new Response(JSON.stringify({ error: errText || 'Bulk delete failed' }), { status: 500, headers: CORS });
    }
    return new Response(JSON.stringify({ ok: true, deleted: ids.length }), { status: 200, headers: CORS });
  }

  // Delete invite — must be before email-required check
  if (action === 'delete_invite') {
    const { id } = body;
    if (!id) return new Response(JSON.stringify({ error: 'id required' }), { status: 400, headers: CORS });
    const res = await fetch(
      `${supabaseUrl}/rest/v1/beta_invites?id=eq.${id}`,
      { method: 'DELETE', headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}`, Prefer: 'return=minimal' } }
    );
    if (!res.ok) {
      const errText = await res.text();
      return new Response(JSON.stringify({ error: errText || 'Delete failed' }), { status: 500, headers: CORS });
    }
    return new Response(JSON.stringify({ ok: true }), { status: 200, headers: CORS });
  }

  // revoke_beta_user — revoke by user_id directly (no email needed)
  if (action === 'revoke_beta_user') {
    const targetId = body.user_id;
    if (!targetId) return new Response(JSON.stringify({ error: 'user_id required' }), { status: 400, headers: CORS });
    const res = await fetch(
      `${supabaseUrl}/rest/v1/subscriptions?user_id=eq.${targetId}`,
      {
        method: 'PATCH',
        headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'inactive', updated_at: new Date().toISOString() }),
      }
    );
    if (!res.ok) return new Response(JSON.stringify({ error: await res.text() }), { status: 500, headers: CORS });
    return new Response(JSON.stringify({ ok: true, message: `Beta access revoked for ${body.email || targetId}` }), { status: 200, headers: CORS });
  }

  // delete_waitlist — remove single entry (no email needed)
  if (action === 'delete_waitlist') {
    const { id } = body;
    if (!id) return new Response(JSON.stringify({ error: 'id required' }), { status: 400, headers: CORS });
    const res = await fetch(
      `${supabaseUrl}/rest/v1/coach_waitlist?id=eq.${id}`,
      { method: 'DELETE', headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}`, Prefer: 'return=minimal' } }
    );
    if (!res.ok) return new Response(JSON.stringify({ error: await res.text() }), { status: 500, headers: CORS });
    return new Response(JSON.stringify({ ok: true }), { status: 200, headers: CORS });
  }

  // bulk_delete_waitlist — remove multiple entries (no email needed)
  if (action === 'bulk_delete_waitlist') {
    const ids = body.ids;
    if (!ids?.length) return new Response(JSON.stringify({ error: 'ids required' }), { status: 400, headers: CORS });
    const idList = ids.map(id => `"${id}"`).join(',');
    const res = await fetch(
      `${supabaseUrl}/rest/v1/coach_waitlist?id=in.(${idList})`,
      { method: 'DELETE', headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}`, Prefer: 'return=minimal' } }
    );
    if (!res.ok) return new Response(JSON.stringify({ error: await res.text() }), { status: 500, headers: CORS });
    return new Response(JSON.stringify({ ok: true, deleted: ids.length }), { status: 200, headers: CORS });
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
