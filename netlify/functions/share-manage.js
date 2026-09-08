// ─────────────────────────────────────────────────────────────
// netlify/functions/share-manage.js
// The ATHLETE side of recruiting shares: issue, list, revoke.
//
// WHY THIS EXISTS
//   The Recruiting Profile tab delivers a PDF or a mailto: body - a snapshot
//   pushed out. Once sent there is no expiry, no revocation, no update when
//   the athlete improves, and no way to know if anyone opened it. A grant is
//   the same information as a link the athlete still controls.
//
// EVERY ACTION IS PINNED TO caller.id
//   athlete_id is never taken from the request body. An athlete can only ever
//   issue, list or revoke their OWN grants. share_grants has RLS on with zero
//   policies, so this function (service role) is the only way in - a
//   client-readable share_grants would hand out every live share token in the
//   system.
//
// THE TOKEN IS A SECRET
//   32 bytes from crypto.getRandomValues, base64url. It is returned to the
//   athlete ONCE per creation so they can send the link, and it is never
//   included in `list` - a listing is for managing grants, not for recovering
//   a URL. Lost link = revoke and re-issue, which is the safe default.
// ─────────────────────────────────────────────────────────────

import { CORS, json, env, verifyCaller } from './_coach-auth.js';

const DEFAULT_DAYS = 90;      // one recruiting cycle; decided 2026-09-08
const MAX_DAYS     = 365;
const MAX_ACTIVE   = 50;      // a ceiling, not a quota - stops runaway issuance
const EMAIL_RE     = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

function makeToken(bytes = 32) {
  const b = new Uint8Array(bytes);
  crypto.getRandomValues(b);
  return btoa(String.fromCharCode(...b))
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export default async (req) => {
  if (req.method === 'OPTIONS') return new Response('', { status: 200, headers: CORS });
  if (req.method !== 'POST')    return json({ error: 'Method Not Allowed' }, 405);

  const { supabaseUrl, serviceKey } = env();
  if (!supabaseUrl || !serviceKey) return json({ error: 'Server not configured' }, 500);

  const caller = await verifyCaller(req, supabaseUrl, serviceKey);
  if (!caller) return json({ error: 'Unauthorized' }, 401);

  let body = {};
  try { body = await req.json(); } catch { return json({ error: 'Invalid JSON' }, 400); }

  const H    = { apikey: serviceKey, Authorization: `Bearer ${serviceKey}` };
  const REST = `${supabaseUrl}/rest/v1`;
  const JH   = { ...H, 'Content-Type': 'application/json' };
  const action = String(body.action || '').toLowerCase();

  try {
    // ── CREATE ───────────────────────────────────────────────
    if (action === 'create') {
      const email = String(body.recipient_email || '').trim().toLowerCase();
      if (!EMAIL_RE.test(email)) return json({ error: 'Enter a valid coach or scout email' }, 400);
      const label = body.recipient_label ? String(body.recipient_label).trim().slice(0, 120) : null;

      const days = Math.min(Math.max(parseInt(body.expires_days, 10) || DEFAULT_DAYS, 1), MAX_DAYS);

      // Ceiling on live grants. Cheap guard against an account issuing links
      // forever; revoking frees the slot.
      const liveRes = await fetch(
        `${REST}/share_grants?athlete_id=eq.${caller.id}&revoked_at=is.null`
        + `&expires_at=gt.${new Date().toISOString()}&select=id`, { headers: H });
      const live = liveRes.ok ? await liveRes.json() : [];
      if (live.length >= MAX_ACTIVE) {
        return json({ error: `You have ${live.length} active shares. Revoke one first.` }, 400);
      }

      const token = makeToken();
      const expires_at = new Date(Date.now() + days * 86400000).toISOString();

      const insRes = await fetch(`${REST}/share_grants`, {
        method: 'POST',
        headers: { ...JH, Prefer: 'return=representation' },
        body: JSON.stringify({
          athlete_id: caller.id,          // never from the body
          recipient_email: email, recipient_label: label,
          token, expires_at,
        }),
      });
      if (!insRes.ok) {
        return json({ error: 'Could not create share', detail: (await insRes.text()).slice(0, 200) }, 500);
      }
      const row = (await insRes.json())[0];
      return json({
        id: row.id,
        recipient_email: email,
        recipient_label: label,
        expires_at,
        // Returned ONCE. Not retrievable from `list`.
        token,
      });
    }

    // ── LIST ─────────────────────────────────────────────────
    //   Deliberately omits `token`. A listing is for managing grants; handing
    //   the secret back on every load widens where it can leak for no gain.
    if (action === 'list') {
      const r = await fetch(
        `${REST}/share_grants?athlete_id=eq.${caller.id}`
        + `&select=id,recipient_email,recipient_label,created_at,expires_at,revoked_at,view_count,last_viewed_at`
        + `&order=created_at.desc&limit=100`, { headers: H });
      if (!r.ok) return json({ error: 'Could not read shares' }, 500);
      const rows = await r.json();
      const now = Date.now();
      return json({
        shares: rows.map(s => ({
          ...s,
          status: s.revoked_at ? 'revoked'
                : new Date(s.expires_at).getTime() < now ? 'expired'
                : 'active',
        })),
      });
    }

    // ── REVOKE ───────────────────────────────────────────────
    //   Sets revoked_at rather than deleting, so the athlete keeps a record
    //   that the share existed and how often it was opened. Same reasoning as
    //   the team_members soft-delete.
    if (action === 'revoke') {
      const id = String(body.id || '');
      if (!id) return json({ error: 'id required' }, 400);
      // athlete_id in the filter IS the authorisation.
      const r = await fetch(
        `${REST}/share_grants?id=eq.${id}&athlete_id=eq.${caller.id}&revoked_at=is.null`, {
        method: 'PATCH', headers: JH,
        body: JSON.stringify({ revoked_at: new Date().toISOString() }),
      });
      if (!r.ok) return json({ error: 'Could not revoke share' }, 500);
      // Kill any live viewer sessions immediately - revoking has to mean the
      // coach loses access now, not when their 24-hour session lapses.
      await fetch(`${REST}/share_sessions?grant_id=eq.${id}`, { method: 'DELETE', headers: H })
        .catch(() => {});
      return json({ ok: true });
    }

    return json({ error: `Unknown action "${action}"` }, 400);
  } catch (err) {
    console.error('share-manage error:', err.message);
    return json({ error: `Server error: ${err.message}` }, 500);
  }
};
