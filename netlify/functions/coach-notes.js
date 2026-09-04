// netlify/functions/coach-notes.js
// Coach-private notes on an athlete. Athletes can NEVER read these — coach_notes
// has no athlete RLS policy, and this endpoint refuses any caller who is not the
// owning coach.
//
// POST { action: 'list'   , athlete_id, limit? }
// POST { action: 'create' , athlete_id, body }
// POST { action: 'delete' , id }
//
// Netlify Functions v2. Env: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
import { CORS, json, env, svc, verifyCaller, coachOwnsAthlete } from './_coach-auth.js';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_BODY = 4000;

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

  try {
    if (action === 'list' || action === 'create') {
      const athleteId = String(b.athlete_id || '');
      if (!UUID_RE.test(athleteId)) return json({ error: 'Bad athlete_id' }, 400);
      const teamId = await coachOwnsAthlete(supabaseUrl, serviceKey, caller.id, athleteId);
      if (!teamId) return json({ error: 'Not on your roster' }, 403);

      if (action === 'list') {
        const limit = Math.min(200, Math.max(1, parseInt(b.limit, 10) || 50));
        const res = await fetch(
          `${REST}/coach_notes?coach_id=eq.${caller.id}&athlete_id=eq.${athleteId}` +
          `&order=created_at.desc&limit=${limit}&select=id,body,created_at`,
          { headers: H });
        if (!res.ok) return json({ error: 'Could not load notes' }, 500);
        return json({ notes: await res.json() });
      }

      const body = String(b.body || '').trim().slice(0, MAX_BODY);
      if (!body) return json({ error: 'Note body required' }, 400);
      const res = await fetch(`${REST}/coach_notes`, {
        method: 'POST',
        headers: { ...H, 'Content-Type': 'application/json', Prefer: 'return=representation' },
        body: JSON.stringify({ coach_id: caller.id, athlete_id: athleteId, team_id: teamId, body }),
      });
      if (!res.ok) {
        const t = await res.text();
        return json({ error: 'Could not save note', detail: t.slice(0, 200) }, 500);
      }
      return json({ note: (await res.json())[0] });
    }

    if (action === 'delete') {
      const id = String(b.id || '');
      if (!UUID_RE.test(id)) return json({ error: 'Bad id' }, 400);
      // coach_id in the filter is the authorization: a coach can only delete their own.
      const res = await fetch(`${REST}/coach_notes?id=eq.${id}&coach_id=eq.${caller.id}`,
        { method: 'DELETE', headers: H });
      if (!res.ok) return json({ error: 'Could not delete note' }, 500);
      return json({ ok: true });
    }

    return json({ error: `Unknown action "${action}"` }, 400);
  } catch (err) {
    console.error('coach-notes error:', err.message);
    return json({ error: `Server error: ${err.message}` }, 500);
  }
};
