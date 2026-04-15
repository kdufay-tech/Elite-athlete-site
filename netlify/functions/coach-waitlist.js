// netlify/functions/coach-waitlist.js
// Saves Coach Pro waitlist emails to Supabase + sends confirmation via EmailJS
// EmailJS public key is intentionally embedded — it is a public-facing credential

const ALLOWED_ORIGINS = [
  'https://the-elite-athlete.netlify.app',
  'http://localhost:5173',
  'http://localhost:8888',
];

// EmailJS credentials (public — same values baked into the frontend bundle)
const EJ_SERVICE  = 'service_y9mu20h';
const EJ_PUBLIC   = 'k01H630sJxtDTafHK';
const EJ_TEMPLATE = 'template_waitlist'; // create this template in EmailJS dashboard

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

  // 1. Save to Supabase
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
    console.log('Waitlist signup:', safeEmail);
  } catch (err) {
    console.error('Supabase error:', err.message);
    return new Response(JSON.stringify({ error: 'Server error' }), { status: 500, headers });
  }

  // 2. Send confirmation email via EmailJS REST API
  try {
    await fetch('https://api.emailjs.com/api/v1.0/email/send', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        service_id:  EJ_SERVICE,
        template_id: EJ_TEMPLATE,
        user_id:     EJ_PUBLIC,
        template_params: {
          to_email:   safeEmail,
          reply_to:   'support@elite-athlete.com',
          from_name:  'Elite Athlete — Coach Pro',
          subject:    "You're on the Coach Pro Waitlist ◆",
          message:    buildConfirmationEmail(safeEmail),
        },
      }),
    });
  } catch (err) {
    // Email failure is non-fatal — the signup is already saved
    console.error('EmailJS send failed:', err.message);
  }

  return new Response(JSON.stringify({ ok: true }), { status: 200, headers });
};

function buildConfirmationEmail(email) {
  return `
Hi Coach,

You're officially on the Elite Athlete Coach Pro waitlist. ◆

We'll reach out to you directly at ${email} when Coach Pro launches in Q3 2026 — 
you'll get early access and founding member pricing before it opens to the public.

WHAT'S COMING IN COACH PRO:
───────────────────────────
◆ Coach Dashboard — full roster readiness at a glance
◆ Athlete Invite & Roster Management
◆ Program Delivery — push workouts to your entire team
◆ Team Wellness Feed — aggregated check-in data across the roster
◆ Per-Athlete Billing — $4.99/athlete/month

PRICING (Founding Member):
◆ $99/month base + $4.99/athlete/month
◆ or $899/year base + $39.99/athlete/year

You're among the first coaches to sign up. We'll be in touch.

— The Elite Athlete Team
Taradome Entertainment Group, LLC

elite-athlete.netlify.app
support@elite-athlete.com

──────────────────────────────────────────
You received this because you joined the Coach Pro waitlist.
To be removed, reply with "unsubscribe".
`.trim();
}
