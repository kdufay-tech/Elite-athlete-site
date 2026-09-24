// netlify/functions/lead-canary.js
// Daily scheduled check that the capture path is alive. NOT outreach: it
// emails nobody but the founder, and only on failure.
//
//   1. POST a canary submission to the public lead-capture endpoint.
//   2. Read lead_events back and require a matching row created in the last
//      10 minutes.
//   3. If either step fails, email eku@taradome.com "CANARY FAILED - all sends
//      are blocked until this passes" and exit non-zero.
//
// Why: the previous waitlist form reported success while storing nothing for
// four weeks. A machine that notices silence is the fix. (council 2026-09-10,
// pre-send gate 2)
//
// Schedule lives in netlify.toml. It is the ONLY scheduled function and it is
// unrelated to the paused outreach schedules removed in adf0a2d.

import { logLead } from './_lead.js';
import { ALERT_TO, REPLY_TO } from './_mail.js';

const SITE   = process.env.URL || 'https://elite-athlete.app';
const ALERT  = process.env.CANARY_ALERT_TO ? process.env.CANARY_ALERT_TO.split(',').map(x=>x.trim()) : ALERT_TO;
const CANARY = 'canary@elite-athlete.app';

async function alert(subject, text) {
  const key = process.env.RESEND_API_KEY;
  if (!key) { console.error('[canary] no RESEND_API_KEY - cannot alert:', subject, text); return; }
  await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from: 'Elite Athlete <support@elite-athlete.app>', reply_to: REPLY_TO, to: ALERT, subject, text }),
  }).catch(e => console.error('[canary] alert failed', e));
}

export default async () => {
  const supabaseUrl = process.env.SUPABASE_URL;
  const serviceKey  = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY;
  const stamp = new Date().toISOString();
  const problems = [];

  // 1. Through the public door, exactly as a browser would.
  try {
    const r = await fetch(`${SITE}/.netlify/functions/lead-capture`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Origin: 'https://elite-athlete.app' },
      body: JSON.stringify({ email: CANARY, source: 'canary', intent: 'note', meta: { stamp } }),
    });
    const t = await r.text();
    if (!r.ok) problems.push(`lead-capture returned ${r.status}: ${t.slice(0, 200)}`);
  } catch (e) { problems.push(`lead-capture unreachable: ${e.message}`); }

  // 2. Read it back. A write that cannot be read back did not happen.
  try {
    const since = new Date(Date.now() - 10 * 60 * 1000).toISOString();
    const r = await fetch(`${supabaseUrl}/rest/v1/lead_events?select=id,created_at,meta&email=eq.${encodeURIComponent(CANARY)}&created_at=gte.${since}&order=created_at.desc&limit=5`,
      { headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}` } });
    const rows = r.ok ? await r.json() : [];
    if (!rows.some(x => x.meta?.stamp === stamp)) problems.push('canary row not found in lead_events within 10 minutes');
  } catch (e) { problems.push(`ledger read failed: ${e.message}`); }

  // 3. Record the check itself (so a missing daily row is also a signal).
  await logLead(supabaseUrl, serviceKey, {
    email: CANARY, source: 'canary', intent: 'canary',
    meta: { stamp, ok: problems.length === 0, problems },
  });

  if (problems.length) {
    await alert('CANARY FAILED - Elite Athlete capture path is down',
      `The daily capture canary failed at ${stamp}.\n\n${problems.map(p => '- ' + p).join('\n')}\n\nALL OUTBOUND SENDS ARE BLOCKED until a canary passes (council 2026-09-10, gate 2).`);
    return new Response(JSON.stringify({ ok: false, problems }), { status: 500 });
  }
  return new Response(JSON.stringify({ ok: true, stamp }), { status: 200 });
};

// Schedule: declared in netlify.toml ([functions."lead-canary"] schedule), not here.
