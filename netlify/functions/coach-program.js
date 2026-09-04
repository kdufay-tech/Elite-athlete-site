// netlify/functions/coach-program.js
// Programs a coach builds and assigns to athletes.
//
// A team-wide assignment fans out to one row per athlete in program_assignments,
// so per-athlete start dates and status can diverge without duplicating the program.
//
// Coach actions:
//   POST { action:'create',   name, sport?, wk_type?, wk_focus?, weeks?, blocks?, team_id? }
//   POST { action:'list' }
//   POST { action:'update',   id, ...fields }
//   POST { action:'archive',  id }
//   POST { action:'assign',   id, team_id?, athlete_ids?, starts_on? }
//   POST { action:'unassign', id, athlete_ids }
//   POST { action:'assignees', id }
// Athlete action:
//   POST { action:'mine' }        → programs assigned to the caller
//
// Netlify Functions v2. Env: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
import { CORS, json, env, svc, verifyCaller, rpc } from './_coach-auth.js';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_ASSIGN = 500;          // a pro roster in one call
const MAX_PROGRAMS = 100;

export default async (req) => {
  if (req.method === 'OPTIONS') return new Response('', { status: 200, headers: CORS });
  if (req.method !== 'POST') return json({ error: 'Method Not Allowed' }, 405);

  const { supabaseUrl, serviceKey } = env();
  if (!supabaseUrl || !serviceKey) return json({ error: 'Server not configured' }, 500);

  const caller = await verifyCaller(req, supabaseUrl, serviceKey);
  if (!caller) return json({ error: 'Unauthorized' }, 401);

  let b = {};
  try { b = await req.json(); } catch { return json({ error: 'Invalid JSON' }, 400); }
  const action = String(b.action || '').toLowerCase();
  const H = svc(serviceKey);
  const REST = `${supabaseUrl}/rest/v1`;

  // Every coach action re-checks ownership by filtering on coach_id server-side.
  const ownProgram = async (id) => {
    if (!UUID_RE.test(String(id || ''))) return null;
    const r = await fetch(`${REST}/programs?id=eq.${id}&coach_id=eq.${caller.id}&select=*&limit=1`, { headers: H });
    if (!r.ok) return null;
    return (await r.json())[0] || null;
  };

  try {
    // ── ATHLETE: what am I assigned? ────────────────────────────────
    if (action === 'mine') {
      const aRes = await fetch(
        `${REST}/program_assignments?athlete_id=eq.${caller.id}&status=eq.active` +
        `&select=id,program_id,team_id,starts_on,assigned_at&order=assigned_at.desc`,
        { headers: H });
      const assigns = aRes.ok ? await aRes.json() : [];
      if (!assigns.length) return json({ programs: [] });
      const ids = [...new Set(assigns.map(a => a.program_id))].map(i => `"${i}"`).join(',');
      const pRes = await fetch(
        `${REST}/programs?id=in.(${ids})&select=id,name,sport,wk_type,wk_focus,weeks,blocks`,
        { headers: H });
      const progs = pRes.ok ? await pRes.json() : [];
      const byId = Object.fromEntries(progs.map(p => [p.id, p]));
      return json({
        programs: assigns
          .filter(a => byId[a.program_id])
          .map(a => ({ ...byId[a.program_id], starts_on: a.starts_on, assigned_at: a.assigned_at })),
      });
    }

    // ── CREATE ──────────────────────────────────────────────────────
    if (action === 'create') {
      const name = String(b.name || '').trim().slice(0, 120);
      if (!name) return json({ error: 'Program name required' }, 400);

      const cRes = await fetch(`${REST}/programs?coach_id=eq.${caller.id}&active=is.true&select=id`, { headers: H });
      if (cRes.ok && (await cRes.json()).length >= MAX_PROGRAMS)
        return json({ error: `Program limit reached (${MAX_PROGRAMS})` }, 400);

      const payload = {
        coach_id: caller.id,
        team_id:  b.team_id && UUID_RE.test(String(b.team_id)) ? b.team_id : null,
        name,
        sport:    b.sport    ? String(b.sport).slice(0, 40)    : null,
        wk_type:  b.wk_type  ? String(b.wk_type).slice(0, 40)  : null,
        wk_focus: b.wk_focus ? String(b.wk_focus).slice(0, 40) : null,
        weeks:    Math.min(52, Math.max(1, parseInt(b.weeks, 10) || 4)),
        blocks:   Array.isArray(b.blocks) ? b.blocks : [],
      };
      const res = await fetch(`${REST}/programs`, {
        method: 'POST',
        headers: { ...H, 'Content-Type': 'application/json', Prefer: 'return=representation' },
        body: JSON.stringify(payload),
      });
      if (!res.ok) return json({ error: 'Could not create program', detail: (await res.text()).slice(0, 200) }, 500);
      return json({ program: (await res.json())[0] });
    }

    // ── LIST (with assignment counts) ───────────────────────────────
    if (action === 'list') {
      const res = await fetch(
        `${REST}/programs?coach_id=eq.${caller.id}&order=created_at.desc&select=*`, { headers: H });
      const programs = res.ok ? await res.json() : [];
      if (programs.length) {
        const aRes = await fetch(
          `${REST}/program_assignments?coach_id=eq.${caller.id}&status=eq.active&select=program_id`,
          { headers: H });
        const assigns = aRes.ok ? await aRes.json() : [];
        const counts = assigns.reduce((a, r) => (a[r.program_id] = (a[r.program_id] || 0) + 1, a), {});
        programs.forEach(p => { p.assigned_count = counts[p.id] || 0; });
      }
      return json({ programs });
    }

    // ── UPDATE ──────────────────────────────────────────────────────
    if (action === 'update') {
      const prog = await ownProgram(b.id);
      if (!prog) return json({ error: 'Program not found' }, 404);
      const patch = { updated_at: new Date().toISOString() };
      if (b.name     !== undefined) patch.name     = String(b.name).trim().slice(0, 120);
      if (b.sport    !== undefined) patch.sport    = b.sport    ? String(b.sport).slice(0, 40)    : null;
      if (b.wk_type  !== undefined) patch.wk_type  = b.wk_type  ? String(b.wk_type).slice(0, 40)  : null;
      if (b.wk_focus !== undefined) patch.wk_focus = b.wk_focus ? String(b.wk_focus).slice(0, 40) : null;
      if (b.weeks    !== undefined) patch.weeks    = Math.min(52, Math.max(1, parseInt(b.weeks, 10) || 4));
      if (b.blocks   !== undefined) patch.blocks   = Array.isArray(b.blocks) ? b.blocks : [];
      const res = await fetch(`${REST}/programs?id=eq.${prog.id}&coach_id=eq.${caller.id}`, {
        method: 'PATCH',
        headers: { ...H, 'Content-Type': 'application/json', Prefer: 'return=representation' },
        body: JSON.stringify(patch),
      });
      if (!res.ok) return json({ error: 'Could not update program' }, 500);
      return json({ program: (await res.json())[0] });
    }

    // ── ARCHIVE (never a hard delete — assignments reference it) ─────
    if (action === 'archive') {
      const prog = await ownProgram(b.id);
      if (!prog) return json({ error: 'Program not found' }, 404);
      await fetch(`${REST}/programs?id=eq.${prog.id}&coach_id=eq.${caller.id}`, {
        method: 'PATCH', headers: { ...H, 'Content-Type': 'application/json' },
        body: JSON.stringify({ active: false, updated_at: new Date().toISOString() }),
      });
      await fetch(`${REST}/program_assignments?program_id=eq.${prog.id}&coach_id=eq.${caller.id}`, {
        method: 'PATCH', headers: { ...H, 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'archived' }),
      });
      return json({ ok: true });
    }

    // ── ASSIGN ──────────────────────────────────────────────────────
    if (action === 'assign') {
      const prog = await ownProgram(b.id);
      if (!prog) return json({ error: 'Program not found' }, 404);

      const teamId = b.team_id && UUID_RE.test(String(b.team_id)) ? b.team_id : prog.team_id;
      const explicit = (Array.isArray(b.athlete_ids) ? b.athlete_ids : [])
        .map(String).filter(s => UUID_RE.test(s));

      // Resolve targets from the coach's own roster — never from client-supplied
      // ids alone, so a coach cannot assign to someone else's athlete.
      let mUrl = `${REST}/team_members?coach_id=eq.${caller.id}&status=eq.active&select=athlete_id,team_id&limit=${MAX_ASSIGN}`;
      if (teamId) mUrl += `&team_id=eq.${teamId}`;
      const mRes = await fetch(mUrl, { headers: H });
      let members = mRes.ok ? await mRes.json() : [];
      if (explicit.length) {
        const want = new Set(explicit);
        members = members.filter(m => want.has(m.athlete_id));
      }
      if (!members.length) return json({ error: 'No athletes matched on your roster' }, 400);

      const startsOn = /^\d{4}-\d{2}-\d{2}$/.test(String(b.starts_on || ''))
        ? b.starts_on : new Date().toISOString().slice(0, 10);

      const rows = members.map(m => ({
        program_id: prog.id, coach_id: caller.id, athlete_id: m.athlete_id,
        team_id: m.team_id, starts_on: startsOn, status: 'active',
      }));

      const res = await fetch(`${REST}/program_assignments`, {
        method: 'POST',
        headers: { ...H, 'Content-Type': 'application/json',
                   Prefer: 'return=representation,resolution=merge-duplicates' },
        body: JSON.stringify(rows),
      });
      if (!res.ok) return json({ error: 'Could not assign', detail: (await res.text()).slice(0, 200) }, 500);
      const created = await res.json();
      return json({ assigned: created.length, program_id: prog.id, starts_on: startsOn });
    }

    // ── UNASSIGN ────────────────────────────────────────────────────
    if (action === 'unassign') {
      const prog = await ownProgram(b.id);
      if (!prog) return json({ error: 'Program not found' }, 404);
      const ids = (Array.isArray(b.athlete_ids) ? b.athlete_ids : [])
        .map(String).filter(s => UUID_RE.test(s));
      if (!ids.length) return json({ error: 'athlete_ids required' }, 400);
      const list = ids.map(i => `"${i}"`).join(',');
      const res = await fetch(
        `${REST}/program_assignments?program_id=eq.${prog.id}&coach_id=eq.${caller.id}&athlete_id=in.(${list})`,
        { method: 'DELETE', headers: H });
      if (!res.ok) return json({ error: 'Could not unassign' }, 500);
      return json({ ok: true, removed: ids.length });
    }

    // ── ASSIGNEES ───────────────────────────────────────────────────
    if (action === 'assignees') {
      const prog = await ownProgram(b.id);
      if (!prog) return json({ error: 'Program not found' }, 404);
      const res = await fetch(
        `${REST}/program_assignments?program_id=eq.${prog.id}&coach_id=eq.${caller.id}&status=eq.active` +
        `&select=athlete_id,starts_on,assigned_at&limit=${MAX_ASSIGN}`, { headers: H });
      const rows = res.ok ? await res.json() : [];
      if (!rows.length) return json({ assignees: [] });
      const ids = rows.map(r => `"${r.athlete_id}"`).join(',');
      const pRes = await fetch(`${REST}/profiles?user_id=in.(${ids})&select=user_id,name,position`, { headers: H });
      const profs = pRes.ok ? await pRes.json() : [];
      const byId = Object.fromEntries(profs.map(p => [p.user_id, p]));
      return json({
        assignees: rows.map(r => ({
          athlete_id: r.athlete_id,
          name: byId[r.athlete_id]?.name || 'Athlete',
          position: byId[r.athlete_id]?.position || null,
          starts_on: r.starts_on, assigned_at: r.assigned_at,
        })),
      });
    }

    return json({ error: `Unknown action "${action}"` }, 400);
  } catch (err) {
    console.error('coach-program error:', err.message);
    return json({ error: `Server error: ${err.message}` }, 500);
  }
};
