// netlify/functions/coach-team.js
// Team lifecycle: create (coach), join (athlete), list (coach), mine (athlete),
// leave (athlete), remove (coach).
// Netlify Functions v2 — requires "type":"module" in package.json.
// Env: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
import { CORS, json, env, svc, verifyCaller, makeJoinCode } from './_coach-auth.js';

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
          body: JSON.stringify({ coach_id: caller.id, name, sport, join_code }),
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

      const tRes = await fetch(
        `${REST}/teams?join_code=eq.${code}&active=is.true&select=id,name,sport,coach_id`,
        { headers: H });
      const teams = tRes.ok ? await tRes.json() : [];
      const team = teams[0];
      if (!team) return json({ error: 'No team found with that code' }, 404);
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
      return json({ team: { id: team.id, name: team.name }, already: false });
    }

    // ── LIST (coach's own teams, with member counts) ─────────────
    if (action === 'list') {
      const tRes = await fetch(
        `${REST}/teams?coach_id=eq.${caller.id}&order=created_at.asc&select=id,name,sport,join_code,active,created_at`,
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
      const res = await fetch(
        `${REST}/team_members?athlete_id=eq.${caller.id}&team_id=eq.${teamId}`,
        { method: 'DELETE', headers: H });
      if (!res.ok) return json({ error: 'Could not leave team' }, 500);
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
      return json({ ok: true });
    }

    return json({ error: `Unknown action "${action}"` }, 400);
  } catch (err) {
    console.error('coach-team error:', err.message);
    return json({ error: `Server error: ${err.message}` }, 500);
  }
};
