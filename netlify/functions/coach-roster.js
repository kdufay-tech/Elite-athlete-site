// netlify/functions/coach-roster.js
// GET — the calling coach's roster, PAGINATED, with readiness computed in Postgres.
//
// Phase 0 built a `user_id=in.(<every athlete id>)` filter and reduced raw check-ins
// in JavaScript. At 500 athletes that URL is ~18KB (past what proxies accept) and the
// payload was 45,000 rows to compute 500 numbers. This version calls
// coach_roster_page(), so the response tracks PAGE size, not roster size.
// Measured: 500 athletes / 45k check-ins → 15ms, index-only, 0 heap fetches.
//
// Netlify Functions v2 — requires "type":"module" in package.json.
// Env: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
import { CORS, json, env, verifyCaller, rpc, coachTeams } from './_coach-auth.js';

const MAX_LIMIT = 200;

export default async (req) => {
  if (req.method === 'OPTIONS') return new Response('', { status: 200, headers: CORS });
  if (req.method !== 'GET') return json({ error: 'Method Not Allowed' }, 405);

  const { supabaseUrl, serviceKey } = env();
  if (!supabaseUrl || !serviceKey) return json({ error: 'Server not configured' }, 500);

  const caller = await verifyCaller(req, supabaseUrl, serviceKey);
  if (!caller) return json({ error: 'Unauthorized' }, 401);

  const url = new URL(req.url);
  const teamId = url.searchParams.get('team_id') || null;
  const search = url.searchParams.get('q') || null;
  const limit  = Math.min(MAX_LIMIT, Math.max(1, parseInt(url.searchParams.get('limit')  || '50', 10) || 50));
  const offset = Math.max(0, parseInt(url.searchParams.get('offset') || '0', 10) || 0);

  try {
    const teams = await coachTeams(supabaseUrl, serviceKey, caller.id);
    if (!teams.length) return json({ teams: [], roster: [], noTeam: true });

    const rows = await rpc(supabaseUrl, serviceKey, 'coach_roster_page', {
      p_coach: caller.id, p_team: teamId, p_limit: limit, p_offset: offset, p_search: search,
    });

    const total = rows[0]?.total_count ?? 0;

    const roster = rows.map(r => {
      const flags = [];
      if (r.days_since === null || r.days_since === undefined) flags.push('never checked in');
      else if (r.days_since >= 3) flags.push(`${r.days_since}d since check-in`);
      if (r.readiness !== null && Number(r.readiness) < 5) flags.push('low readiness');
      if (r.last_soreness !== null && Number(r.last_soreness) >= 7) flags.push('high soreness');
      if (r.last_sleep !== null && Number(r.last_sleep) > 0 && Number(r.last_sleep) < 6) flags.push('short sleep');

      return {
        athlete_id: r.athlete_id,
        team_id: r.team_id,
        team_name: r.team_name,
        name: r.name,
        sport: r.sport,
        position: r.position,
        readiness: r.readiness === null ? null : Number(r.readiness),
        daysSinceCheckIn: r.days_since,
        checkInCount: Number(r.check_in_count || 0),
        lastCheckIn: r.last_date ? {
          date: r.last_date,
          recovery: r.last_recovery, energy: r.last_energy, sleep: r.last_sleep,
          soreness: r.last_soreness, mood: r.last_mood, notes: r.last_notes || '',
        } : null,
        atRisk: !!r.at_risk,
        flags,
      };
    });

    // Summary is computed over the WHOLE roster, not the current page. A page-local
    // at-risk count would understate risk on a large roster — and that is the one
    // number a coach has to be able to trust.
    const sum = (await rpc(supabaseUrl, serviceKey, 'coach_roster_summary', {
      p_coach: caller.id, p_team: teamId,
    }))[0] || {};

    return json({
      teams,
      roster,
      page: { limit, offset, total: Number(total), returned: roster.length,
              hasMore: offset + roster.length < Number(total) },
      summary: {
        total:          Number(sum.total || 0),
        atRisk:         Number(sum.at_risk || 0),
        avgReadiness:   sum.avg_readiness === null || sum.avg_readiness === undefined
                          ? null : Number(sum.avg_readiness),
        checkedInToday: Number(sum.checked_in_today || 0),
        neverCheckedIn: Number(sum.never_checked_in || 0),
      },
    });
  } catch (err) {
    console.error('coach-roster error:', err.message);
    return json({ error: `Server error: ${err.message}` }, 500);
  }
};
