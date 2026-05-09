// netlify/functions/accept-beta-invite.js
// Called after user signs up via an invite link.
// Validates the token → grants beta access → marks invite accepted.

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

  const userToken  = authHeader.replace('Bearer ', '');
  const supabaseUrl = process.env.SUPABASE_URL;
  const serviceKey  = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY||process.env.SUPABASE_SERVICE_KEY;

  // Verify the calling user's session
  const userRes = await fetch(`${supabaseUrl}/auth/v1/user`, {
    headers: { apikey: serviceKey, Authorization: `Bearer ${userToken}` },
  });
  if (!userRes.ok)
    return new Response(JSON.stringify({ error: 'Invalid session' }), { status: 401, headers: CORS });
  const authUser = await userRes.json();

  const { token } = await req.json();
  if (!token)
    return new Response(JSON.stringify({ error: 'Invite token required' }), { status: 400, headers: CORS });

  // Look up invite by token
  const inviteRes = await fetch(
    `${supabaseUrl}/rest/v1/beta_invites?token=eq.${encodeURIComponent(token)}`,
    { headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}` } }
  );
  const invites = inviteRes.ok ? await inviteRes.json() : [];
  if (!invites.length)
    return new Response(JSON.stringify({ error: 'Invalid invite link' }), { status: 404, headers: CORS });

  const invite = invites[0];

  if (invite.status === 'accepted')
    return new Response(JSON.stringify({ error: 'This invite has already been used' }), { status: 409, headers: CORS });

  if (invite.status === 'expired' || new Date(invite.expires_at) < new Date())
    return new Response(JSON.stringify({ error: 'This invite link has expired' }), { status: 410, headers: CORS });

  // Verify email matches (security check)
  if (invite.email.toLowerCase() !== authUser.email.toLowerCase())
    return new Response(JSON.stringify({ error: 'This invite was sent to a different email address' }), { status: 403, headers: CORS });

  // Check user doesn't already have a subscription
  const existingRes = await fetch(
    `${supabaseUrl}/rest/v1/subscriptions?user_id=eq.${authUser.id}`,
    { headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}` } }
  );
  const existing = existingRes.ok ? await existingRes.json() : [];
  if (existing.some(s => s.status === 'active'))
    return new Response(JSON.stringify({ error: 'You already have an active subscription' }), { status: 409, headers: CORS });

  // Grant beta_elite access
  const betaExpires = new Date(Date.now() + invite.duration_days * 24 * 60 * 60 * 1000).toISOString();
  const grantRes = await fetch(`${supabaseUrl}/rest/v1/subscriptions`, {
    method: 'POST',
    headers: {
      apikey: serviceKey, Authorization: `Bearer ${serviceKey}`,
      'Content-Type': 'application/json', Prefer: 'resolution=merge-duplicates',
    },
    body: JSON.stringify({
      user_id: authUser.id, status: 'active', plan_name: 'beta_elite',
      billing_interval: 'beta', beta_expires_at: betaExpires,
      stripe_customer_id: `beta_invite_${invite.beta_type}`,
      stripe_subscription_id: `beta_invite_${authUser.id.slice(0,8)}`,
      updated_at: new Date().toISOString(),
    }),
  });

  if (!grantRes.ok)
    return new Response(JSON.stringify({ error: 'Failed to activate beta access' }), { status: 500, headers: CORS });

  // Mark invite as accepted
  await fetch(`${supabaseUrl}/rest/v1/beta_invites?token=eq.${encodeURIComponent(token)}`, {
    method: 'PATCH',
    headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ status: 'accepted', accepted_at: new Date().toISOString(), accepted_by: authUser.id }),
  });

  return new Response(JSON.stringify({
    ok: true,
    message: `Beta access activated — ${invite.duration_days} days of Elite access`,
    expires_at: betaExpires,
    beta_type: invite.beta_type,
  }), { status: 200, headers: CORS });
};
