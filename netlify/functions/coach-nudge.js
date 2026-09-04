// netlify/functions/coach-nudge.js
// Email nudges from a coach to athletes who have gone quiet.
//
// The Phase 0 nudge opened the native share sheet — fine for one athlete, useless
// for a coach chasing twelve. This delivers by email through the existing Resend
// integration.
//
// POST { action: 'send',       athlete_ids: [uuid, ...], message? }
// POST { action: 'send_stale', team_id?, days?, message? }   → everyone overdue
// POST { action: 'preview',    team_id?, days? }             → who WOULD be nudged
//
// Guards, in order:
//   • caller must own each athlete (team_members join, server-side)
//   • one nudge per athlete per calendar day, enforced by the unique constraint
//     on email_blasts(blast_id, email) — not by a check we could race
//   • unsubscribed athletes are skipped
//   • hard cap per request and per coach per day
//
// Netlify Functions v2. Env: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, RESEND_API_KEY
import { CORS, json, env, svc, verifyCaller, rpc } from './_coach-auth.js';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const FROM = 'Elite Athlete <support@elite-athlete.app>';
const WEB  = 'https://elite-athlete.app';
const MAX_PER_REQUEST = 50;
const MAX_PER_DAY     = 200;

const esc = s => String(s || '').replace(/[<>&"]/g, c =>
  ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' }[c]));

function nudgeHtml({ first, coachName, teamName, reason, message, email }) {
  const hi = first ? `${esc(first)},` : 'Hey,';
  const custom = message
    ? `<p style="margin:0 0 16px;font-style:italic;color:#DDD;">"${esc(message)}"</p>` : '';
  return `<!DOCTYPE html><html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>`
   + `<body style="margin:0;padding:0;background:#0D0D0D;font-family:Arial,sans-serif;">`
   + `<table width="100%" cellpadding="0" cellspacing="0" style="background:#0D0D0D;padding:40px 16px;"><tr><td align="center">`
   + `<table width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;">`
   + `<tr><td style="background:#B8962E;height:4px;border-radius:4px 4px 0 0;"></td></tr>`
   + `<tr><td style="background:#111;padding:28px 40px;border-left:1px solid #B8962E22;border-right:1px solid #B8962E22;">`
   + `<p style="margin:0 0 2px;font-size:10px;letter-spacing:4px;color:#B8962E;">ELITE ATHLETE</p>`
   + `<p style="margin:0;font-size:11px;color:#444;">${esc(teamName || 'YOUR TEAM')}</p></td></tr>`
   + `<tr><td style="background:#B8962E;height:1px;"></td></tr>`
   + `<tr><td style="background:#111;padding:40px;border-left:1px solid #B8962E22;border-right:1px solid #B8962E22;">`
   + `<h1 style="margin:0 0 8px;font-size:28px;font-weight:900;color:#fff;">${hi}</h1>`
   + `<p style="margin:0 0 22px;font-size:16px;color:#B8962E;font-weight:600;">${esc(reason)}</p>`
   + custom
   + `<p style="margin:0 0 26px;font-size:15px;color:#CCC;line-height:1.7;">Two minutes on your check-in and ${esc(coachName || 'your coach')} can see where you're at before the next session. Recovery, sleep, energy, soreness, mood — that's it.</p>`
   + `<p style="margin:0 0 30px;text-align:center;"><a href="${WEB}" style="display:inline-block;background:#B8962E;color:#0D0D0D;text-decoration:none;font-size:15px;font-weight:700;letter-spacing:2px;text-transform:uppercase;padding:16px 48px;border-radius:6px;">Log Check-In</a></p>`
   + `<p style="margin:0;font-size:13px;color:#555;border-top:1px solid #ffffff08;padding-top:20px;">Sent by your coach through Elite Athlete.</p>`
   + `</td></tr>`
   + `<tr><td style="background:#0D0D0D;padding:20px 40px;border:1px solid #ffffff08;border-top:none;">`
   + `<p style="margin:0;font-size:11px;color:#333;">ELITE ATHLETE &middot; support@elite-athlete.app</p>`
   + `<p style="margin:4px 0 0;font-size:11px;"><a href="${WEB}/.netlify/functions/unsubscribe?email=${encodeURIComponent(email)}" style="color:#555;">Unsubscribe</a></p>`
   + `</td></tr><tr><td style="background:#B8962E;height:3px;border-radius:0 0 4px 4px;"></td></tr>`
   + `</table></td></tr></table></body></html>`;
}

export default async (req) => {
  if (req.method === 'OPTIONS') return new Response('', { status: 200, headers: CORS });
  if (req.method !== 'POST') return json({ error: 'Method Not Allowed' }, 405);

  const { supabaseUrl, serviceKey } = env();
  if (!supabaseUrl || !serviceKey) return json({ error: 'Server not configured' }, 500);

  const caller = await verifyCaller(req, supabaseUrl, serviceKey);
  if (!caller) return json({ error: 'Unauthorized' }, 401);

  let b = {};
  try { b = await req.json(); } catch { return json({ error: 'Invalid JSON' }, 400); }
  const action  = String(b.action || '').toLowerCase();
  const teamId  = b.team_id || null;
  const message = String(b.message || '').trim().slice(0, 500);
  const staleDays = Math.min(30, Math.max(1, parseInt(b.days, 10) || 3));

  const H = svc(serviceKey);
  const REST = `${supabaseUrl}/rest/v1`;
  const today = new Date().toISOString().slice(0, 10);
  const blastId = `coach_nudge_${today}`;

  try {
    // ── Resolve the target list, always via the coach's own roster ──
    let targets = [];
    if (action === 'send') {
      const ids = (Array.isArray(b.athlete_ids) ? b.athlete_ids : [])
        .map(String).filter(s => UUID_RE.test(s)).slice(0, MAX_PER_REQUEST);
      if (!ids.length) return json({ error: 'No valid athlete_ids' }, 400);
      const rows = await rpc(supabaseUrl, serviceKey, 'coach_roster_page', {
        p_coach: caller.id, p_team: teamId, p_limit: 200, p_offset: 0, p_search: null,
      });
      const allowed = new Set(ids);
      targets = rows.filter(r => allowed.has(r.athlete_id));
      if (!targets.length) return json({ error: 'None of those athletes are on your roster' }, 403);
    } else if (action === 'send_stale' || action === 'preview') {
      const rows = await rpc(supabaseUrl, serviceKey, 'coach_roster_page', {
        p_coach: caller.id, p_team: teamId, p_limit: 200, p_offset: 0, p_search: null,
      });
      targets = rows.filter(r => r.days_since === null || r.days_since >= staleDays);
    } else {
      return json({ error: `Unknown action "${action}"` }, 400);
    }

    // ── Coach's own name + team, for the email ──
    const [profRes, teamRes] = await Promise.all([
      fetch(`${REST}/profiles?user_id=eq.${caller.id}&select=name`, { headers: H }),
      fetch(`${REST}/teams?coach_id=eq.${caller.id}${teamId ? `&id=eq.${teamId}` : ''}&select=name&limit=1`, { headers: H }),
    ]);
    const coachName = (profRes.ok ? (await profRes.json())[0]?.name : null) || 'your coach';
    const teamName  = (teamRes.ok ? (await teamRes.json())[0]?.name : null) || '';

    // ── Look up emails (bounded — never the full user list) ──
    const withEmail = [];
    for (const t of targets.slice(0, MAX_PER_REQUEST)) {
      const r = await fetch(`${supabaseUrl}/auth/v1/admin/users/${t.athlete_id}`, { headers: H });
      if (!r.ok) continue;
      const u = await r.json();
      if (u?.email) withEmail.push({ ...t, email: u.email });
    }

    // ── Skip unsubscribed ──
    const unsubRes = await fetch(`${REST}/email_blasts?blast_id=eq.unsubscribed&select=email`, { headers: H });
    const unsub = new Set((unsubRes.ok ? await unsubRes.json() : []).map(r => String(r.email).toLowerCase()));
    const sendable = withEmail.filter(a => !unsub.has(a.email.toLowerCase()));

    if (action === 'preview') {
      return json({
        wouldNudge: sendable.map(a => ({
          athlete_id: a.athlete_id, name: a.name,
          daysSinceCheckIn: a.days_since, readiness: a.readiness,
        })),
        skippedUnsubscribed: withEmail.length - sendable.length,
        staleDays,
      });
    }

    // ── Daily cap for this coach ──
    const sentTodayRes = await fetch(
      `${REST}/email_blasts?blast_id=eq.${blastId}&select=email`, { headers: H });
    const sentToday = sentTodayRes.ok ? (await sentTodayRes.json()).length : 0;
    if (sentToday >= MAX_PER_DAY) return json({ error: 'Daily nudge limit reached' }, 429);

    const resendKey = process.env.RESEND_API_KEY;
    if (!resendKey) return json({ error: 'RESEND_API_KEY not configured' }, 500);

    const sent = [], skipped = [];
    for (const a of sendable) {
      // Claim the slot FIRST. The unique constraint on (blast_id, email) is what
      // enforces one-per-day — a check-then-send would race with itself.
      const claim = await fetch(`${REST}/email_blasts`, {
        method: 'POST',
        headers: { ...H, 'Content-Type': 'application/json', Prefer: 'return=minimal' },
        body: JSON.stringify({ blast_id: blastId, email: a.email, subject: 'Coach nudge' }),
      });
      if (!claim.ok) { skipped.push({ name: a.name, reason: 'already nudged today' }); continue; }

      const reason = a.days_since === null
        ? "You haven't logged your first check-in yet."
        : `It's been ${a.days_since} days since your last check-in.`;

      const send = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: { Authorization: `Bearer ${resendKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          from: FROM, to: a.email, reply_to: caller.email,
          subject: `${coachName} is checking in on you`,
          html: nudgeHtml({ first: String(a.name || '').split(' ')[0], coachName, teamName, reason, message, email: a.email }),
        }),
      });
      if (send.ok) sent.push({ athlete_id: a.athlete_id, name: a.name });
      else {
        const t = await send.text();
        console.error('nudge send failed:', a.email, t.slice(0, 200));
        skipped.push({ name: a.name, reason: 'send failed' });
      }
    }

    return json({ sent, skipped, sentCount: sent.length, skippedCount: skipped.length });
  } catch (err) {
    console.error('coach-nudge error:', err.message);
    return json({ error: `Server error: ${err.message}` }, 500);
  }
};
