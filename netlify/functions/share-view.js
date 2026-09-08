// ─────────────────────────────────────────────────────────────
// netlify/functions/share-view.js
// The RECRUITER side of a share. PUBLIC - no Elite Athlete account required,
// because college coaches will not create one to look at a single athlete.
//
// THE GATE (decided 2026-09-08)
//   1. request_code { token, email }  - if the email matches the grant, mail a
//      6-digit code. A forwarded link alone is worthless.
//   2. verify_code  { token, code }   - exchange for a 24-hour viewer session.
//   3. view         { token, session }- the payload.
//
// WHAT IT DELIBERATELY DOES NOT LEAK
//   request_code and verify_code return the SAME generic response whether the
//   token is unknown, expired, revoked, or the email simply does not match.
//   Otherwise this endpoint becomes an oracle: feed it addresses until one
//   behaves differently and you have learned who an athlete is talking to.
//   Real failures are logged server-side, never returned.
//
// BRUTE FORCE
//   A 6-digit code is 10^6. Codes live 10 minutes and each carries an attempt
//   counter capped at MAX_ATTEMPTS; past that the code is dead and a new one
//   must be requested. Codes are stored as sha-256, so a database read cannot
//   be replayed into access.
//
// WHAT THE VIEWER SEES
//   The recruiting card the athlete already builds, plus the monthly record -
//   readiness, training volume, benchmark progression. That is the point: a
//   coach can see development rather than self-reported PRs. Raw daily rows,
//   journals, progress notes, nutrition detail and coach notes are NOT
//   included at any point. Widening this payload is a privacy decision, not a
//   feature tweak.
//
// THIS IS TRANSACTIONAL MAIL, NOT OUTREACH
//   It sends only in direct response to someone opening an athlete's own link,
//   to an address that athlete typed. It has no schedule, no list, and no
//   connection to the paused coach-outreach functions (marketing-blast,
//   coach-followup, coach-ops-*). Do not wire it to any of them.
// ─────────────────────────────────────────────────────────────

import { CORS, json, env } from './_coach-auth.js';

const FROM         = 'Elite Athlete <support@elite-athlete.app>';
const CODE_TTL_MS  = 10 * 60 * 1000;       // 10 minutes
const SESSION_TTL  = 24 * 60 * 60 * 1000;  // 24 hours
const MAX_ATTEMPTS = 5;
const APP_URL      = 'https://elite-athlete.app';

// One generic answer for every failure mode on the gated actions.
const GENERIC = { ok: true, sent: true };

async function sha256(s) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
  return [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('');
}

function sixDigits() {
  const b = new Uint32Array(1);
  crypto.getRandomValues(b);
  return String(b[0] % 1000000).padStart(6, '0');
}

function makeToken(bytes = 32) {
  const b = new Uint8Array(bytes);
  crypto.getRandomValues(b);
  return btoa(String.fromCharCode(...b))
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

// A grant that is live right now: exists, not revoked, not expired.
async function liveGrant(REST, H, token) {
  if (!token || token.length < 20) return null;
  const r = await fetch(
    `${REST}/share_grants?token=eq.${encodeURIComponent(token)}&revoked_at=is.null`
    + `&expires_at=gt.${new Date().toISOString()}`
    + `&select=id,athlete_id,recipient_email,recipient_label,expires_at&limit=1`,
    { headers: H });
  if (!r.ok) return null;
  return (await r.json())[0] || null;
}

export default async (req) => {
  if (req.method === 'OPTIONS') return new Response('', { status: 200, headers: CORS });
  if (req.method !== 'POST')    return json({ error: 'Method Not Allowed' }, 405);

  const { supabaseUrl, serviceKey } = env();
  if (!supabaseUrl || !serviceKey) return json({ error: 'Server not configured' }, 500);

  let body = {};
  try { body = await req.json(); } catch { return json({ error: 'Invalid JSON' }, 400); }

  const H    = { apikey: serviceKey, Authorization: `Bearer ${serviceKey}` };
  const JH   = { ...H, 'Content-Type': 'application/json' };
  const REST = `${supabaseUrl}/rest/v1`;
  const action = String(body.action || '').toLowerCase();
  const token  = String(body.token || '');

  try {
    // ── 1. REQUEST CODE ──────────────────────────────────────
    if (action === 'request_code') {
      const email = String(body.email || '').trim().toLowerCase();
      const grant = await liveGrant(REST, H, token);

      // Every failure path returns GENERIC. Never reveal which one happened.
      if (!grant || grant.recipient_email !== email) {
        console.warn('share-view request_code miss', { hasGrant: !!grant });
        return json(GENERIC);
      }

      const code = sixDigits();
      await fetch(`${REST}/share_codes`, {
        method: 'POST', headers: JH,
        body: JSON.stringify({
          grant_id: grant.id,
          code_hash: await sha256(code),
          expires_at: new Date(Date.now() + CODE_TTL_MS).toISOString(),
        }),
      });

      const resendKey = process.env.RESEND_API_KEY;
      if (resendKey) {
        const html = `
          <div style="font-family:-apple-system,Segoe UI,sans-serif;max-width:480px;margin:0 auto;padding:24px">
            <p style="font-size:12px;letter-spacing:2px;text-transform:uppercase;color:#8B6520;margin:0 0 16px">Elite Athlete</p>
            <p style="font-size:15px;color:#222;line-height:1.6;margin:0 0 20px">
              Someone requested access to an athlete profile shared with this address. Enter this code to view it:
            </p>
            <p style="font-size:32px;font-weight:700;letter-spacing:8px;color:#111;margin:0 0 20px">${code}</p>
            <p style="font-size:13px;color:#666;line-height:1.6;margin:0">
              The code expires in 10 minutes. If you were not expecting this, ignore this email - no access is granted without the code.
            </p>
          </div>`;
        await fetch('https://api.resend.com/emails', {
          method: 'POST',
          headers: { Authorization: `Bearer ${resendKey}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            from: FROM, to: email,
            subject: 'Your Elite Athlete access code',
            html,
          }),
        }).catch(e => console.error('share code send failed:', e.message));
      } else {
        console.error('RESEND_API_KEY not configured - share code not sent');
      }

      return json(GENERIC);
    }

    // ── 2. VERIFY CODE ───────────────────────────────────────
    if (action === 'verify_code') {
      const code  = String(body.code || '').trim();
      const grant = await liveGrant(REST, H, token);
      if (!grant || !/^\d{6}$/.test(code)) return json({ error: 'Invalid or expired code' }, 400);

      const cRes = await fetch(
        `${REST}/share_codes?grant_id=eq.${grant.id}&used_at=is.null`
        + `&expires_at=gt.${new Date().toISOString()}`
        + `&select=id,code_hash,attempts&order=created_at.desc&limit=1`, { headers: H });
      const rec = (cRes.ok ? await cRes.json() : [])[0];
      if (!rec || rec.attempts >= MAX_ATTEMPTS) return json({ error: 'Invalid or expired code' }, 400);

      // Count the attempt BEFORE comparing, so a crash mid-check cannot be
      // used to get free guesses.
      await fetch(`${REST}/share_codes?id=eq.${rec.id}`, {
        method: 'PATCH', headers: JH,
        body: JSON.stringify({ attempts: rec.attempts + 1 }),
      });

      if (rec.code_hash !== await sha256(code)) return json({ error: 'Invalid or expired code' }, 400);

      await fetch(`${REST}/share_codes?id=eq.${rec.id}`, {
        method: 'PATCH', headers: JH,
        body: JSON.stringify({ used_at: new Date().toISOString() }),
      });

      const session = makeToken();
      await fetch(`${REST}/share_sessions`, {
        method: 'POST', headers: JH,
        body: JSON.stringify({
          grant_id: grant.id, token: session,
          expires_at: new Date(Date.now() + SESSION_TTL).toISOString(),
        }),
      });
      return json({ session, expires_in: SESSION_TTL / 1000 });
    }

    // ── 3. VIEW ──────────────────────────────────────────────
    if (action === 'view') {
      const session = String(body.session || '');
      const grant   = await liveGrant(REST, H, token);
      if (!grant || !session) return json({ error: 'Not authorised' }, 401);

      const sRes = await fetch(
        `${REST}/share_sessions?token=eq.${encodeURIComponent(session)}&grant_id=eq.${grant.id}`
        + `&expires_at=gt.${new Date().toISOString()}&select=id&limit=1`, { headers: H });
      if (!(sRes.ok && (await sRes.json()).length)) return json({ error: 'Not authorised' }, 401);

      const athlete = grant.athlete_id;

      // The card the athlete already maintains, plus the monthly record.
      // athlete_history_summary is the SAME rollup the athlete's own My Record
      // uses - one row per month, so a four-year career is 48 rows.
      const from = new Date(Date.now() - 5 * 365 * 86400000).toISOString();
      const to   = new Date().toISOString();

      const [pRes, bRes, mRes] = await Promise.all([
        // Only real columns. `location` is referenced by the recruiting UI but
        // has never had a column - see 20260908_profile_recruiting_fields,
        // which persisted the other five. Deliberately not invented here.
        fetch(`${REST}/profiles?user_id=eq.${athlete}`
          + `&select=name,sport,position,height,weight,age,gpa,gpa_scale,graduation_year,high_school,hudl_link`,
          { headers: H }),
        fetch(`${REST}/benchmarks?user_id=eq.${athlete}`
          + `&select=test,value,unit,date&order=date.desc&limit=60`, { headers: H }),
        fetch(`${REST}/rpc/athlete_history_summary`, {
          method: 'POST', headers: JH,
          body: JSON.stringify({ p_user_id: athlete, p_from: from, p_to: to }),
        }),
      ]);

      const profile = (pRes.ok ? await pRes.json() : [])[0] || {};
      const benchmarks = bRes.ok ? await bRes.json() : [];
      const allMonths = mRes.ok ? await mRes.json() : [];

      // Record the view. Best-effort and awaited-free - a counter must never
      // block or fail the page. Read-then-write can undercount if the same
      // grant is opened twice in the same instant; that is acceptable for a
      // "has anyone looked at this" signal and not worth a lock.
      fetch(`${REST}/share_grants?id=eq.${grant.id}&select=view_count`, { headers: H })
        .then(r => (r.ok ? r.json() : null))
        .then(rows => fetch(`${REST}/share_grants?id=eq.${grant.id}`, {
          method: 'PATCH', headers: JH,
          body: JSON.stringify({
            view_count: (rows?.[0]?.view_count ?? 0) + 1,
            last_viewed_at: new Date().toISOString(),
          }),
        }))
        .catch(() => {});

      return json({
        athlete: {
          name: profile.name || 'Athlete',
          sport: profile.sport || null,
          position: profile.position || null,
          height: profile.height ?? null,
          weight: profile.weight ?? null,
          age: profile.age ?? null,
          gpa: profile.gpa ?? null,
          gpa_scale: profile.gpa_scale ?? null,
          graduation_year: profile.graduation_year ?? null,
          high_school: profile.high_school ?? null,
          location: profile.location ?? null,
          film: profile.hudl_link || null,
        },
        benchmarks,
        // Months with something in them, newest first.
        months: allMonths.filter(m =>
          (m.check_ins + m.sessions + m.benchmarks) > 0 || Number(m.total_volume) > 0),
        shared_with: grant.recipient_label || grant.recipient_email,
        expires_at: grant.expires_at,
      });
    }

    return json({ error: `Unknown action "${action}"` }, 400);
  } catch (err) {
    console.error('share-view error:', err.message);
    return json({ error: 'Server error' }, 500);
  }
};
