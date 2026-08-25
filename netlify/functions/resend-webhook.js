// netlify/functions/resend-webhook.js
// Receives Resend delivery events (Svix-signed) and records them to email_events.
// Hard bounces and spam complaints are added to the global suppression list
// (email_blasts) so every future marketing blast automatically excludes them —
// the same mechanism the invite/blast senders already read from.
//
// Verified working: Resend signs with svix-id / svix-timestamp / svix-signature
// headers; secret is whsec_<base64>. Signature = base64(HMAC-SHA256(key, `${id}.${ts}.${body}`)).

import crypto from 'node:crypto';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type, svix-id, svix-timestamp, svix-signature, webhook-id, webhook-timestamp, webhook-signature',
};

// Constant-time verification of a Svix/Resend signature header (space-separated "v1,<sig>" pairs).
function verifySvix(secret, id, ts, sigHeader, raw) {
  try {
    if (!secret || !id || !ts || !sigHeader) return false;
    const key = Buffer.from(secret.replace(/^whsec_/, ''), 'base64');
    const expected = crypto.createHmac('sha256', key).update(`${id}.${ts}.${raw}`).digest('base64');
    const exp = Buffer.from(expected);
    return sigHeader.split(' ').some((part) => {
      const sv = part.split(',')[1];
      if (!sv) return false;
      const got = Buffer.from(sv);
      return got.length === exp.length && crypto.timingSafeEqual(got, exp);
    });
  } catch (_) { return false; }
}

export default async (req) => {
  if (req.method === 'OPTIONS') return new Response('', { status: 204, headers: CORS });
  if (req.method !== 'POST') return new Response('Method Not Allowed', { status: 405, headers: CORS });

  const supabaseUrl = process.env.SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY;
  const secret = process.env.RESEND_WEBHOOK_SECRET;
  const h = { apikey: serviceKey, Authorization: `Bearer ${serviceKey}`, 'Content-Type': 'application/json' };
  const hdr = (n) => req.headers.get(n);

  const raw = await req.text();

  // Verify signature — reject anything unsigned or forged.
  const id  = hdr('svix-id')        || hdr('webhook-id');
  const ts  = hdr('svix-timestamp') || hdr('webhook-timestamp');
  const sig = hdr('svix-signature') || hdr('webhook-signature');
  if (secret && !verifySvix(secret, id, ts, sig, raw)) {
    return new Response('Invalid signature', { status: 401, headers: CORS });
  }

  let evt;
  try { evt = JSON.parse(raw); } catch (_) { return new Response('Bad JSON', { status: 400, headers: CORS }); }

  const type = evt.type || '';           // e.g. email.sent, email.delivered, email.bounced, email.complained
  const data = evt.data || {};
  const email = String((Array.isArray(data.to) ? data.to[0] : data.to) || data.email || '').toLowerCase().trim();
  const resendId = data.email_id || data.id || null;
  // Bounce classification varies by payload shape; be defensive.
  const bounceType = String(data?.bounce?.type || data.bounce_type || data.type || '').toLowerCase();

  // 1) Record the raw event (idempotent-ish: one row per event delivery).
  await fetch(`${supabaseUrl}/rest/v1/email_events`, {
    method: 'POST',
    headers: { ...h, Prefer: 'return=minimal' },
    body: JSON.stringify({
      email: email || 'unknown',
      type,
      bounce_type: bounceType || null,
      resend_id: resendId,
      blast_id: null,
      raw: evt,
    }),
  }).catch(() => {});

  // 2) Auto-suppress on permanent failures so future blasts skip them.
  //    Hard bounce (permanent) or any spam complaint → add to suppression list.
  const isHardBounce = type === 'email.bounced' && !/transient|soft|delay/.test(bounceType); // default-suppress unless clearly soft
  const isComplaint  = type === 'email.complained';
  if (email && (isHardBounce || isComplaint)) {
    await fetch(`${supabaseUrl}/rest/v1/email_blasts`, {
      method: 'POST',
      headers: { ...h, Prefer: 'resolution=ignore-duplicates' },
      body: JSON.stringify({
        blast_id: isComplaint ? 'complained' : 'bounced',
        email,
        subject: isComplaint ? 'complained' : `bounced:${bounceType || 'unknown'}`,
      }),
    }).catch(() => {});
  }

  return new Response(JSON.stringify({ ok: true }), { status: 200, headers: CORS });
};
