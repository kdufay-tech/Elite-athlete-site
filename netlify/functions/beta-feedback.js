// netlify/functions/beta-feedback.js
// Saves beta tester feedback to Supabase beta_feedback table

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
  const serviceKey  = process.env.SUPABASE_SERVICE_KEY;

  // Verify user
  const userRes = await fetch(`${supabaseUrl}/auth/v1/user`, {
    headers: { apikey: serviceKey, Authorization: `Bearer ${token}` },
  });
  if (!userRes.ok)
    return new Response(JSON.stringify({ error: 'Invalid token' }), { status: 401, headers: CORS });
  const authUser = await userRes.json();

  const { category, rating, message, page } = await req.json();
  if (!message?.trim())
    return new Response(JSON.stringify({ error: 'Message required' }), { status: 400, headers: CORS });

  const res = await fetch(`${supabaseUrl}/rest/v1/beta_feedback`, {
    method: 'POST',
    headers: {
      apikey: serviceKey, Authorization: `Bearer ${serviceKey}`,
      'Content-Type': 'application/json', Prefer: 'return=minimal',
    },
    body: JSON.stringify({
      user_id:  authUser.id,
      email:    authUser.email,
      category: category || 'general',
      rating:   rating   || null,
      message:  message.trim(),
      page:     page     || null,
    }),
  });

  if (!res.ok)
    return new Response(JSON.stringify({ error: 'Failed to save feedback' }), { status: 500, headers: CORS });

  return new Response(JSON.stringify({ ok: true }), { status: 200, headers: CORS });
};
