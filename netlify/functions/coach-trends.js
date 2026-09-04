// netlify/functions/coach-trends.js
// GET — readiness over time. Three shapes, three jobs:
//   ?athlete_id=<uuid>&days=30   → one athlete's daily series + the team median
//   ?ids=<uuid,uuid,...>&days=14 → sparkline data for a page of the roster
//   ?team_id=<uuid>&days=30      → team average + check-in compliance per day
//
// Series are computed in Postgres with the window INPUT bounded to the requested
// range (+7 days lead-in for the trailing-3 window). Unbounded, a 30-day chart
// scans the athlete's entire history, so cost grows with account age rather than
// with the range asked for. Measured on 500 athletes / 365k rows: 24ms vs 129ms.
//
// Netlify Functions v2. Env: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
import { CORS, json, env, verifyCaller, rpc, coachOwnsAthlete } from './_coach-auth.js';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_IDS = 200;   // one roster page

function clampDays(v) {
  const n = parseInt(v || '30', 10);
  if (!Number.isFinite(n)) return 30;
  return Math.min(365, Math.max(1, n));
}

// Median, not mean, for the reference line: one athlete who never checks in drags
// a mean down and makes everyone else look better than they are.
function median(nums) {
  const a = nums.filter(n => n !== null && n !== undefined).sort((x, y) => x - y);
  if (!a.length) return null;
  const mid = Math.floor(a.length / 2);
  return a.length % 2 ? a[mid] : Math.round(((a[mid - 1] + a[mid]) / 2) * 10) / 10;
}

export default async (req) => {
  if (req.method === 'OPTIONS') return new Response('', { status: 200, headers: CORS });
  if (req.method !== 'GET') return json({ error: 'Method Not Allowed' }, 405);

  const { supabaseUrl, serviceKey } = env();
  if (!supabaseUrl || !serviceKey) return json({ error: 'Server not configured' }, 500);

  const caller = await verifyCaller(req, supabaseUrl, serviceKey);
  if (!caller) return json({ error: 'Unauthorized' }, 401);

  const url = new URL(req.url);
  const athleteId = url.searchParams.get('athlete_id');
  const idsParam  = url.searchParams.get('ids');
  const teamId    = url.searchParams.get('team_id') || null;
  const days      = clampDays(url.searchParams.get('days'));

  try {
    // ── ONE ATHLETE: series + team median reference ──────────────────
    if (athleteId) {
      if (!UUID_RE.test(athleteId)) return json({ error: 'Bad athlete_id' }, 400);
      // Authorization is checked here AND structurally inside the SQL function.
      const team = await coachOwnsAthlete(supabaseUrl, serviceKey, caller.id, athleteId);
      if (!team) return json({ error: 'Not on your roster' }, 403);

      const [rows, teamRows] = await Promise.all([
        rpc(supabaseUrl, serviceKey, 'coach_readiness_series',
            { p_coach: caller.id, p_athletes: [athleteId], p_days: days }),
        rpc(supabaseUrl, serviceKey, 'coach_team_series',
            { p_coach: caller.id, p_team: teamId || team, p_days: days }),
      ]);

      const series = rows.map(r => ({ d: r.d, r: r.readiness === null ? null : Number(r.readiness) }));
      const values = series.map(p => p.r).filter(v => v !== null);

      return json({
        athlete_id: athleteId,
        days,
        series,
        teamReference: teamRows.map(t => ({
          d: t.d,
          r: t.avg_readiness === null ? null : Number(t.avg_readiness),
        })),
        stats: {
          points: values.length,
          latest: values.length ? values[values.length - 1] : null,
          best:   values.length ? Math.max(...values) : null,
          worst:  values.length ? Math.min(...values) : null,
          median: median(values),
          // trend = second half mean minus first half mean; positive is improving
          trend: values.length >= 4
            ? Math.round(((values.slice(Math.ceil(values.length / 2)).reduce((a, b) => a + b, 0) /
                            Math.floor(values.length / 2)) -
                          (values.slice(0, Math.floor(values.length / 2)).reduce((a, b) => a + b, 0) /
                            Math.floor(values.length / 2))) * 10) / 10
            : null,
        },
      });
    }

    // ── MANY ATHLETES: sparkline data for a roster page ──────────────
    if (idsParam) {
      const ids = idsParam.split(',').map(s => s.trim()).filter(s => UUID_RE.test(s)).slice(0, MAX_IDS);
      if (!ids.length) return json({ error: 'No valid ids' }, 400);

      const rows = await rpc(supabaseUrl, serviceKey, 'coach_readiness_series',
        { p_coach: caller.id, p_athletes: ids, p_days: days });

      // Group into compact per-athlete arrays. The SQL already filtered to athletes
      // on this coach's roster, so anything not returned simply isn't theirs.
      const byAthlete = {};
      for (const r of rows) {
        (byAthlete[r.athlete_id] ||= []).push({ d: r.d, r: Number(r.readiness) });
      }
      return json({ days, series: byAthlete });
    }

    // ── TEAM: average readiness + compliance per day ─────────────────
    const teamRows = await rpc(supabaseUrl, serviceKey, 'coach_team_series',
      { p_coach: caller.id, p_team: teamId, p_days: days });

    return json({
      days,
      team: teamRows.map(t => ({
        d: t.d,
        r: t.avg_readiness === null ? null : Number(t.avg_readiness),
        checkedIn: Number(t.checked_in || 0),
        rosterSize: Number(t.roster_size || 0),
        compliance: t.compliance === null ? null : Number(t.compliance),
      })),
    });
  } catch (err) {
    console.error('coach-trends error:', err.message);
    return json({ error: `Server error: ${err.message}` }, 500);
  }
};
