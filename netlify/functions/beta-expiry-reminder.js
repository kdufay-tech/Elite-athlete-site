// netlify/functions/beta-expiry-reminder.js
// Runs daily via Netlify scheduled functions.
// Sends expiry reminder emails at 7, 3, and 0 days before beta expires.
// Tracks sent reminders to avoid duplicates.

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Authorization, Content-Type',
  'Content-Type': 'application/json',
};

const RESEND_API_KEY = process.env.RESEND_API_KEY;
const supabaseUrl    = process.env.SUPABASE_URL;
const serviceKey     = process.env.SUPABASE_SERVICE_ROLE_KEY;
const FROM_EMAIL     = 'kiszo@elite-athlete.app';
const FROM_NAME      = 'Elite Athlete';

function buildReminderEmail(email, daysLeft, planName) {
  const isExpired = daysLeft <= 0;
  const plan = planName || 'beta_elite';
  const isCoach = plan.includes('coach');

  if (isExpired) {
    return {
      subject: `Your Elite Athlete beta access has ended — lock in 50% off today`,
      html: `
        <div style="font-family:sans-serif;max-width:560px;margin:0 auto;background:#0D0C0A;color:#fff;padding:40px 32px;border-radius:12px;">
          <div style="color:#C9A227;font-size:11px;letter-spacing:3px;text-transform:uppercase;margin-bottom:8px;">ELITE ATHLETE</div>
          <h2 style="color:#fff;font-size:22px;margin:0 0 16px;">Your beta access has ended.</h2>
          <p style="color:#aaa;line-height:1.7;">You've had full ${isCoach?'Coach Pro':'Elite'} access during the beta. As a founding member, you get <strong style="color:#C9A227;">50% off your first year</strong> — locked in as long as you stay subscribed.</p>
          <div style="background:#1a1a1a;border-radius:8px;padding:20px;margin:24px 0;text-align:center;">
            <div style="text-decoration:line-through;color:#555;font-size:14px;">$529/yr</div>
            <div style="color:#C9A227;font-size:32px;font-weight:700;">$264.50</div>
            <div style="color:#555;font-size:12px;">first year · then $529/yr · cancel anytime</div>
          </div>
          <a href="https://elite-athlete.app" style="display:block;background:#C9A227;color:#000;text-align:center;padding:14px 24px;border-radius:6px;text-decoration:none;font-weight:700;font-size:14px;letter-spacing:2px;text-transform:uppercase;">UPGRADE NOW — 50% OFF</a>
          <p style="color:#444;font-size:11px;margin-top:24px;text-align:center;">Code XJeqHLLx auto-applied at checkout · Elite Athlete · elite-athlete.app</p>
        </div>`,
    };
  }

  if (daysLeft <= 3) {
    return {
      subject: `${daysLeft} day${daysLeft===1?'':'s'} left on your Elite Athlete beta — don't lose your 50% discount`,
      html: `
        <div style="font-family:sans-serif;max-width:560px;margin:0 auto;background:#0D0C0A;color:#fff;padding:40px 32px;border-radius:12px;">
          <div style="color:#C9A227;font-size:11px;letter-spacing:3px;text-transform:uppercase;margin-bottom:8px;">ELITE ATHLETE</div>
          <h2 style="color:#fff;font-size:22px;margin:0 0 16px;">Only ${daysLeft} day${daysLeft===1?'':'s'} left.</h2>
          <p style="color:#aaa;line-height:1.7;">Your beta access expires soon. Upgrade now to keep your position-specific meal plans, training programs, AI Coach, and everything else — without interruption.</p>
          <p style="color:#aaa;line-height:1.7;">As a founding member, your <strong style="color:#C9A227;">50% discount is waiting</strong>. This offer expires when your beta does.</p>
          <div style="background:#1a1a1a;border-radius:8px;padding:20px;margin:24px 0;text-align:center;">
            <div style="text-decoration:line-through;color:#555;font-size:14px;">$529/yr</div>
            <div style="color:#C9A227;font-size:32px;font-weight:700;">$264.50</div>
            <div style="color:#555;font-size:12px;">first year · then $529/yr · cancel anytime</div>
          </div>
          <a href="https://elite-athlete.app" style="display:block;background:#C9A227;color:#000;text-align:center;padding:14px 24px;border-radius:6px;text-decoration:none;font-weight:700;font-size:14px;letter-spacing:2px;text-transform:uppercase;">LOCK IN 50% OFF NOW</a>
          <p style="color:#444;font-size:11px;margin-top:24px;text-align:center;">Code XJeqHLLx auto-applied at checkout · Elite Athlete · elite-athlete.app</p>
        </div>`,
    };
  }

  // 7 days
  return {
    subject: `7 days left on your Elite Athlete beta — here's your founder discount`,
    html: `
      <div style="font-family:sans-serif;max-width:560px;margin:0 auto;background:#0D0C0A;color:#fff;padding:40px 32px;border-radius:12px;">
        <div style="color:#C9A227;font-size:11px;letter-spacing:3px;text-transform:uppercase;margin-bottom:8px;">ELITE ATHLETE</div>
        <h2 style="color:#fff;font-size:22px;margin:0 0 16px;">Your beta has 7 days left.</h2>
        <p style="color:#aaa;line-height:1.7;">You've been with us from the beginning. As a founding member, we want to make sure you keep everything — your meal plans, training programs, AI Coach, and progress history — without missing a beat.</p>
        <p style="color:#aaa;line-height:1.7;">Upgrade before your beta ends and lock in <strong style="color:#C9A227;">50% off your first year</strong>.</p>
        <div style="background:#1a1a1a;border-radius:8px;padding:20px;margin:24px 0;text-align:center;">
          <div style="text-decoration:line-through;color:#555;font-size:14px;">$529/yr</div>
          <div style="color:#C9A227;font-size:32px;font-weight:700;">$264.50</div>
          <div style="color:#555;font-size:12px;">first year · then $529/yr · cancel anytime</div>
        </div>
        <a href="https://elite-athlete.app" style="display:block;background:#C9A227;color:#000;text-align:center;padding:14px 24px;border-radius:6px;text-decoration:none;font-weight:700;font-size:14px;letter-spacing:2px;text-transform:uppercase;">UPGRADE — 50% OFF</a>
        <p style="color:#555;font-size:12px;margin-top:20px;line-height:1.6;">No pressure — you still have 7 days. But the 50% founder discount is only available while you're a beta member.</p>
        <p style="color:#444;font-size:11px;margin-top:16px;text-align:center;">Code XJeqHLLx auto-applied at checkout · Elite Athlete · elite-athlete.app</p>
      </div>`,
  };
}

async function sendEmail(to, subject, html) {
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${RESEND_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from: `${FROM_NAME} <${FROM_EMAIL}>`, to, subject, html }),
  });
  return res.ok;
}

async function supabaseFetch(path, opts = {}) {
  const res = await fetch(`${supabaseUrl}/rest/v1/${path}`, {
    ...opts,
    headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}`, 'Content-Type': 'application/json', Prefer: 'return=representation', ...(opts.headers||{}) },
  });
  if (!res.ok) throw new Error(`Supabase ${path}: ${await res.text()}`);
  return res.json();
}

export default async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });

  try {
    const now = new Date();

    // Get all active beta subscriptions with expiry dates
    const subs = await supabaseFetch(
      `subscriptions?status=eq.active&beta_expires_at=not.is.null&select=id,user_id,plan_name,beta_expires_at,reminder_7_sent,reminder_3_sent,reminder_0_sent`
    );

    const results = { sent: [], skipped: [], errors: [] };

    for (const sub of subs) {
      const expiry = new Date(sub.beta_expires_at);
      const daysLeft = Math.ceil((expiry - now) / (1000 * 60 * 60 * 24));

      // Determine which reminder to send
      let reminderKey = null;
      if (daysLeft <= 0 && !sub.reminder_0_sent)  reminderKey = 'reminder_0_sent';
      else if (daysLeft <= 3 && daysLeft > 0 && !sub.reminder_3_sent) reminderKey = 'reminder_3_sent';
      else if (daysLeft <= 7 && daysLeft > 3 && !sub.reminder_7_sent) reminderKey = 'reminder_7_sent';

      if (!reminderKey) { results.skipped.push(sub.user_id); continue; }

      // Get user email
      const users = await supabaseFetch(`auth_users_view?id=eq.${sub.user_id}&select=email`).catch(() => null);
      const email = users?.[0]?.email;
      if (!email) { results.errors.push({ id: sub.user_id, reason: 'no email' }); continue; }

      // Build and send email
      const { subject, html } = buildReminderEmail(email, daysLeft, sub.plan_name);
      const sent = await sendEmail(email, subject, html);

      if (sent) {
        // Mark reminder as sent
        await supabaseFetch(`subscriptions?id=eq.${sub.id}`, {
          method: 'PATCH',
          body: JSON.stringify({ [reminderKey]: true, updated_at: now.toISOString() }),
        });
        results.sent.push({ email, daysLeft, reminderKey });
      } else {
        results.errors.push({ email, reason: 'send failed' });
      }
    }

    return new Response(JSON.stringify({ ok: true, ...results }), { status: 200, headers: CORS });

  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), { status: 500, headers: CORS });
  }
};
