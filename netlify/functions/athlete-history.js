// ─────────────────────────────────────────────────────────────
// netlify/functions/athlete-history.js
// An athlete's full record, beyond the 90-day window the app normally reads.
//
// WHY
//   Every loader in src/lib/supabase.js filters to the last three months, so a
//   multi-year career is invisible to the person who owns it. That matters most
//   exactly when it should matter most - an athlete moving high school ->
//   college -> pro, whose record is the thing that travels with them.
//
// SHAPE - pagination first, aggregation on demand
//   'teams' returns the athlete's membership spans, departed ones included, so
//     the timeline can be grouped by team and era rather than being a flat run
//     of months. Depends on the soft-delete in 20260907_team_members_soft_delete.
//   'summary' returns ONE ROW PER MONTH via athlete_history_summary(). A four
//     year career costs 48 rows, not tens of thousands.
//   'page' returns raw rows for one table and one window, with limit/offset and
//     an exact count. Nothing here ever loads a whole table.
//
// AUTHORISATION
//   verifyCaller establishes who is asking, and every query is pinned to THAT
//   id. p_user_id is never taken from the request body - an athlete can only
//   ever read their own record through this endpoint. Coach access, scoped to
//   the window a coach actually had the athlete on their roster, is a separate
//   piece of work and deliberately absent here.
// ─────────────────────────────────────────────────────────────

import { CORS, json, env, verifyCaller } from './_coach-auth.js';

// Whitelist. A table name from the request body must match one of these
// exactly, so the value can never reach the URL uncontrolled.
const TABLES = {
  check_ins:       'id,date,recovery,energy,sleep,soreness,mood,notes,created_at',
  workout_logs:    'id,date,week,exercise,load,rpe,sets,total_vol,wk_type,wk_focus,notes,created_at',
  weight_logs:     'id,date,weight,body_fat,created_at',
  nutrition_logs:  'id,date,calories,protein,carbs,fat,water,created_at',
  benchmarks:      'id,date,test,value,unit,notes,created_at',
  progress_notes:  'id,text,created_at',
  journal_entries: 'id,title,text,created_at',
  calendar_events: 'id,created_at',
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

  const H    = { apikey: serviceKey, Authorization: `Bearer ${serviceKey}` };
  const REST = `${supabaseUrl}/rest/v1`;
  const action = String(body.action || '').toLowerCase();

  // Range. Defaults to five years back, which comfortably covers a school
  // career without ever being unbounded.
  const to   = body.to   ? new Date(body.to)   : new Date();
  const from = body.from ? new Date(body.from) : new Date(Date.now() - 5 * 365 * 86400000);
  if (isNaN(from) || isNaN(to)) return json({ error: 'Invalid date range' }, 400);

  try {
    // ── SUMMARY - one row per month ──────────────────────────
    if (action === 'summary') {
      const r = await fetch(`${REST}/rpc/athlete_history_summary`, {
        method: 'POST',
        headers: { ...H, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          p_user_id: caller.id,          // never from the request body
          p_from: from.toISOString(),
          p_to:   to.toISOString(),
        }),
      });
      if (!r.ok) return json({ error: 'Could not build summary', detail: (await r.text()).slice(0, 200) }, 500);
      const months = await r.json();
      return json({
        months,
        // Non-empty months only, so the client can render a career timeline
        // without walking dead space.
        active: months.filter(m =>
          (m.check_ins + m.sessions + m.weight_entries + m.nutrition_days +
           m.benchmarks + m.notes + m.journals) > 0),
        from: from.toISOString(), to: to.toISOString(),
      });
    }

    // ── TEAMS - the spans that turn months into a career ─────
    //   Every membership the athlete has ever held, departed ones included.
    //   This is the ONLY reason soft-delete exists: without it there is no
    //   "Luella HS 2023-26, then State U", just undifferentiated months.
    //   Unpaginated on purpose - one row per team an athlete has belonged to
    //   is a handful over a whole career, not a table that grows without
    //   bound. joined_at ascending so the client renders a timeline, not a
    //   reverse-chronological list.
    if (action === 'teams') {
      const r = await fetch(
        `${REST}/team_members?athlete_id=eq.${caller.id}`
        + `&select=id,team_id,status,joined_at,left_at,sport,position,teams(name,sport,level)`
        + `&order=joined_at.asc`,
        { headers: H });
      if (!r.ok) return json({ error: 'Could not read team history', detail: (await r.text()).slice(0, 200) }, 500);
      const rows = await r.json();
      return json({
        teams: rows.map(m => ({
          membership_id: m.id,
          team_id:  m.team_id,
          name:     m.teams?.name || 'Team',
          level:    m.teams?.level || null,
          sport:    m.sport || m.teams?.sport || null,
          position: m.position || null,
          status:   m.status,
          joined_at: m.joined_at,
          left_at:   m.left_at,
          current:   m.status === 'active',
        })),
      });
    }

    // ── PAGE - raw rows for one table, one window ────────────
    if (action === 'page') {
      const table = String(body.table || '');
      const cols  = TABLES[table];
      if (!cols) return json({ error: `Unknown table "${table}"` }, 400);

      const limit  = Math.min(Math.max(parseInt(body.limit, 10) || 50, 1), MAX_LIMIT);
      const offset = Math.max(parseInt(body.offset, 10) || 0, 0);

      const url = `${REST}/${table}?user_id=eq.${caller.id}`
        + `&created_at=gte.${from.toISOString()}&created_at=lte.${to.toISOString()}`
        + `&select=${cols}&order=created_at.desc&limit=${limit}&offset=${offset}`;

      const r = await fetch(url, { headers: { ...H, Prefer: 'count=exact' } });
      if (!r.ok) return json({ error: 'Could not read history' }, 500);

      const rows  = await r.json();
      const total = Number((r.headers.get('content-range') || '').split('/')[1]) || 0;
      return json({ table, rows, total, limit, offset, hasMore: offset + rows.length < total });
    }

    return json({ error: `Unknown action "${action}"` }, 400);
  } catch (err) {
    console.error('athlete-history error:', err.message);
    return json({ error: `Server error: ${err.message}` }, 500);
  }
};
