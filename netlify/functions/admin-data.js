// netlify/functions/admin-data.js
// ESM format — matches other functions in this project
// Uses raw fetch (no SDK) and same env var names as stripe-webhook.js

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
  const serviceKey  = process.env.SUPABASE_SERVICE_KEY;

  if (!supabaseUrl || !serviceKey) {
    return new Response(JSON.stringify({ error: 'Server not configured' }), { status: 500, headers: CORS });
  }

  // Verify token — get the calling user's email
  const userRes = await fetch(`${supabaseUrl}/auth/v1/user`, {
    headers: { apikey: serviceKey, Authorization: `Bearer ${token}` },
  });
  if (!userRes.ok) return new Response(JSON.stringify({ error: 'Invalid token' }), { status: 401, headers: CORS });
  const userJson = await userRes.json();
  if (userJson.email !== ADMIN_EMAIL) {
    return new Response(JSON.stringify({ error: 'Forbidden' }), { status: 403, headers: CORS });
  }

  // Active subscriptions
  const subRes = await fetch(
    `${supabaseUrl}/rest/v1/subscriptions?status=eq.active&order=updated_at.desc`,
    { headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}` } }
  );
  const subscriptions = subRes.ok ? await subRes.json() : [];

  // Profiles for subscribed user IDs
  const userIds = subscriptions.map(s => s.user_id).filter(Boolean);
  let profileMap = {};
  if (userIds.length > 0) {
    const ids = userIds.map(id => `"${id}"`).join(',');
    const profRes = await fetch(
      `${supabaseUrl}/rest/v1/profiles?user_id=in.(${ids})&select=user_id,name,sport,position`,
      { headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}` } }
    );
    if (profRes.ok) {
      const profiles = await profRes.json();
      profiles.forEach(p => { profileMap[p.user_id] = p; });
    }
  }

  // Auth emails via admin users list
  let emailMap = {};
  try {
    const authRes = await fetch(`${supabaseUrl}/auth/v1/admin/users?per_page=1000`, {
      headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}` },
    });
    if (authRes.ok) {
      const authData = await authRes.json();
      const authUsers = authData.users || authData;
      if (Array.isArray(authUsers)) authUsers.forEach(u => { emailMap[u.id] = u.email; });
    }
  } catch (e) { console.error('Auth users fetch failed:', e.message); }

  // Enrich subscriptions
  const enrichedSubs = subscriptions.map(s => ({
    id:                 s.id,
    user_id:            s.user_id,
    email:              emailMap[s.user_id] || '—',
    name:               profileMap[s.user_id]?.name     || 'Unknown',
    sport:              profileMap[s.user_id]?.sport     || '—',
    position:           profileMap[s.user_id]?.position  || '—',
    plan_name:          s.plan_name          || 'Elite',
    billing_interval:   s.billing_interval   || 'month',
    current_period_end: s.current_period_end || null,
    stripe_customer_id: s.stripe_customer_id || '—',
  }));

  // Waitlist
  const wlRes = await fetch(
    `${supabaseUrl}/rest/v1/coach_waitlist?order=created_at.desc`,
    { headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}` } }
  );
  const waitlist = wlRes.ok ? await wlRes.json() : [];

  // MRR
  const monthly = subscriptions.filter(s => s.billing_interval !== 'year').length;
  const annual  = subscriptions.filter(s => s.billing_interval === 'year').length;
  const mrr     = (monthly * 9.99) + (annual * (79.99 / 12));

  return new Response(JSON.stringify({
    subscribers:      enrichedSubs,
    waitlist,
    mrr:              mrr.toFixed(2),
    totalSubscribers: enrichedSubs.length,
    monthlyCount:     monthly,
    annualCount:      annual,
    waitlistCount:    waitlist.length,
  }), { status: 200, headers: CORS });
};
