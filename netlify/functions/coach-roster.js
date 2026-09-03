// netlify/functions/coach-roster.js
// GET — returns the calling coach's roster with each athlete's latest check-in,
// readiness score, and at-risk flag. Cross-user reads are done with the service
// role because per-user RLS forbids a coach reading athletes' rows from the client.
// Netlify Functions v2 — requires "type":"module" in package.json.
// Env: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
import { CORS, json, env, svc, verifyCaller, computeReadiness } from './_coach-auth.js';

const DAY = 86400000;

export default async (req) => {
  if (req.method === 'OPTIONS') return new Response('', { status: 200, headers: CORS });
  if (req.method !== 'GET') return json({ error: 'Method Not Allowed' }, 405);

  const { supabaseUrl, serviceKey } = env();
  if (!supabaseUrl || !serviceKey) return json({ error: 'Server not configured' }, 500);

  const caller = await verifyCaller(req, supabaseUrl, serviceKey);
  if (!caller) return json({ error: 'Unauthorized' }, 401);

  const H = svc(serviceKey);
  const REST = `${supabaseUrl}/rest/v1`;
  const url = new URL(req.url);
  const teamFilter = url.searchParams.get('team_id') || null;

  try {
    // 1. Caller must own at least one team.
    const tRes = await fetch(
      `${REST}/teams?coach_id=eq.${caller.id}&order=created_at.asc&select=id,name,sport,join_code,active`,
      { headers: H });
    const teams = tRes.ok ? await tRes.json() : [];
    if (!teams.length) return json({ teams: [], roster: [], noTeam: true });

    // 2. Roster memberships.
    let mUrl = `${REST}/team_members?coach_id=eq.${caller.id}&status=eq.active&select=team_id,athlete_id,position,sport,joined_at`;
    if (teamFilter) mUrl += `&team_id=eq.${teamFilter}`;
    const mRes = await fetch(mUrl, { headers: H });
    const members = mRes.ok ? await mRes.json() : [];
    if (!members.length) return json({ teams, roster: [] });

    const athleteIds = [...new Set(members.map(m => m.athlete_id))];
    const idList = athleteIds.map(id => `"${id}"`).join(',');

    // 3. Profiles + check-ins (service role — the whole reason this is server-side).
    const [profRes, ciRes] = await Promise.all([
      fetch(`${REST}/profiles?user_id=in.(${idList})&select=user_id,name,sport,position,goal`,
        { headers: H }),
      fetch(`${REST}/check_ins?user_id=in.(${idList})&order=date.desc&limit=2000&select=user_id,date,recovery,energy,sleep,soreness,mood,notes`,
        { headers: H }),
    ]);
    const profiles = profRes.ok ? await profRes.json() : [];
    const checkIns = ciRes.ok ? await ciRes.json() : [];

    const profById = Object.fromEntries(profiles.map(p => [p.user_id, p]));
    const ciByAthlete = {};
    for (const c of checkIns) (ciByAthlete[c.user_id] ||= []).push(c);

    const teamById = Object.fromEntries(teams.map(t => [t.id, t]));
    const today = new Date(); today.setHours(0, 0, 0, 0);

    // 4. Build roster rows.
    const roster = members.map(m => {
      const prof = profById[m.athlete_id] || {};
      const rows = ciByAthlete[m.athlete_id] || [];   // already date-desc
      const latest = rows[0] || null;
      const sport = (prof.sport || m.sport || '').toLowerCase();
      const readiness = computeReadiness(rows, sport);

      let daysSinceCheckIn = null;
      if (latest?.date) {
        const d = new Date(latest.date + 'T00:00:00');
        daysSinceCheckIn = Math.max(0, Math.round((today - d) / DAY));
      }

      const stale = daysSinceCheckIn === null || daysSinceCheckIn >= 3;
      const lowReadiness = readiness !== null && readiness < 5;
      const flags = [];
      if (daysSinceCheckIn === null) flags.push('never checked in');
      else if (daysSinceCheckIn >= 3) flags.push(`${daysSinceCheckIn}d since check-in`);
      if (lowReadiness) flags.push('low readiness');
      if (latest && Number(latest.soreness) >= 7) flags.push('high soreness');
      if (latest && Number(latest.sleep) && Number(latest.sleep) < 6) flags.push('short sleep');

      return {
        athlete_id: m.athlete_id,
        team_id: m.team_id,
        team_name: teamById[m.team_id]?.name || 'Team',
        name: prof.name || 'Athlete',
        sport: prof.sport || m.sport || null,
        position: prof.position || m.position || null,
        goal: prof.goal || null,
        readiness,
        daysSinceCheckIn,
        checkInCount: rows.length,
        lastCheckIn: latest
          ? {
              date: latest.date,
              recovery: latest.recovery, energy: latest.energy,
              sleep: latest.sleep, soreness: latest.soreness, mood: latest.mood,
              notes: latest.notes || '',
            }
          : null,
        atRisk: stale || lowReadiness,
        flags,
        joined_at: m.joined_at,
      };
    });

    // 5. At-risk first, then lowest readiness, then name.
    roster.sort((a, b) =>
      (b.atRisk - a.atRisk) ||
      ((a.readiness ?? -1) - (b.readiness ?? -1)) ||
      a.name.localeCompare(b.name)
    );

    const withCheckIns = roster.filter(r => r.readiness !== null);
    const summary = {
      total: roster.length,
      atRisk: roster.filter(r => r.atRisk).length,
      avgReadiness: withCheckIns.length
        ? Math.round((withCheckIns.reduce((a, r) => a + r.readiness, 0) / withCheckIns.length) * 10) / 10
        : null,
      checkedInToday: roster.filter(r => r.daysSinceCheckIn === 0).length,
    };

    return json({ teams, roster, summary });
  } catch (err) {
    console.error('coach-roster error:', err.message);
    return json({ error: `Server error: ${err.message}` }, 500);
  }
};
