// ─────────────────────────────────────────────────────────────
// netlify/functions/_ops-guard.js
// Caller authentication and the outreach kill switch for functions that were
// only ever meant to be invoked by a schedule.
//
// WHAT WENT WRONG
//   coach-followup, beta-followup and beta-expiry-reminder had NO caller
//   authentication of any kind - no verifyCaller, no admin check, no 401 path.
//   They did not need one while Netlify was the only caller.
//
//   adf0a2d removed their schedules for the council pause. That stopped the
//   timer and left the endpoints deployed, public and unauthenticated. Anyone
//   who could guess the URL could POST and trigger a real send: coach-followup
//   mails the 3/5/7-day cold sequence to every coach in the tranche window,
//   from support@elite-athlete.app.
//
//   The pause was real but incomplete. Removing the way something is normally
//   triggered is not the same as closing the door it is triggered through.
//
// FAIL CLOSED
//   With OPS_TRIGGER_SECRET unset, every call is refused. That is deliberate:
//   nothing legitimately calls these today, so denying by default closes the
//   hole the moment this deploys, with no env var to remember first.
//
//   IF A SCHEDULE IS EVER RESTORED: Netlify invokes scheduled functions
//   internally and cannot present this secret. Re-read this guard before
//   restoring any schedule in netlify.toml - do not simply delete the check.
// ─────────────────────────────────────────────────────────────

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Authorization, Content-Type, X-Ops-Secret',
  'Content-Type': 'application/json',
};

/**
 * Refuse anyone who cannot present the operator secret.
 * @returns {Response|null} a 401/503 to return immediately, or null to proceed.
 */
export function requireOpsSecret(req) {
  const expected = process.env.OPS_TRIGGER_SECRET;
  if (!expected) {
    console.warn('ops-guard: OPS_TRIGGER_SECRET unset - refusing (fail closed)');
    return new Response(JSON.stringify({ error: 'Endpoint disabled' }),
      { status: 503, headers: CORS });
  }
  const header = req.headers.get('x-ops-secret')
    || (req.headers.get('authorization') || '').replace(/^Bearer\s+/i, '');

  // Length check first so a mismatch cannot be timed, then constant-time-ish
  // compare. This secret gates outbound mail, so it is worth the care.
  if (!header || header.length !== expected.length) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401, headers: CORS });
  }
  let diff = 0;
  for (let i = 0; i < expected.length; i++) diff |= header.charCodeAt(i) ^ expected.charCodeAt(i);
  if (diff !== 0) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401, headers: CORS });
  }
  return null;
}

/**
 * The coach cold-outreach kill switch, read from coach_ops_settings.
 *
 * coach-ops-auto already honours this row. coach-followup did not - it sends
 * the follow-up steps of the SAME cold sequence, so pausing the first email
 * while the follow-ups still ran would have been a pause in name only.
 *
 * Not applied to beta mail: those go to people who already signed up, and are
 * not the cold outreach the council paused.
 *
 * @returns {Promise<{allowed:boolean, reason:string}>}
 */
export async function outreachAllowed(supabaseUrl, serviceKey) {
  try {
    const r = await fetch(
      `${supabaseUrl}/rest/v1/coach_ops_settings?id=eq.1&select=mode,auto_send,daily_send_cap`,
      { headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}` } });
    if (!r.ok) return { allowed: false, reason: 'settings unreadable - refusing' };
    const s = (await r.json())[0];
    if (!s) return { allowed: false, reason: 'no settings row - refusing' };
    if (!s.auto_send) return { allowed: false, reason: `auto_send off (mode=${s.mode})` };
    if (!(s.daily_send_cap > 0)) return { allowed: false, reason: 'daily_send_cap is 0' };
    return { allowed: true, reason: `mode=${s.mode} cap=${s.daily_send_cap}` };
  } catch (e) {
    // Unreachable settings must never mean "send freely".
    return { allowed: false, reason: `settings check failed: ${e.message}` };
  }
}

export { CORS as OPS_CORS };
