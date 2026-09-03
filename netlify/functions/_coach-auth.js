// netlify/functions/_coach-auth.js
// Shared helpers for the coach roster endpoints.
// Same env var names + JWT-verify pattern as admin-data.js / coach.js.

export const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Authorization, Content-Type',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
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

// Unambiguous join codes — no O/0, I/1.
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
export function makeJoinCode(len = 6) {
  let out = '';
  const bytes = new Uint8Array(len);
  crypto.getRandomValues(bytes);
  for (let i = 0; i < len; i++) out += CODE_ALPHABET[bytes[i] % CODE_ALPHABET.length];
  return out;
}

// Canonical readiness formula — mirrors src/App.jsx (Game-Day Readiness).
// rows = that athlete's check_ins, newest first.
export function computeReadiness(rows, sport) {
  if (!rows || rows.length === 0) return null;
  const win = rows.slice(0, 3);
  const avg = (k, d) =>
    win.reduce((a, r) => a + (Number(r[k]) || d), 0) / win.length;
  const optimalSleep = sport === 'football' || sport === 'basketball' ? 9 : 8;
  const recovery = avg('recovery', 7);
  const sleep = avg('sleep', 8);
  const energy = avg('energy', 7);
  const mood = avg('mood', 7);
  const soreness = avg('soreness', 3);
  const r =
    recovery * 0.30 +
    Math.min(sleep / optimalSleep, 1) * 10 * 0.25 +
    energy * 0.20 +
    mood * 0.15 +
    (10 - soreness) * 0.10;
  return Math.min(10, Math.round(r * 10) / 10);
}
