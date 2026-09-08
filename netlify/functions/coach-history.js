// ─────────────────────────────────────────────────────────────
// netlify/functions/coach-history.js
// One athlete's record, as their CURRENT coach is allowed to see it.
//
// THE RULE (set 2026-09-08)
//   tenure = [joined_at, now()] for an ACTIVE membership.
//     within tenure   -> full detail: monthly counts and raw rows
//     before tenure   -> monthly summary ONLY (readiness components +
//                        training volume). No counts, no raw rows.
//     after departure -> nothing at all. coachOwnsAthlete() requires
//                        status='active', so a departed athlete's record
//                        closes to that coach completely.
//
//   The point is a transfer. Before this, coach-trends could be asked for
//   days=365 and would return a full year regardless of when the athlete
//   joined - i.e. the previous school's record. Tenure scoping is what makes
//   a portable career record safe to build.
//
// WHAT A COACH NEVER SEES
//   journal_entries and progress_notes are absent from TABLES below, at any
//   point in the tenure. They are the athlete's own reflective writing, not
//   performance data, and nothing in the product promises them to a coach.
//   calendar_events is omitted as noise. Adding a table here widens what every
//   coach can read - do it deliberately.
//
// AUTHORISATION IS DOUBLED
//   coachOwnsAthlete() gates the request, and coach_athlete_history() is
//   SECURITY DEFINER with the same ACTIVE-membership join inside it, so it
//   returns zero rows for a coach who does not coach this athlete even if the
//   endpoint check were bypassed. p_coach is always caller.id, never from the
//   body.
// ─────────────────────────────────────────────────────────────

import { CORS, json, env, verifyCaller, rpc, coachOwnsAthlete } from './_coach-auth.js';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Performance data only. See "WHAT A COACH NEVER SEES" above.
const TABLES = {
  check_ins:      'id,date,recovery,energy,sleep,soreness,mood,created_at',
  workout_logs:   'id,date,exercise,load,rpe,sets,total_vol,wk_type,wk_focus,created_at',
  weight_logs:    'id,date,weight,body_fat,created_at',
  nutrition_logs: 'id,date,calories,protein,carbs,fat,water,created_at',
  benchmarks:     'id,date,test,value,unit,notes,created_at',
};

const MAX_LIMIT = 100;

export default async (req) => {
  if (req.method === 'OPTIONS') return new Response('', { status: 200, headers: CORS });
  if (req.method !== 'POST')    return json({ error: 'Method Not Allowed' }, 405);

  const { supabaseUrl, serviceKey } = env();
  if (!supabaseUrl || !serviceKey) return json({ error: 'Server not configured' }, 500);

  const caller = await verifyCaller(req, supabaseUrl, serviceKey);
  if (!caller) return json({ error: 'Unauthorized' }, 401);

  let body = {};
  try { body = await req.json(); } catch { return json({ error: 'Invalid JSON' }, 400); }

  const athleteId = String(body.athlete_id || '');
  if (!UUID_RE.test(athleteId)) return json({ error: 'Bad athlete_id' }, 400);

  const team = await coachOwnsAthlete(supabaseUrl, serviceKey, caller.id, athleteId);
  if (!team) return json({ error: 'Not on your roster' }, 403);

  const H    = { apikey: serviceKey, Authorization: `Bearer ${serviceKey}` };
  const REST = `${supabaseUrl}/rest/v1`;
  const action = String(body.action || '').toLowerCase();

  // Tenure start: the EARLIEST join across this coach's teams. An athlete can
  // sit on two of the same coach's squads; the coach has been coaching them
  // since the first of those dates.
  const tRes = await fetch(
    `${REST}/team_members?coach_id=eq.${caller.id}&athlete_id=eq.${athleteId}&status=eq.active`
    + `&select=joined_at&order=joined_at.asc&limit=1`, { headers: H });
  const since = (tRes.ok ? await tRes.json() : [])[0]?.joined_at || null;
  if (!since) return json({ error: 'Not on your roster' }, 403);

  const to   = body.to   ? new Date(body.to)   : new Date();
  const from = body.from ? new Date(body.from) : new Date(Date.now() - 5 * 365 * 86400000);
  if (isNaN(from) || isNaN(to)) return json({ error: 'Invalid date range' }, 400);

  try {
    // ── SUMMARY - one row per month, tenure-aware ────────────
    if (action === 'summary') {
      const months = await rpc(supabaseUrl, serviceKey, 'coach_athlete_history', {
        p_coach:   caller.id,        // never from the body
        p_athlete: athleteId,
        p_from:    from.toISOString(),
        p_to:      to.toISOString(),
      });
      return json({
        athlete_id: athleteId,
        since,
        months,
        // Non-empty months only, so the client renders a timeline rather than
        // walking dead space.
        active: months.filter(m =>
          m.avg_recovery !== null || Number(m.total_volume) > 0 ||
          (m.check_ins ?? 0) > 0   || (m.sessions ?? 0) > 0),
      });
    }

    // ── PAGE - raw rows, WITHIN TENURE ONLY ──────────────────
    if (action === 'page') {
      const table = String(body.table || '');
      const cols  = TABLES[table];
      if (!cols) return json({ error: `Unknown table "${table}"` }, 400);

      // The clamp. A coach asking for a window that starts before they began
      // coaching gets the tenure start instead - never the athlete's earlier
      // record. Silently clamping rather than erroring keeps the UI simple and
      // means a wide default range still returns the right thing.
      const tenureStart = new Date(since);
      const effFrom = from < tenureStart ? tenureStart : from;
      if (to < tenureStart) {
        return json({ table, rows: [], total: 0, limit: 0, offset: 0, hasMore: false,
                      clamped: true, since });
      }

      const limit  = Math.min(Math.max(parseInt(body.limit, 10) || 50, 1), MAX_LIMIT);
      const offset = Math.max(parseInt(body.offset, 10) || 0, 0);

      const url = `${REST}/${table}?user_id=eq.${athleteId}`
        + `&created_at=gte.${effFrom.toISOString()}&created_at=lte.${to.toISOString()}`
        + `&select=${cols}&order=created_at.desc&limit=${limit}&offset=${offset}`;

      const r = await fetch(url, { headers: { ...H, Prefer: 'count=exact' } });
      if (!r.ok) return json({ error: 'Could not read history' }, 500);

      const rows  = await r.json();
      const total = Number((r.headers.get('content-range') || '').split('/')[1]) || 0;
      return json({
        table, rows, total, limit, offset,
        hasMore: offset + rows.length < total,
        clamped: effFrom > from, since,
      });
    }

    return json({ error: `Unknown action "${action}"` }, 400);
  } catch (err) {
    console.error('coach-history error:', err.message);
    return json({ error: `Server error: ${err.message}` }, 500);
  }
};
