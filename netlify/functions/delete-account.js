// netlify/functions/delete-account.js
// Permanently deletes the calling user's account and ALL their data.
// Required by App Store Guideline 5.1.1(v) — in-app account deletion.
// NOTE: Deleting the account does NOT cancel an active Apple/Stripe
// subscription; the user must cancel via Apple ID / billing settings.

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
  const serviceKey  = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY;

  // Verify the calling user (only they can delete their own account)
  const userRes = await fetch(`${supabaseUrl}/auth/v1/user`, {
    headers: { apikey: serviceKey, Authorization: `Bearer ${token}` },
  });
  if (!userRes.ok)
    return new Response(JSON.stringify({ error: 'Invalid token' }), { status: 401, headers: CORS });
  const authUser = await userRes.json();
  const uid = authUser.id;
  if (!uid)
    return new Response(JSON.stringify({ error: 'No user id' }), { status: 400, headers: CORS });

  const svc = { apikey: serviceKey, Authorization: `Bearer ${serviceKey}` };

  // 1) Delete all user-data rows (service role bypasses RLS).
  const tables = [
    'benchmarks', 'calendar_events', 'check_ins', 'journal_entries',
    'nutrition_logs', 'progress_notes', 'progress_photos', 'subscriptions',
    'weight_logs', 'workout_logs', 'profiles',
  ];
  const failed = [];
  for (const t of tables) {
    const r = await fetch(`${supabaseUrl}/rest/v1/${t}?user_id=eq.${uid}`, {
      method: 'DELETE',
      headers: { ...svc, Prefer: 'return=minimal' },
    });
    if (!r.ok && r.status !== 404) failed.push(`${t}:${r.status}`);
  }

  // 2) Delete progress-photo storage objects (best-effort; bucket = 'progress-photos').
  try {
    await fetch(`${supabaseUrl}/storage/v1/object/list/progress-photos`, {
      method: 'POST',
      headers: { ...svc, 'Content-Type': 'application/json' },
      body: JSON.stringify({ prefix: `${uid}/`, limit: 1000 }),
    }).then(async (lr) => {
      if (!lr.ok) return;
      const objs = await lr.json();
      const names = (objs || []).map(o => `${uid}/${o.name}`);
      if (names.length) {
        await fetch(`${supabaseUrl}/storage/v1/object/progress-photos`, {
          method: 'DELETE',
          headers: { ...svc, 'Content-Type': 'application/json' },
          body: JSON.stringify({ prefixes: names }),
        });
      }
    });
  } catch (e) { /* non-fatal */ }

  // 3) Delete the auth user LAST (Admin API).
  const delRes = await fetch(`${supabaseUrl}/auth/v1/admin/users/${uid}`, {
    method: 'DELETE',
    headers: { ...svc, 'Content-Type': 'application/json' },
  });
  if (!delRes.ok) {
    return new Response(JSON.stringify({
      error: 'Failed to delete account. Please contact support@elite-athlete.app',
      detail: `auth:${delRes.status}`, tables_failed: failed,
    }), { status: 500, headers: CORS });
  }

  return new Response(JSON.stringify({ ok: true, message: 'Account deleted' }),
    { status: 200, headers: CORS });
};
