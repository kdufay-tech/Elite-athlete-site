// netlify/functions/coach-ops-weekly.js
// Coach Ops - Phase 1: read-only Weekly Growth Digest.
// Runs on schedule (Mon 13:00 UTC via netlify.toml) and on manual admin POST.
// Pulls KPIs from Supabase, asks Claude for a prioritized digest (cite-the-KPI,
// brand voice, no medical claims, no under-13 targeting), writes a kpi_snapshots
// row + a coach_ops_runs audit row, and emails the digest to the admin via Resend.
// SENDS NOTHING TO USERS. DRAFTS NOTHING OUTBOUND. Read-only reporting only.
//
// Hardened: the ENTIRE handler is wrapped so it always returns JSON (never an
// empty body), DB reads run in parallel, and the Claude call has a hard timeout.

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Authorization, Content-Type',
  'Content-Type': 'application/json',
};

const SUPABASE_URL  = process.env.SUPABASE_URL;
const SERVICE_KEY   = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY;
const ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY;
const RESEND_KEY    = process.env.RESEND_API_KEY;
const ADMIN_EMAIL   = process.env.ADMIN_EMAIL || 'kiszo@taratechent.com';

const PLAN_MRR = {
  athlete_monthly: 29,  athlete_annual: 199 / 12,
  elite_monthly:   69,  elite_annual:   529 / 12,
  coach_monthly:   99,  coach_annual:   899 / 12,
};
function planKey(plan, interval) {
  const p = (plan || '').toLowerCase();
  const annual = interval === 'year' || p.includes('annual');
  const tier = p.includes('coach') ? 'coach' : p.includes('athlete') ? 'athlete' : 'elite';
  return `${tier}_${annual ? 'annual' : 'monthly'}`;
}

const TARGETS = { paidSubs_M3: 5000, mrr_M3: 75000, paidSubs_M6: 20000, mrr_M6: 316600 };

async function sb(path) {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` },
  });
  if (!r.ok) return [];
  return r.json();
}

async function gatherMetrics() {
  // Parallel reads to stay well under the 26s function limit.
  const [subs, invites, waitlist, feedback] = await Promise.all([
    sb('subscriptions?status=eq.active&select=plan_name,billing_interval,beta_expires_at,created_at&limit=10000'),
    sb('beta_invites?select=status&limit=10000'),
    sb('coach_waitlist?select=id&limit=10000'),
    sb('beta_feedback?select=rating&limit=10000'),
  ]);

  const paid = subs.filter(s => (s.plan_name || '').toLowerCase() !== 'beta_elite');
  const beta = subs.filter(s => (s.plan_name || '').toLowerCase() === 'beta_elite');
  const betaExpired = beta.filter(s => s.beta_expires_at && new Date(s.beta_expires_at) < new Date()).length;

  let mrr = 0, monthly = 0, annual = 0;
  for (const s of paid) {
    mrr += PLAN_MRR[planKey(s.plan_name, s.billing_interval)] || 0;
    s.billing_interval === 'year' ? annual++ : monthly++;
  }

  const invitesPending  = invites.filter(i => i.status === 'pending' || i.status === 'sent').length;
  const invitesAccepted = invites.filter(i => i.status === 'accepted').length;
  const ratings   = feedback.map(f => f.rating).filter(Boolean);
  const avgRating = ratings.length ? ratings.reduce((a, b) => a + b, 0) / ratings.length : null;

  const weekAgo = new Date(Date.now() - 7 * 86400000).toISOString();
  const newPaidThisWeek = paid.filter(s => s.created_at && s.created_at >= weekAgo).length;

  return {
    paidSubscribers: paid.length, monthly, annual, mrr: Math.round(mrr),
    betaUsers: beta.length, betaActive: beta.length - betaExpired, betaExpired,
    invitesPending, invitesAccepted,
    inviteAcceptRate: invites.length ? Math.round((invitesAccepted / invites.length) * 100) : 0,
    waitlist: waitlist.length,
    feedbackCount: feedback.length, avgRating: avgRating ? Number(avgRating.toFixed(2)) : null,
    newPaidThisWeek,
  };
}

function mondayUTC() {
  const d = new Date();
  const day = d.getUTCDay();
  const diff = day === 0 ? -6 : 1 - day;
  const m = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + diff));
  return m.toISOString().slice(0, 10);
}

const SYSTEM_PROMPT = `You are Coach Ops, the growth analyst for Elite Athlete - a sport- and position-specific training, nutrition, recovery, and AI-coaching app, live on iOS, Android and web.
Voice: the confidence of a great coach with the credibility of a sports scientist - direct, evidence-based, no fluff.
Rules:
- Cite the specific KPI/number behind every observation and recommendation.
- Recommend at most 3 actions, ranked by expected impact this week. Be concrete and specific to this app.
- No medical claims. Never suggest targeting or collecting data from anyone under 13.
- This is a READ-ONLY weekly report: do NOT draft or send anything to users; only analyze and recommend.
Output a tight plain-text digest (no markdown headers), ~200-300 words, in this order: (1) one-line state of the business, (2) what moved week-over-week, (3) your single highest-impact lever this week and why, (4) up to two secondary recommendations.`;

async function callClaude(metrics, prev) {
  const user = `This week's KPIs (Elite Athlete):
${JSON.stringify(metrics, null, 2)}

Last snapshot for week-over-week comparison:
${prev ? JSON.stringify(prev, null, 2) : 'none yet (first run - no prior week)'}

Milestone targets for context: Month-3 paid subscribers ${TARGETS.paidSubs_M3}, Month-3 MRR $${TARGETS.mrr_M3}; Month-6 paid ${TARGETS.paidSubs_M6}, MRR $${TARGETS.mrr_M6}.

Write this week's growth digest.`;

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 20000);
  try {
    const r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': ANTHROPIC_KEY, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 1024,
        system: SYSTEM_PROMPT,
        messages: [{ role: 'user', content: user }],
      }),
      signal: controller.signal,
    });
    const d = await r.json();
    if (!r.ok) throw new Error(d.error?.message || `Anthropic ${r.status}`);
    return d.content?.[0]?.text || '';
  } catch (e) {
    if (e.name === 'AbortError') throw new Error('AI request timed out (Anthropic slow). Try again.');
    throw e;
  } finally {
    clearTimeout(timeoutId);
  }
}

function digestEmailHtml(weekStart, m, digest) {
  const row = (k, v) => `<tr><td style="padding:4px 12px;color:#888;font-size:13px;">${k}</td><td style="padding:4px 12px;color:#fff;font-size:13px;font-weight:600;text-align:right;">${v}</td></tr>`;
  const safe = String(digest).replace(/</g, '&lt;');
  return `<!DOCTYPE html><html><body style="margin:0;background:#0D0D0D;font-family:Arial,sans-serif;padding:32px 16px;"><table width="600" align="center" cellpadding="0" cellspacing="0" style="max-width:600px;margin:0 auto;"><tr><td style="background:#B8962E;height:4px;border-radius:4px 4px 0 0;"></td></tr><tr><td style="background:#111;padding:28px 32px;border-left:1px solid #B8962E22;border-right:1px solid #B8962E22;"><p style="margin:0 0 2px;font-size:10px;letter-spacing:4px;color:#B8962E;">COACH OPS &middot; WEEKLY GROWTH DIGEST</p><p style="margin:0;font-size:20px;font-weight:900;color:#fff;">Week of ${weekStart}</p><div style="margin:20px 0;padding:16px;background:#0D0D0D;border-radius:8px;color:#ccc;font-size:14px;line-height:1.7;white-space:pre-line;">${safe}</div><table width="100%" cellpadding="0" cellspacing="0" style="border-top:1px solid #ffffff10;margin-top:8px;">${row('Paid subscribers', m.paidSubscribers)}${row('MRR', '$' + m.mrr.toLocaleString())}${row('New paid this week', m.newPaidThisWeek)}${row('Beta active / expired', m.betaActive + ' / ' + m.betaExpired)}${row('Invites accepted', m.invitesAccepted + ' (' + m.inviteAcceptRate + '%)')}${row('Waitlist', m.waitlist)}${row('Avg feedback', m.avgRating ?? '-')}</table></td></tr><tr><td style="background:#0D0D0D;padding:16px 32px;border:1px solid #ffffff08;border-top:none;"><p style="margin:0;font-size:11px;color:#444;">Coach Ops &middot; read-only weekly report &middot; Elite Athlete</p></td></tr><tr><td style="background:#B8962E;height:3px;border-radius:0 0 4px 4px;"></td></tr></table></body></html>`;
}

async function post(table, bodyObj) {
  return fetch(`${SUPABASE_URL}/rest/v1/${table}`, {
    method: 'POST',
    headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}`, 'Content-Type': 'application/json', Prefer: 'return=minimal' },
    body: JSON.stringify(bodyObj),
  });
}

async function runCycle() {
  const started = new Date().toISOString();
  const weekStart = mondayUTC();
  const [metrics, prevRows] = await Promise.all([
    gatherMetrics(),
    sb('kpi_snapshots?select=metrics,week_start&order=week_start.desc&limit=1'),
  ]);
  const prev = prevRows[0]?.metrics || null;
  const digest = await callClaude(metrics, prev);

  await post('kpi_snapshots', { week_start: weekStart, metrics, digest });

  let emailStatus = 'skipped_no_resend_key';
  if (RESEND_KEY) {
    try {
      const r = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: { Authorization: `Bearer ${RESEND_KEY}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          from: 'Elite Athlete Coach Ops <support@elite-athlete.app>',
          to: ADMIN_EMAIL,
          subject: `Coach Ops - Weekly Growth Digest (${weekStart})`,
          html: digestEmailHtml(weekStart, metrics, digest),
        }),
      });
      emailStatus = r.ok ? 'sent' : `error_${r.status}`;
    } catch (e) { emailStatus = 'error_exception'; }
  }

  await post('coach_ops_runs', {
    run_type: 'weekly', status: 'success',
    started_at: started, finished_at: new Date().toISOString(),
    detail: { weekStart, emailStatus, metrics },
  });

  return { ok: true, weekStart, emailStatus, metrics, digest };
}

export default async (req) => {
  if (req.method === 'OPTIONS') return new Response('', { status: 204, headers: CORS });

  // Everything wrapped so the client ALWAYS receives JSON, never an empty body.
  try {
    if (!SUPABASE_URL || !SERVICE_KEY || !ANTHROPIC_KEY) {
      return new Response(JSON.stringify({ error: 'Missing env: SUPABASE_URL / service key / ANTHROPIC_API_KEY' }), { status: 500, headers: CORS });
    }

    // Manual trigger from the admin panel requires an admin token.
    // Scheduled invocations from Netlify carry no Authorization header and run trusted.
    const auth = (req.headers.get('authorization') || '').replace('Bearer ', '').trim();
    if (req.method === 'POST' && auth) {
      const ur = await fetch(`${SUPABASE_URL}/auth/v1/user`, { headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${auth}` } });
      const u = ur.ok ? await ur.json() : null;
      if (u?.email !== ADMIN_EMAIL) {
        return new Response(JSON.stringify({ error: 'Admin access required' }), { status: 403, headers: CORS });
      }
    }

    const result = await runCycle();
    return new Response(JSON.stringify(result), { status: 200, headers: CORS });
  } catch (e) {
    const msg = String((e && e.message) || e);
    try {
      await post('coach_ops_runs', { run_type: 'weekly', status: 'error', finished_at: new Date().toISOString(), detail: { error: msg } });
    } catch (_) {}
    return new Response(JSON.stringify({ error: msg }), { status: 500, headers: CORS });
  }
};
