// netlify/functions/welcome-email.js
// Sends a tailored, on-brand welcome the moment a new user signs up.
// Role-aware: 'coach' vs 'athlete'. Idempotent — one welcome per email, ever.
// Also persists account_type onto the user's profile.
// Auth: the new user's own bearer token (verified against Supabase auth).

const CORS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'Authorization, Content-Type', 'Content-Type': 'application/json' };
const FROM = 'Elite Athlete <support@elite-athlete.app>';
const IOS = 'https://apps.apple.com/us/app/elite-athlete-sportperformance/id6770788680';
const AND = 'https://play.google.com/store/apps/details?id=app.eliteathlete';
const WEB = 'https://elite-athlete.app';

// ── Brand shell (dark + gold), matches the marketing template ──
function shell({ headline, tagline, bodyHtml, ctaText, ctaUrl, email }) {
  const dl = `<tr><td style="padding:8px 0 4px;"><p style="margin:0 0 10px;font-size:12px;letter-spacing:2px;color:#B8962E;font-family:Arial,sans-serif;text-transform:uppercase;">Get the app</p>`
    + `<a href="${IOS}" style="display:inline-block;margin:0 8px 8px 0;background:#B8962E;color:#0D0D0D;text-decoration:none;font-size:13px;font-weight:700;padding:11px 20px;border-radius:6px;font-family:Arial,sans-serif;">App Store</a>`
    + `<a href="${AND}" style="display:inline-block;margin:0 8px 8px 0;background:#B8962E;color:#0D0D0D;text-decoration:none;font-size:13px;font-weight:700;padding:11px 20px;border-radius:6px;font-family:Arial,sans-serif;">Google Play</a>`
    + `<a href="${WEB}" style="display:inline-block;margin:0 0 8px 0;border:1px solid #B8962E;color:#B8962E;text-decoration:none;font-size:13px;font-weight:700;padding:10px 20px;border-radius:6px;font-family:Arial,sans-serif;">Web App</a></td></tr>`;
  return `<!DOCTYPE html><html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head><body style="margin:0;padding:0;background:#0D0D0D;font-family:Arial,sans-serif;"><table width="100%" cellpadding="0" cellspacing="0" style="background:#0D0D0D;padding:40px 16px;"><tr><td align="center"><table width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;"><tr><td style="background:#B8962E;height:4px;border-radius:4px 4px 0 0;"></td></tr><tr><td style="background:#111;padding:28px 40px;border-left:1px solid #B8962E22;border-right:1px solid #B8962E22;"><table width="100%" cellpadding="0" cellspacing="0"><tr><td><p style="margin:0 0 2px;font-size:10px;letter-spacing:4px;color:#B8962E;font-family:Arial,sans-serif;">ELITE ATHLETE</p><p style="margin:0;font-size:11px;color:#444;font-family:Arial,sans-serif;">ENGINEERED FOR CHAMPIONS</p></td><td align="right"><p style="margin:0;font-size:11px;color:#333;font-family:Arial,sans-serif;">elite-athlete.app</p></td></tr></table></td></tr><tr><td style="background:#B8962E;height:1px;"></td></tr><tr><td style="background:#111;padding:40px;border-left:1px solid #B8962E22;border-right:1px solid #B8962E22;"><table width="100%" cellpadding="0" cellspacing="0"><tr><td style="padding-bottom:8px;"><h1 style="margin:0;font-size:30px;font-weight:900;color:#fff;font-family:Arial,sans-serif;">${headline}</h1></td></tr><tr><td style="padding-bottom:26px;"><p style="margin:0;font-size:17px;color:#B8962E;font-weight:600;font-family:Arial,sans-serif;">${tagline}</p></td></tr><tr><td style="padding-bottom:30px;"><div style="margin:0;font-size:15px;color:#CCC;line-height:1.7;font-family:Arial,sans-serif;">${bodyHtml}</div></td></tr><tr><td align="center" style="padding-bottom:30px;"><a href="${ctaUrl}" style="display:inline-block;background:#B8962E;color:#0D0D0D;text-decoration:none;font-size:15px;font-weight:700;letter-spacing:2px;text-transform:uppercase;padding:16px 48px;border-radius:6px;font-family:Arial,sans-serif;">${ctaText}</a></td></tr>${dl}<tr><td style="border-top:1px solid #ffffff08;padding-top:22px;"><p style="margin:0;font-size:13px;color:#555;font-family:Arial,sans-serif;">Welcome aboard. Reply to this email any time — a real person reads it.</p></td></tr></table></td></tr><tr><td style="background:#0D0D0D;padding:20px 40px;border:1px solid #ffffff08;border-top:none;"><p style="margin:0;font-size:11px;color:#333;font-family:Arial,sans-serif;">ELITE ATHLETE &middot; support@elite-athlete.app &middot; elite-athlete.app</p><p style="margin:4px 0 0;font-size:11px;font-family:Arial,sans-serif;"><a href="https://elite-athlete.app/.netlify/functions/unsubscribe?email=${encodeURIComponent(email)}" style="color:#555;text-decoration:underline;">Unsubscribe</a></p></td></tr><tr><td style="background:#B8962E;height:3px;border-radius:0 0 4px 4px;"></td></tr></table></td></tr></table></body></html>`;
}

function athleteEmail(first, email) {
  const hi = first ? `You're in, ${first}.` : `You're in.`;
  const body =
    `<p style="margin:0 0 16px;">${hi}</p>` +
    `<p style="margin:0 0 16px;">At every level, talent is common. The margin is won in the hours nobody sees — recovery, readiness, and position-specific work. Most athletes guess at those. You won't.</p>` +
    `<p style="margin:0 0 10px;">Elite Athlete turns your training into data and your data into a plan:</p>` +
    `<p style="margin:0 0 16px;line-height:1.9;">` +
    `&bull; A program built for your exact sport and position.<br>` +
    `&bull; A daily readiness score — when to push, when to back off.<br>` +
    `&bull; EA Coach — your Day-1 brief, tuned to your numbers.<br>` +
    `&bull; A recruiting profile that auto-updates every PR and workout.</p>` +
    `<p style="margin:0;">Finish your profile and log one session — your first EA Coach brief lands today.</p>`;
  return { subject: `${first ? first + ', your' : 'Your'} Elite Athlete account is live`, headline: 'Welcome to Elite Athlete.', tagline: 'Train like a pro — before you go pro.', bodyHtml: body, ctaText: 'Open Elite Athlete', ctaUrl: WEB, email };
}

function coachEmail(first, email) {
  const hi = first ? `You're in, Coach ${first}.` : `You're in, Coach.`;
  const body =
    `<p style="margin:0 0 16px;">${hi}</p>` +
    `<p style="margin:0 0 16px;">Between practices, your athletes scatter — and their readiness, recovery, and off-season work go dark until camp. Their data lives on club systems, not yours. That's coaching blind in the hours that decide seasons.</p>` +
    `<p style="margin:0 0 16px;">Elite Athlete hands you the picture and hands each athlete the work. You coach; it tracks. It augments what you do — it never replaces you:</p>` +
    `<p style="margin:0 0 16px;line-height:1.9;">` +
    `&bull; One dashboard — roster readiness, compliance, and off-season at a glance.<br>` +
    `&bull; A plan built for each athlete's exact sport and position.<br>` +
    `&bull; EA Coach keeping them accountable year-round, on your standards.<br>` +
    `&bull; One-click recruiting exports when it's time to get them seen.</p>` +
    `<p style="margin:0;">Set up your roster and invite your first athletes — you'll watch readiness light up as they log.</p>`;
  return { subject: `Coach — your Elite Athlete dashboard is ready`, headline: 'Welcome, Coach.', tagline: 'Run your program from signing day to draft day.', bodyHtml: body, ctaText: 'Open your dashboard', ctaUrl: WEB, email };
}

export default async (req) => {
  if (req.method === 'OPTIONS') return new Response('', { status: 204, headers: CORS });
  if (req.method !== 'POST') return new Response(JSON.stringify({ error: 'Method not allowed' }), { status: 405, headers: CORS });

  const supabaseUrl = process.env.SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY;
  const resendKey = process.env.RESEND_API_KEY;
  if (!resendKey) return new Response(JSON.stringify({ error: 'RESEND_API_KEY not configured' }), { status: 500, headers: CORS });

  // Verify the calling user (their own token)
  const token = (req.headers.get('authorization') || '').replace('Bearer ', '').trim();
  if (!token) return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401, headers: CORS });
  const uRes = await fetch(`${supabaseUrl}/auth/v1/user`, { headers: { apikey: serviceKey, Authorization: `Bearer ${token}` } });
  if (!uRes.ok) return new Response(JSON.stringify({ error: 'Invalid session' }), { status: 401, headers: CORS });
  const user = await uRes.json();
  const email = user.email;
  if (!email) return new Response(JSON.stringify({ error: 'No email on account' }), { status: 400, headers: CORS });

  let body = {}; try { body = await req.json(); } catch { body = {}; }

  const h = { apikey: serviceKey, Authorization: `Bearer ${serviceKey}` };

  // ── Resolve role: explicit choice wins, else infer, else athlete ──
  let role = String(body.role || '').toLowerCase();
  if (role !== 'coach' && role !== 'athlete') role = '';
  if (!role) {
    try {
      const sr = await fetch(`${supabaseUrl}/rest/v1/subscriptions?user_id=eq.${user.id}&select=plan_name,stripe_customer_id`, { headers: h });
      const subs = sr.ok ? await sr.json() : [];
      if (subs.some(s => /coach/i.test(s.plan_name || '') || /coach/i.test(s.stripe_customer_id || ''))) role = 'coach';
    } catch (_) {}
  }
  if (!role) {
    try {
      const ir = await fetch(`${supabaseUrl}/rest/v1/beta_invites?email=eq.${encodeURIComponent(email)}&select=beta_type&order=created_at.desc&limit=1`, { headers: h });
      const inv = ir.ok ? await ir.json() : [];
      if (inv[0] && String(inv[0].beta_type).toLowerCase() === 'coach') role = 'coach';
    } catch (_) {}
  }
  if (!role) role = 'athlete';

  // ── Persist account_type onto the profile (upsert by user_id) ──
  try {
    const pr = await fetch(`${supabaseUrl}/rest/v1/profiles?user_id=eq.${user.id}&select=id,name`, { headers: h });
    const rows = pr.ok ? await pr.json() : [];
    if (rows[0]) {
      await fetch(`${supabaseUrl}/rest/v1/profiles?user_id=eq.${user.id}`, {
        method: 'PATCH', headers: { ...h, 'Content-Type': 'application/json', Prefer: 'return=minimal' },
        body: JSON.stringify({ account_type: role }),
      });
      body._name = rows[0].name || '';
    } else {
      await fetch(`${supabaseUrl}/rest/v1/profiles`, {
        method: 'POST', headers: { ...h, 'Content-Type': 'application/json', Prefer: 'return=minimal' },
        body: JSON.stringify({ user_id: user.id, account_type: role }),
      });
      body._name = '';
    }
  } catch (_) {}

  // ── Idempotency: one welcome per email, ever ──
  try {
    const wr = await fetch(`${supabaseUrl}/rest/v1/email_blasts?blast_id=eq.welcome&email=eq.${encodeURIComponent(email)}&select=id&limit=1`, { headers: h });
    const prev = wr.ok ? await wr.json() : [];
    if (prev.length) return new Response(JSON.stringify({ ok: true, already: true, role }), { status: 200, headers: CORS });
  } catch (_) {}

  // Greeting name: explicit override (from onboarding) else profile name. No email-prefix
  // fallback — a nameless welcome degrades to clean copy ("You're in." / "You're in, Coach.").
  const rawName = String(body.name || body._name || '').trim();
  const first = rawName ? rawName.split(/\s+/)[0].replace(/[^A-Za-z'-]/g, '') : '';

  const tmpl = role === 'coach' ? coachEmail(first, email) : athleteEmail(first, email);
  const html = shell(tmpl);

  const send = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${resendKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      from: FROM, to: email, subject: tmpl.subject, html,
      headers: { 'List-Unsubscribe': '<mailto:support@elite-athlete.app?subject=unsubscribe>', 'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click' },
    }),
  });
  const d = await send.json().catch(() => ({}));
  if (!send.ok) return new Response(JSON.stringify({ ok: false, role, error: d.message || 'Send failed' }), { status: 200, headers: CORS });

  // Record so it never double-sends
  await fetch(`${supabaseUrl}/rest/v1/email_blasts`, {
    method: 'POST', headers: { ...h, 'Content-Type': 'application/json', Prefer: 'resolution=ignore-duplicates' },
    body: JSON.stringify({ blast_id: 'welcome', email, subject: tmpl.subject }),
  }).catch(() => {});

  return new Response(JSON.stringify({ ok: true, role, sent: true }), { status: 200, headers: CORS });
};
