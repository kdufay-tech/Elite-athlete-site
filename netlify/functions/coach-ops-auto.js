// netlify/functions/coach-ops-auto.js
// Coach Ops - Automatic mode runner (Phase 3/4).
// Scheduled. When settings.mode==='auto' AND auto_send is on, it pushes
// APPROVED coach email drafts to their target folder (coach_hs / coach_college /
// coach_pro), personalized, within the daily send cap, idempotently (marketing-blast
// dedupes on blast_id via email_blasts, so re-runs never double-email anyone).
// Manual admin POST = run one cycle now. Flipping mode to 'manual' = kill switch.

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Authorization, Content-Type',
  'Content-Type': 'application/json',
};

const SUPABASE_URL = process.env.SUPABASE_URL;
const SERVICE_KEY  = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY;
const ADMIN_EMAIL  = process.env.ADMIN_EMAIL || 'kiszo@taratechent.com';
const SITE_URL     = process.env.URL || process.env.DEPLOY_PRIME_URL || 'https://elite-athlete.app';

async function sbGet(path) {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, { headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` } });
  return r.ok ? r.json() : [];
}
async function patchDraft(id, fields) {
  return fetch(`${SUPABASE_URL}/rest/v1/coach_ops_drafts?id=eq.${id}`, {
    method: 'PATCH',
    headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(fields),
  });
}
async function logRun(status, detail) {
  try {
    await fetch(`${SUPABASE_URL}/rest/v1/coach_ops_runs`, {
      method: 'POST',
      headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ run_type: 'auto_send', status, finished_at: new Date().toISOString(), detail }),
    });
  } catch (_) {}
}

export default async (req) => {
  if (req.method === 'OPTIONS') return new Response('', { status: 204, headers: CORS });
  try {
    if (!SUPABASE_URL || !SERVICE_KEY) return new Response(JSON.stringify({ error: 'Server not configured' }), { status: 500, headers: CORS });

    // Manual POST requires admin; scheduled invocation is trusted (no token).
    const token = (req.headers.get('authorization') || '').replace('Bearer ', '').trim();
    if (token) {
      const ur = await fetch(`${SUPABASE_URL}/auth/v1/user`, { headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${token}` } });
      const u = ur.ok ? await ur.json() : null;
      if (!u || u.email !== ADMIN_EMAIL) return new Response(JSON.stringify({ error: 'Admin access required' }), { status: 403, headers: CORS });
    }

    const s = (await sbGet('coach_ops_settings?id=eq.1&select=*'))[0];
    if (!s || s.mode !== 'auto' || !s.auto_send) {
      await logRun('skipped', { reason: 'mode not auto / auto_send off', mode: s?.mode });
      return new Response(JSON.stringify({ ok: true, skipped: true, reason: 'not in automatic send mode' }), { status: 200, headers: CORS });
    }

    const cap = Number(s.daily_send_cap) || 0; // 0 = unlimited
    let remaining = Infinity;
    if (cap > 0) {
      const today = new Date().toISOString().slice(0, 10) + 'T00:00:00Z';
      const cr = await fetch(`${SUPABASE_URL}/rest/v1/email_blasts?blast_id=like.auto_*&created_at=gte.${today}&select=id`, { headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}`, Prefer: 'count=exact', Range: '0-0' } });
      const range = cr.headers.get('content-range') || '';
      const sentToday = parseInt((range.split('/')[1] || '0'), 10) || 0;
      remaining = Math.max(0, cap - sentToday);
      if (remaining <= 0) {
        await logRun('capped', { cap, sentToday });
        return new Response(JSON.stringify({ ok: true, capped: true, sentToday, cap }), { status: 200, headers: CORS });
      }
    }

    const drafts = await sbGet('coach_ops_drafts?status=eq.approved&channel=eq.email&audience=in.(coach_hs,coach_college,coach_pro)&order=created_at.asc&select=*');
    const start = Date.now();
    let totalSent = 0;
    const perDraft = [];

    for (const d of drafts) {
      if (remaining <= 0 || Date.now() - start > 18000) break;
      const blastId = (d.meta && d.meta.blast_id) || ('auto_' + d.id);
      if (!(d.meta && d.meta.blast_id)) await patchDraft(d.id, { meta: { ...(d.meta || {}), blast_id: blastId } });

      const form = {
        subject: d.subject, headline: (d.meta && d.meta.headline) || d.subject || 'Elite Athlete', subheadline: '',
        bodyText: d.body, ctaText: (d.meta && d.meta.cta_text) || 'Open Elite Athlete', ctaUrl: (d.meta && d.meta.cta_url) || 'https://elite-athlete.app',
        audience: d.audience, blastId,
      };

      let sentForDraft = 0, drained = false;
      // Repeatedly call page 0 with the stable blastId; marketing-blast filters
      // already-sent addresses each time, so it advances and self-dedupes.
      while (remaining > 0 && Date.now() - start < 18000) {
        const payload = { ...form, page: 0, ...(remaining !== Infinity ? { maxSend: remaining } : {}) };
        const r = await fetch(`${SITE_URL}/.netlify/functions/marketing-blast`, {
          method: 'POST',
          headers: { 'x-internal-key': SERVICE_KEY, 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });
        const j = await r.json().catch(() => ({}));
        if (j.error) { perDraft.push({ id: d.id, audience: d.audience, error: j.error }); break; }
        const sent = j.sent || 0;
        sentForDraft += sent; totalSent += sent;
        if (remaining !== Infinity) remaining -= sent;
        if (sent === 0) { drained = true; break; } // no new recipients left for this draft
        await new Promise(res => setTimeout(res, 300));
      }
      if (drained) await patchDraft(d.id, { status: 'sent', sent_at: new Date().toISOString(), sent_result: { auto: true, sent: sentForDraft } });
      perDraft.push({ id: d.id, audience: d.audience, sent: sentForDraft, drained });
    }

    await logRun('success', { totalSent, drafts: perDraft, capRemaining: remaining === Infinity ? 'unlimited' : remaining });
    return new Response(JSON.stringify({ ok: true, totalSent, drafts: perDraft }), { status: 200, headers: CORS });
  } catch (e) {
    await logRun('error', { message: String((e && e.message) || e) });
    return new Response(JSON.stringify({ error: String((e && e.message) || e) }), { status: 500, headers: CORS });
  }
};
