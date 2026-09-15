// netlify/functions/_lead.js
// One writer for the capture ledger (public.lead_events). Every function that
// sees a raised hand calls logLead(); nothing else writes that table.
//
// Design: never throw into the caller. A failed ledger write must not break a
// checkout, a share-link open or a waitlist submit - but it must be LOUD in the
// logs and it must return false so callers that care (lead-capture, the canary)
// can refuse to report success.

export const LEAD_INTENTS = new Set([
  'raised_hand','reply','reply_yes','reply_not_now','reply_stop',
  'call','demo','checkout_started','paid','objection',
  'coach_opened_share','share_created','invite_redeemed',
  'spring','club','canary','note',
]);

export function normEmail(e) {
  const s = String(e || '').trim().toLowerCase();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s) ? s.slice(0, 254) : null;
}

/**
 * @param {string} supabaseUrl
 * @param {string} serviceKey
 * @param {object} row  { email?, contact_id?, user_id?, source, channel?, intent,
 *                        message_id?, verbatim?, meta?, next_action?, next_action_at? }
 * @returns {Promise<{ok:boolean, id?:string, error?:string}>}
 */
export async function logLead(supabaseUrl, serviceKey, row) {
  try {
    if (!supabaseUrl || !serviceKey) return { ok: false, error: 'ledger not configured' };
    if (!row || !row.source || !LEAD_INTENTS.has(row.intent))
      return { ok: false, error: `bad lead row: ${JSON.stringify({ source: row?.source, intent: row?.intent })}` };

    const body = {
      email:          row.email ? normEmail(row.email) : null,
      contact_id:     row.contact_id || null,
      user_id:        row.user_id || null,
      source:         String(row.source).slice(0, 64),
      channel:        row.channel ? String(row.channel).slice(0, 32) : null,
      intent:         row.intent,
      message_id:     row.message_id ? String(row.message_id).slice(0, 998) : null,
      verbatim:       row.verbatim ? String(row.verbatim).slice(0, 5000) : null,
      meta:           row.meta && typeof row.meta === 'object' ? row.meta : {},
      next_action:    row.next_action || null,
      next_action_at: row.next_action_at || null,
    };

    const r = await fetch(`${supabaseUrl}/rest/v1/lead_events`, {
      method: 'POST',
      headers: {
        apikey: serviceKey, Authorization: `Bearer ${serviceKey}`,
        'Content-Type': 'application/json', Prefer: 'return=representation',
      },
      body: JSON.stringify(body),
    });
    if (!r.ok) {
      const t = await r.text();
      console.error('[lead_events] insert failed', r.status, t);
      return { ok: false, error: `${r.status} ${t.slice(0, 300)}` };
    }
    const rows = await r.json();
    return { ok: true, id: rows?.[0]?.id };
  } catch (e) {
    console.error('[lead_events] insert threw', e);
    return { ok: false, error: String(e?.message || e) };
  }
}

/** Resolve a coach_contacts.id for an email (lowercase match). Never throws. */
export async function contactIdFor(supabaseUrl, serviceKey, email) {
  try {
    const em = normEmail(email);
    if (!em) return null;
    const r = await fetch(`${supabaseUrl}/rest/v1/coach_contacts?select=id&email=ilike.${encodeURIComponent(em)}&limit=1`,
      { headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}` } });
    if (!r.ok) return null;
    const rows = await r.json();
    return rows?.[0]?.id || null;
  } catch { return null; }
}
