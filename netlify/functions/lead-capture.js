// netlify/functions/lead-capture.js
// Public POST. One endpoint for every "I'm interested" surface on the web app:
// the Coach Pro waitlist, the landing-page form, a club/trainer tag, a SPRING
// "write me in February" tag. It does exactly one thing - writes a row to the
// capture ledger (lead_events) - and reports failure honestly. The previous
// form confirmed success on a swallowed catch and 602 raised hands were lost.
//
// NOT outreach. Fires only in direct response to a person submitting a form.
// No schedule. Sends one transactional acknowledgement to the submitter
// (Resend, support@) because the acknowledgement is the proof the write
// happened - if the ledger write fails, no acknowledgement is sent.
//
// Body: { email, source?, intent?, channel?, verbatim?, meta?, website? }
//   website = honeypot; any value -> 200 with ok:true and NO write.
//   intent  in  raised_hand | club | spring | note   (public surface only;
//               paid/reply/call intents are written by trusted functions).

import { logLead, contactIdFor, normEmail } from './_lead.js';
import { REPLY_TO } from './_mail.js';

const PUBLIC_INTENTS = new Set(['raised_hand', 'club', 'spring', 'note']);
const POSTAL_ADDRESS = process.env.POSTAL_ADDRESS || 'Taradome Entertainment Group LLC · Georgia, USA';

function cors(origin) {
  const ok = /^(https?|capacitor|ionic):\/\/localhost(:\d+)?$/i.test(origin)
    || /elite-athlete\.app$/i.test(origin) || /netlify\.app$/i.test(origin);
  return {
    'Access-Control-Allow-Origin': ok ? origin : 'https://elite-athlete.app',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Content-Type': 'application/json',
  };
}
const J = (headers, obj, status = 200) => new Response(JSON.stringify(obj), { status, headers });

export default async (req) => {
  const origin  = req.headers.get('origin') || '';
  const headers = cors(origin);
  if (req.method === 'OPTIONS') return new Response('', { status: 200, headers });
  if (req.method !== 'POST')    return J(headers, { error: 'Method not allowed' }, 405);

  const supabaseUrl = process.env.SUPABASE_URL;
  const serviceKey  = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY;
  if (!supabaseUrl || !serviceKey) return J(headers, { error: 'Server not configured' }, 500);

  let body;
  try { body = await req.json(); } catch { return J(headers, { error: 'Invalid request body' }, 400); }

  // Honeypot: bots fill every field. Pretend success, write nothing.
  if (body.website) return J(headers, { ok: true });

  const email = normEmail(body.email);
  if (!email) return J(headers, { error: 'Valid email required' }, 400);

  const intent  = PUBLIC_INTENTS.has(body.intent) ? body.intent : 'raised_hand';
  const source  = String(body.source || 'lead_form').slice(0, 64);
  const channel = body.channel ? String(body.channel).slice(0, 32)
                : (/localhost/i.test(origin) ? 'native' : 'web');

  const contact_id = await contactIdFor(supabaseUrl, serviceKey, email);
  const led = await logLead(supabaseUrl, serviceKey, {
    email, contact_id, source, channel, intent,
    verbatim: body.verbatim ? String(body.verbatim).slice(0, 2000) : null,
    meta: { origin, ua: req.headers.get('user-agent') || null, ...(body.meta && typeof body.meta === 'object' ? body.meta : {}) },
  });
  if (!led.ok) {
    console.error('[lead-capture] ledger write failed:', led.error);
    return J(headers, { error: 'Could not record your request - please try again' }, 500);
  }

  // Acknowledgement = proof of write. Canary rows skip it (they are ours).
  let ack = 'skipped';
  if (source !== 'canary' && process.env.RESEND_API_KEY) {
    try {
      const r = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          from: 'Elite Athlete <support@elite-athlete.app>',
          reply_to: REPLY_TO,
          to: email,
          subject: 'Got it - we have your request',
          text: `We received your request and a person will reply within 48 hours.\n\nIf you did not submit this, reply STOP and we will remove you.\n\nElite Athlete · support@elite-athlete.app\n${POSTAL_ADDRESS}`,
        }),
      });
      ack = r.ok ? 'sent' : `resend ${r.status}`;
    } catch (e) { ack = `error: ${e.message}`; }
  }

  return J(headers, { ok: true, id: led.id, ack });
};
