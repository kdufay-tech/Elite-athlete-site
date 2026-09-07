// netlify/functions/coach-team.js
// Team lifecycle: create (coach), join (athlete), list (coach), mine (athlete),
// leave (athlete), remove (coach).
// Netlify Functions v2 — requires "type":"module" in package.json.
// Env: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
import { CORS, json, env, svc, verifyCaller, makeJoinCode } from './_coach-auth.js';
import { syncCoachSeats } from './_seat-sync.js';

// Roster caps by team level. A cap is also a monthly spend ceiling: every
// active athlete costs $4.99/month on top of the $899/year subscription.
//   hs 55 x $4.99 = $274/mo   college 150 = $748/mo
//   pro 250       = $1,247/mo youth   500 = $2,495/mo
// An unset level gets the most conservative cap rather than no cap.
const ROSTER_CAPS = { hs: 55, college: 150, pro: 250, youth: 500 };
const DEFAULT_CAP = 55;
const capFor = level => ROSTER_CAPS[String(level || '').toLowerCase()] ?? DEFAULT_CAP;

const INVITE_TTL_DAYS = 14;
const MAX_BULK_INVITES = 25;

// Mirrors stripe-checkout.js: test key in beta mode, live key otherwise.
function stripeKey() {
  const isBeta = process.env.VITE_BETA_MODE === 'true';
  return isBeta
    ? (process.env.STRIPE_TEST_SECRET_KEY || process.env.STRIPE_SECRET_KEY)
    : process.env.STRIPE_SECRET_KEY;
}

export default async (req) => {
  if (req.method === 'OPTIONS') return new Response('', { status: 200, headers: CORS });
  if (req.method !== 'POST') return json({ error: 'Method Not Allowed' }, 405);

  const { supabaseUrl, serviceKey } = env();
  if (!supabaseUrl || !serviceKey) return json({ error: 'Server not configured' }, 500);

  const caller = await verifyCaller(req, supabaseUrl, serviceKey);
  if (!caller) return json({ error: 'Unauthorized' }, 401);

  let body = {};
  try { body = await req.json(); } catch { return json({ error: 'Invalid JSON' }, 400); }
  const action = String(body.action || '').toLowerCase();
  const H = svc(serviceKey);
  const REST = `${supabaseUrl}/rest/v1`;

  try {
    // ── CREATE (coach) ───────────────────────────────────────────
    if (action === 'create') {
      const name = String(body.name || '').trim().slice(0, 80);
      if (!name) return json({ error: 'Team name required' }, 400);
      const sport = body.sport ? String(body.sport).trim().slice(0, 40) : null;
      // Level drives the roster cap, which is also the coach's spend ceiling.
      // Unrecognised or absent -> null, which capFor() treats as the smallest cap.
      const lv = String(body.level || '').toLowerCase();
      const level = ROSTER_CAPS[lv] ? lv : null;

      // Cap teams per coach — prevents runaway creation.
      const existingRes = await fetch(
        `${REST}/teams?coach_id=eq.${caller.id}&select=id`, { headers: H });
      const existing = existingRes.ok ? await existingRes.json() : [];
      if (existing.length >= 10) return json({ error: 'Team limit reached (10)' }, 400);

      // Retry on join_code collision.
      let team = null, lastErr = '';
      for (let i = 0; i < 6 && !team; i++) {
        const join_code = makeJoinCode(6);
        const res = await fetch(`${REST}/teams`, {
          method: 'POST',
          headers: { ...H, 'Content-Type': 'application/json', Prefer: 'return=representation' },
          body: JSON.stringify({ coach_id: caller.id, name, sport, join_code, level,
                                 join_code_enabled: false }),
        });
        if (res.ok) { team = (await res.json())[0]; break; }
        lastErr = await res.text();
        if (!/duplicate key|23505/i.test(lastErr)) break;
      }
      if (!team) return json({ error: 'Could not create team', detail: lastErr.slice(0, 200) }, 500);

      // Mark the caller as a coach account (column already exists, previously unused).
      await fetch(`${REST}/profiles?user_id=eq.${caller.id}`, {
        method: 'PATCH',
        headers: { ...H, 'Content-Type': 'application/json' },
        body: JSON.stringify({ account_type: 'coach' }),
      }).catch(() => {});

      return json({ team });
    }

    // ── JOIN (athlete) ───────────────────────────────────────────
    if (action === 'join') {
      const code = String(body.code || '').trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
      if (code.length < 4) return json({ error: 'Enter a valid team code' }, 400);

      // Two ways in, tried in this order:
      //   1. a single-use per-athlete invite from team_invites
      //   2. the team's shared open code, ONLY if join_code_enabled
      // The open code defaults off, because every athlete costs $4.99/month.
      let team = null, invite = null;

      const invRes = await fetch(
        `${REST}/team_invites?code=eq.${code}&status=eq.pending&select=id,team_id,coach_id,expires_at`,
        { headers: H });
      invite = (invRes.ok ? await invRes.json() : [])[0] || null;
      if (invite && invite.expires_at && new Date(invite.expires_at) < new Date()) {
        return json({ error: 'That invite code has expired. Ask your coach for a new one.' }, 400);
      }

      if (invite) {
        const itRes = await fetch(
          `${REST}/teams?id=eq.${invite.team_id}&active=is.true&select=id,name,sport,coach_id,level`,
          { headers: H });
        team = (itRes.ok ? await itRes.json() : [])[0] || null;
      } else {
        const tRes = await fetch(
          `${REST}/teams?join_code=eq.${code}&active=is.true&join_code_enabled=is.true&select=id,name,sport,coach_id,level`,
          { headers: H });
        team = (tRes.ok ? await tRes.json() : [])[0] || null;
      }
      if (!team) return json({ error: 'No team found with that code' }, 404);

      // Roster cap - also the coach's spend ceiling.
      const capRes = await fetch(
        `${REST}/team_members?team_id=eq.${team.id}&status=eq.active&select=athlete_id`,
        { headers: H });
      const capRows = capRes.ok ? await capRes.json() : [];
      const cap = capFor(team.level);
      if (new Set(capRows.map(r => r.athlete_id)).size >= cap) {
        return json({ error: `This team is full (${cap} athletes). Ask your coach.` }, 400);
      }
      if (team.coach_id === caller.id) return json({ error: "That's your own team" }, 400);

      const pRes = await fetch(
        `${REST}/profiles?user_id=eq.${caller.id}&select=sport,position`, { headers: H });
      const prof = (pRes.ok ? await pRes.json() : [])[0] || {};

      const insRes = await fetch(`${REST}/team_members`, {
        method: 'POST',
        headers: {
          ...H, 'Content-Type': 'application/json',
          Prefer: 'return=representation,resolution=merge-duplicates',
        },
        body: JSON.stringify({
          team_id: team.id, coach_id: team.coach_id, athlete_id: caller.id,
          sport: prof.sport || team.sport || null, position: prof.position || null,
          status: 'active',
        }),
      });
      if (!insRes.ok) {
        const t = await insRes.text();
        if (/duplicate key|23505/i.test(t))
          return json({ team: { id: team.id, name: team.name }, already: true });
        return json({ error: 'Could not join team', detail: t.slice(0, 200) }, 500);
      }
      // Burn the invite so it cannot be reused.
      if (invite) {
        await fetch(`${REST}/team_invites?id=eq.${invite.id}`, {
          method: 'PATCH',
          headers: { ...H, 'Content-Type': 'application/json' },
          body: JSON.stringify({ status: 'redeemed', redeemed_at: new Date().toISOString(), redeemed_by: caller.id }),
        }).catch(() => {});
      }
      // Roster grew - bring the coach's seat quantity in line. Never throws,
      // so a billing hiccup cannot block a join.
      await syncCoachSeats(team.coach_id, { supabaseUrl, serviceKey, stripeSecret: stripeKey() });
      return json({ team: { id: team.id, name: team.name }, already: false });
    }

    // ── INVITE_CREATE (coach) ────────────────────────────────────
    // Single-use codes, one per athlete. Preferred over the shared open code,
    // which stays off by default now that each athlete costs $4.99/month.
    if (action === 'invite_create') {
      const teamId = String(body.team_id || '');
      if (!teamId) return json({ error: 'team_id required' }, 400);

      const tRes = await fetch(
        `${REST}/teams?id=eq.${teamId}&coach_id=eq.${caller.id}&select=id,level`, { headers: H });
      const team = (tRes.ok ? await tRes.json() : [])[0];
      if (!team) return json({ error: 'Team not found' }, 404);

      const labels = Array.isArray(body.labels) ? body.labels.slice(0, MAX_BULK_INVITES) : [];
      const count  = Math.min(Math.max(parseInt(body.count, 10) || labels.length || 1, 1), MAX_BULK_INVITES);

      // Do not mint more invites than the remaining roster cap allows -
      // outstanding invites are future seats, and a seat is $4.99/month.
      const mRes = await fetch(
        `${REST}/team_members?team_id=eq.${teamId}&status=eq.active&select=athlete_id`, { headers: H });
      const active = new Set(((mRes.ok ? await mRes.json() : [])).map(r => r.athlete_id)).size;
      const pRes = await fetch(
        `${REST}/team_invites?team_id=eq.${teamId}&status=eq.pending&select=id`, { headers: H });
      const pending = (pRes.ok ? await pRes.json() : []).length;
      const room = capFor(team.level) - active - pending;
      if (room <= 0) return json({ error: `Roster cap reached (${capFor(team.level)}). Revoke an invite or remove an athlete.` }, 400);

      const toMake = Math.min(count, room);
      const expires = new Date(Date.now() + INVITE_TTL_DAYS * 86400000).toISOString();
      const rows = [];
      for (let i = 0; i < toMake; i++) {
        rows.push({
          team_id: teamId, coach_id: caller.id, code: makeJoinCode(6),
          label: (labels[i] || '').toString().trim().slice(0, 60) || null,
          status: 'pending', expires_at: expires,
        });
      }
      const insRes = await fetch(`${REST}/team_invites`, {
        method: 'POST',
        headers: { ...H, 'Content-Type': 'application/json', Prefer: 'return=representation' },
        body: JSON.stringify(rows),
      });
      if (!insRes.ok) return json({ error: 'Could not create invites', detail: (await insRes.text()).slice(0, 200) }, 500);
      return json({ invites: await insRes.json(), expires_at: expires, capped: toMake < count });
    }

    // ── INVITE_LIST (coach) ──────────────────────────────────────
    if (action === 'invite_list') {
      const teamId = String(body.team_id || '');
      const limit  = Math.min(Math.max(parseInt(body.limit, 10) || 50, 1), 200);
      const offset = Math.max(parseInt(body.offset, 10) || 0, 0);
      let url = `${REST}/team_invites?coach_id=eq.${caller.id}`;
      if (teamId) url += `&team_id=eq.${teamId}`;
      if (body.status) url += `&status=eq.${encodeURIComponent(String(body.status))}`;
      url += `&select=id,team_id,code,label,status,expires_at,redeemed_at&order=created_at.desc`
           + `&limit=${limit}&offset=${offset}`;
      const r = await fetch(url, { headers: { ...H, Prefer: 'count=exact' } });
      if (!r.ok) return json({ error: 'Could not list invites' }, 500);
      const total = (r.headers.get('content-range') || '').split('/')[1];
      return json({ invites: await r.json(), total: total ? Number(total) : null, limit, offset });
    }

    // ── INVITE_REVOKE (coach) ────────────────────────────────────
    if (action === 'invite_revoke') {
      const inviteId = String(body.invite_id || '');
      if (!inviteId) return json({ error: 'invite_id required' }, 400);
      const r = await fetch(
        `${REST}/team_invites?id=eq.${inviteId}&coach_id=eq.${caller.id}&status=eq.pending`, {
          method: 'PATCH',
          headers: { ...H, 'Content-Type': 'application/json' },
          body: JSON.stringify({ status: 'revoked' }),
        });
      if (!r.ok) return json({ error: 'Could not revoke invite' }, 500);
      return json({ ok: true });
    }

    // ── ROTATE_CODE (coach) - invalidates the old shared code instantly ──
    if (action === 'rotate_code') {
      const teamId = String(body.team_id || '');
      if (!teamId) return json({ error: 'team_id required' }, 400);
      let updated = null, lastErr = '';
      for (let i = 0; i < 6 && !updated; i++) {
        const r = await fetch(`${REST}/teams?id=eq.${teamId}&coach_id=eq.${caller.id}`, {
          method: 'PATCH',
          headers: { ...H, 'Content-Type': 'application/json', Prefer: 'return=representation' },
          body: JSON.stringify({ join_code: makeJoinCode(6) }),
        });
        if (r.ok) { updated = (await r.json())[0]; break; }
        lastErr = await r.text();
        if (!/duplicate key|23505/i.test(lastErr)) break;
      }
      if (!updated) return json({ error: 'Could not rotate code', detail: lastErr.slice(0, 200) }, 500);
      return json({ join_code: updated.join_code });
    }

    // ── TOGGLE_CODE (coach) - open joining on/off ────────────────
    if (action === 'toggle_code') {
      const teamId = String(body.team_id || '');
      if (!teamId) return json({ error: 'team_id required' }, 400);
      const enabled = body.enabled === true;
      const r = await fetch(`${REST}/teams?id=eq.${teamId}&coach_id=eq.${caller.id}`, {
        method: 'PATCH',
        headers: { ...H, 'Content-Type': 'application/json' },
        body: JSON.stringify({ join_code_enabled: enabled }),
      });
      if (!r.ok) return json({ error: 'Could not update join setting' }, 500);
      return json({ ok: true, join_code_enabled: enabled });
    }

    // ── LIST (coach's own teams, with member counts) ─────────────
    if (action === 'list') {
      const tRes = await fetch(
        `${REST}/teams?coach_id=eq.${caller.id}&order=created_at.asc&select=id,name,sport,join_code,join_code_enabled,level,active,created_at`,
        { headers: H });
      const teams = tRes.ok ? await tRes.json() : [];
      if (teams.length) {
        const mRes = await fetch(
          `${REST}/team_members?coach_id=eq.${caller.id}&status=eq.active&select=team_id`,
          { headers: H });
        const members = mRes.ok ? await mRes.json() : [];
        const counts = members.reduce((a, m) => (a[m.team_id] = (a[m.team_id] || 0) + 1, a), {});
        teams.forEach(t => { t.member_count = counts[t.id] || 0; });
      }
      return json({ teams });
    }

    // ── MINE (athlete's memberships) ─────────────────────────────
    if (action === 'mine') {
      const mRes = await fetch(
        `${REST}/team_members?athlete_id=eq.${caller.id}&status=eq.active&select=id,team_id,joined_at`,
        { headers: H });
      const rows = mRes.ok ? await mRes.json() : [];
      if (!rows.length) return json({ memberships: [] });
      const ids = rows.map(r => `"${r.team_id}"`).join(',');
      const tRes = await fetch(
        `${REST}/teams?id=in.(${ids})&select=id,name,sport`, { headers: H });
      const teams = tRes.ok ? await tRes.json() : [];
      const byId = Object.fromEntries(teams.map(t => [t.id, t]));
      return json({
        memberships: rows.map(r => ({
          membership_id: r.id, team_id: r.team_id,
          name: byId[r.team_id]?.name || 'Team',
          sport: byId[r.team_id]?.sport || null,
          joined_at: r.joined_at,
        })),
      });
    }

    // ── LEAVE (athlete removes self) ─────────────────────────────
    if (action === 'leave') {
      const teamId = String(body.team_id || '');
      if (!teamId) return json({ error: 'team_id required' }, 400);
      // Capture the coach BEFORE deleting - afterwards the row is gone and
      // there is nothing left to identify whose seat count changed.
      const ownRes = await fetch(
        `${REST}/team_members?athlete_id=eq.${caller.id}&team_id=eq.${teamId}&select=coach_id`,
        { headers: H });
      const leavingCoachId = (ownRes.ok ? await ownRes.json() : [])[0]?.coach_id || null;

      const res = await fetch(
        `${REST}/team_members?athlete_id=eq.${caller.id}&team_id=eq.${teamId}`,
        { method: 'DELETE', headers: H });
      if (!res.ok) return json({ error: 'Could not leave team' }, 500);
      // Roster shrank by the athlete's own action - same sync as a coach remove.
      if (leavingCoachId) await syncCoachSeats(leavingCoachId, { supabaseUrl, serviceKey, stripeSecret: stripeKey() });
      return json({ ok: true });
    }

    // ── REMOVE (coach removes an athlete from own team) ──────────
    if (action === 'remove') {
      const athleteId = String(body.athlete_id || '');
      const teamId = String(body.team_id || '');
      if (!athleteId || !teamId) return json({ error: 'team_id and athlete_id required' }, 400);
      const res = await fetch(
        `${REST}/team_members?coach_id=eq.${caller.id}&team_id=eq.${teamId}&athlete_id=eq.${athleteId}`,
        { method: 'DELETE', headers: H });
      if (!res.ok) return json({ error: 'Could not remove athlete' }, 500);
      // Roster shrank - drop the seat count (or the seat item entirely at zero).
      await syncCoachSeats(caller.id, { supabaseUrl, serviceKey, stripeSecret: stripeKey() });
      return json({ ok: true });
    }

    return json({ error: `Unknown action "${action}"` }, 400);
  } catch (err) {
    console.error('coach-team error:', err.message);
    return json({ error: `Server error: ${err.message}` }, 500);
  }
};
