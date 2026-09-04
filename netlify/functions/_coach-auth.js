// netlify/functions/_coach-auth.js
// Shared helpers for the coach endpoints.
// Same env var names + JWT-verify pattern as admin-data.js / coach.js.

export const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Authorization, Content-Type',
  'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
  'Content-Type': 'application/json',
};

export function json(body, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: CORS });
}

export function env() {
  const supabaseUrl = process.env.SUPABASE_URL;
  const serviceKey =
    process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY;
  return { supabaseUrl, serviceKey };
}

export function svc(serviceKey) {
  return { apikey: serviceKey, Authorization: `Bearer ${serviceKey}` };
}

// Verify the caller's Supabase JWT. Returns { id, email } or null.
export async function verifyCaller(req, supabaseUrl, serviceKey) {
  const authHeader = req.headers.get('authorization') || '';
  if (!authHeader.startsWith('Bearer ')) return null;
  const token = authHeader.slice(7).trim();
  if (!token) return null;
  const res = await fetch(`${supabaseUrl}/auth/v1/user`, {
    headers: { apikey: serviceKey, Authorization: `Bearer ${token}` },
  });
  if (!res.ok) return null;
  const u = await res.json();
  return u?.id ? { id: u.id, email: u.email } : null;
}

// Call a Postgres function. These are SECURITY DEFINER and granted only to
// service_role, so they can never be invoked directly with the anon key.
export async function rpc(supabaseUrl, serviceKey, fn, args) {
  const res = await fetch(`${supabaseUrl}/rest/v1/rpc/${fn}`, {
    method: 'POST',
    headers: { ...svc(serviceKey), 'Content-Type': 'application/json' },
    body: JSON.stringify(args || {}),
  });
  if (!res.ok) {
    const t = await res.text();
    throw new Error(`rpc ${fn} failed (${res.status}): ${t.slice(0, 300)}`);
  }
  return res.json();
}

// Structural authorization: does this coach own at least one team, and is this
// athlete on one of them? Every cross-user read goes through one of these.
export async function coachOwnsAthlete(supabaseUrl, serviceKey, coachId, athleteId) {
  const res = await fetch(
    `${supabaseUrl}/rest/v1/team_members?coach_id=eq.${coachId}&athlete_id=eq.${athleteId}&status=eq.active&select=team_id&limit=1`,
    { headers: svc(serviceKey) });
  if (!res.ok) return null;
  const rows = await res.json();
  return rows[0]?.team_id || null;
}

export async function coachTeams(supabaseUrl, serviceKey, coachId) {
  const res = await fetch(
    `${supabaseUrl}/rest/v1/teams?coach_id=eq.${coachId}&order=created_at.asc&select=id,name,sport,join_code,active`,
    { headers: svc(serviceKey) });
  return res.ok ? res.json() : [];
}

// Unambiguous join codes — no O/0, I/1.
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
export function makeJoinCode(len = 6) {
  let out = '';
  const bytes = new Uint8Array(len);
  crypto.getRandomValues(bytes);
  for (let i = 0; i < len; i++) out += CODE_ALPHABET[bytes[i] % CODE_ALPHABET.length];
  return out;
}

// Canonical readiness formula — mirrors src/App.jsx (Game-Day Readiness) and the
// Postgres implementation in coach_roster_page(). Kept for any JS-side use.
// rows = that athlete's check_ins, newest first.
export function computeReadiness(rows, sport) {
  if (!rows || rows.length === 0) return null;
  const win = rows.slice(0, 3);
  const avg = (k, d) => win.reduce((a, r) => a + (Number(r[k]) || d), 0) / win.length;
  const optimalSleep = sport === 'football' || sport === 'basketball' ? 9 : 8;
  const r =
    avg('recovery', 7) * 0.30 +
    Math.min(avg('sleep', 8) / optimalSleep, 1) * 10 * 0.25 +
    avg('energy', 7) * 0.20 +
    avg('mood', 7) * 0.15 +
    (10 - avg('soreness', 3)) * 0.10;
  return Math.min(10, Math.round(r * 10) / 10);
}
