// netlify/functions/coach-waitlist.js
// Saves Coach Pro waitlist emails to Supabase
// Required env vars: SUPABASE_URL, SUPABASE_SERVICE_KEY

const ALLOWED_ORIGINS = [
  'https://the-elite-athlete.netlify.app',
  'http://localhost:5173',
  'http://localhost:8888',
];

export default async (req) => {
  const origin = req.headers.get('origin') || '';
  const corsOrigin = ALLOWED_ORIGINS.includes(origin) || origin.includes('netlify.app')
    ? origin : ALLOWED_ORIGINS[0];

  const headers = {
    'Access-Control-Allow-Origin': corsOrigin,
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Content-Type': 'application/json',
  };

  if (req.method === 'OPTIONS') return new Response('', { status: 200, headers });
  if (req.method !== 'POST')
    return new Response(JSON.stringify({ error: 'Method not allowed' }), { status: 405, headers });

  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_SERVICE_KEY;

  if (!supabaseUrl || !supabaseKey)
    return new Response(JSON.stringify({ error: 'Server not configured' }), { status: 500, headers });

  let body;
  try { body = await req.json(); } catch {
    return new Response(JSON.stringify({ error: 'Invalid request body' }), { status: 400, headers });
  }

  const { email } = body;
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
    return new Response(JSON.stringify({ error: 'Valid email required' }), { status: 400, headers });

  const safeEmail = email.trim().toLowerCase().slice(0, 254);

  try {
    const res = await fetch(`${supabaseUrl}/rest/v1/coach_waitlist`, {
      method: 'POST',
      headers: {
        apikey: supabaseKey,
        Authorization: `Bearer ${supabaseKey}`,
        'Content-Type': 'application/json',
        Prefer: 'resolution=ignore-duplicates',
      },
      body: JSON.stringify({ email: safeEmail }),
    });

    if (!res.ok && res.status !== 409) {
      const err = await res.text();
      console.error('Supabase insert error:', err);
      return new Response(JSON.stringify({ error: 'Failed to save — please try again' }), { status: 500, headers });
    }

    // 409 = already on waitlist — still return success (no need to tell them)
    console.log('Waitlist signup:', safeEmail);
    return new Response(JSON.stringify({ ok: true }), { status: 200, headers });

  } catch (err) {
    console.error('coach-waitlist error:', err.message);
    return new Response(JSON.stringify({ error: 'Server error' }), { status: 500, headers });
  }
};
