// netlify/functions/send-beta-invite.js
// Admin-only: generates a signed invite token, stores it in Supabase,
// and sends an invite email via EmailJS REST API.
// Supports single email or bulk array + outreach template selection.

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Authorization, Content-Type',
  'Content-Type': 'application/json',
};

function generateToken() {
  const arr = new Uint8Array(24);
  crypto.getRandomValues(arr);
  return Array.from(arr, b => b.toString(16).padStart(2,'0')).join('');
}

function buildEmailContent(betaType, daysLeft, inviteUrl, template) {
  const typeLabel = betaType === 'coach' ? 'Coach' : 'Athlete';

  const templates = {
    generic: {
      subject: `You're invited to join Elite Athlete Beta — ${daysLeft} days free`,
      message:
        `You've been personally invited to join the Elite Athlete Beta Program.\n\n` +
        `ACCESS TYPE: ${typeLabel} Beta\n` +
        `FREE ACCESS: ${daysLeft} days — full Elite features, no credit card\n\n` +
        `Click below to accept your invite and create your account:\n\n` +
        `${inviteUrl}\n\n` +
        `This link is unique to you. Your ${daysLeft}-day beta access activates automatically on signup.\n\n` +
        `What you get:\n` +
        `  * Position-specific nutrition & meal plans\n` +
        `  * Elite workout programming for your sport\n` +
        `  * AI Coach powered by Claude\n` +
        `  * Injury recovery protocols\n` +
        `  * Progress tracking & reporting\n\n` +
        `Questions? Reply to this email.\n\n` +
        `— The Elite Athlete Team\n` +
        `https://elite-athlete.app`,
    },

    coach_college: {
      subject: `Free Elite Athlete accounts for your entire roster — no credit card`,
      message:
        `Hi Coach,\n\n` +
        `I'll keep this short because I know your schedule.\n\n` +
        `We built Elite Athlete for exactly the athletes you're developing — position-specific strength programs, ` +
        `nutrition plans calibrated to each player's goals, injury recovery protocols by sport and position, ` +
        `and daily AI coaching briefs.\n\n` +
        `What makes it different: a defensive end gets a completely different meal plan and program than a wide receiver. ` +
        `Every position. Every sport.\n\n` +
        `What we're offering your program:\n` +
        `  * Free Elite account for you (normally $69/month)\n` +
        `  * Free ${daysLeft}-day access for your full roster — no credit card\n` +
        `  * Full AI Coach, nutrition, injury recovery, and progress tracking\n\n` +
        `Click below to accept your complimentary coach access:\n\n` +
        `${inviteUrl}\n\n` +
        `Your access activates the moment you sign up. Just reply with your roster size and I'll set up bulk access for your athletes within 24 hours.\n\n` +
        `— The Elite Athlete Team\n` +
        `https://elite-athlete.app`,
    },

    coach_pro: {
      subject: `Complimentary Elite Athlete access for your performance team + roster`,
      message:
        `Hi,\n\n` +
        `Quick note — we've built a platform specifically designed for the athletes you work with every day.\n\n` +
        `Elite Athlete generates position-specific nutrition plans, strength programs, injury recovery protocols, ` +
        `and AI coaching briefs for every sport and position. Not generic fitness content — actual position-level personalization.\n\n` +
        `We'd like to offer you and your roster complimentary ${daysLeft}-day access. No cost, no pitch, no commitment.\n\n` +
        `Accept your access here:\n\n` +
        `${inviteUrl}\n\n` +
        `We're confident the product speaks for itself. If you'd like to set up accounts for your full roster after trying it, just reply.\n\n` +
        `— The Elite Athlete Team\n` +
        `https://elite-athlete.app`,
    },

    athlete_mfp: {
      subject: `Your position deserves better than MyFitnessPal — ${daysLeft} days free`,
      message:
        `Hey,\n\n` +
        `MyFitnessPal gives every athlete the same generic calorie plan. A defensive end and a marathon runner ` +
        `get identical macro targets. That's not how elite performance works.\n\n` +
        `Elite Athlete generates a meal plan, training program, and recovery protocol built specifically for ` +
        `your sport and position — not a one-size-fits-all template.\n\n` +
        `You've been invited to try it free for ${daysLeft} days:\n\n` +
        `${inviteUrl}\n\n` +
        `What you get that MFP doesn't offer:\n` +
        `  * Position-specific meal plans (not generic macros)\n` +
        `  * AI Coach that knows your sport and position\n` +
        `  * Injury recovery protocols for your position's common injuries\n` +
        `  * 16-week periodized training programs\n\n` +
        `No credit card. Full Elite access for ${daysLeft} days.\n\n` +
        `— The Elite Athlete Team\n` +
        `https://elite-athlete.app`,
    },

    athlete_strava: {
      subject: `Strava records your miles. We design your season. ${daysLeft} days free`,
      message:
        `Hey,\n\n` +
        `Strava and TrainingPeaks were built for runners and triathletes. If you play a team sport, ` +
        `they can track your miles — but they can't build your game.\n\n` +
        `Elite Athlete is the first platform built specifically for team sport athletes. ` +
        `Enter your sport and position and you get a complete system: meal plans, training programs, ` +
        `injury recovery, and an AI Coach that knows the demands of your exact position.\n\n` +
        `You've been invited to try it free for ${daysLeft} days:\n\n` +
        `${inviteUrl}\n\n` +
        `No GPS needed. No endurance metrics. Just position-specific performance.\n\n` +
        `No credit card. Full Elite access for ${daysLeft} days.\n\n` +
        `— The Elite Athlete Team\n` +
        `https://elite-athlete.app`,
    },
  };

  return templates[template] || templates.generic;
}

async function sendInviteEmail({ toEmail, betaType, token, daysLeft, appUrl, template,
  emailjsServiceId, emailjsTemplateId, emailjsPrivateKey, emailjsPublicKey }) {

  const inviteUrl = `${appUrl}?invite=${token}`;
  const { subject, message } = buildEmailContent(betaType, daysLeft, inviteUrl, template);

  const res = await fetch('https://api.emailjs.com/api/v1.0/email/send', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      service_id:  emailjsServiceId,
      template_id: emailjsTemplateId,
      user_id:     emailjsPublicKey,
      accessToken: emailjsPrivateKey,
      template_params: {
        to_email:  toEmail,
        from_name: 'Elite Athlete',
        subject,
        message,
        reply_to:  'support@elite-athlete.app',
      },
    }),
  });
  const responseText = await res.text();
  return { ok: res.ok, status: res.status, body: responseText };
}

export default async (req) => {
  if (req.method === 'OPTIONS') return new Response('', { status: 200, headers: CORS });
  if (req.method !== 'POST') return new Response('Method Not Allowed', { status: 405, headers: CORS });

  const authHeader = req.headers.get('authorization') || '';
  if (!authHeader.startsWith('Bearer '))
    return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401, headers: CORS });

  const token             = authHeader.replace('Bearer ', '');
  const ADMIN_EMAIL       = process.env.ADMIN_EMAIL;
  const supabaseUrl       = process.env.SUPABASE_URL;
  const serviceKey        = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY||process.env.SUPABASE_SERVICE_KEY;
  const emailjsServiceId  = process.env.EMAILJS_SERVICE_ID  || process.env.VITE_EMAILJS_SERVICE_ID;
  const emailjsTemplateId = process.env.EMAILJS_TEMPLATE_ID || process.env.VITE_EMAILJS_TEMPLATE_ID;
  const emailjsPublicKey  = process.env.EMAILJS_PUBLIC_KEY  || process.env.VITE_EMAILJS_PUBLIC_KEY;
  const emailjsPrivateKey = process.env.EMAILJS_PRIVATE_KEY;
  const appUrl            = process.env.APP_URL || 'https://elite-athlete.app';

  if (!emailjsServiceId || !emailjsTemplateId || !emailjsPublicKey) {
    return new Response(JSON.stringify({ error: `EmailJS not configured — missing env vars. ServiceID: ${!!emailjsServiceId}, TemplateID: ${!!emailjsTemplateId}, Key: ${!!emailjsPublicKey}` }), { status: 500, headers: CORS });
  }

  // Verify admin
  const userRes = await fetch(`${supabaseUrl}/auth/v1/user`, {
    headers: { apikey: serviceKey, Authorization: `Bearer ${token}` },
  });
  if (!userRes.ok) return new Response(JSON.stringify({ error: 'Invalid token' }), { status: 401, headers: CORS });
  const caller = await userRes.json();
  if (caller.email !== ADMIN_EMAIL)
    return new Response(JSON.stringify({ error: 'Forbidden' }), { status: 403, headers: CORS });

  const body      = await req.json();
  const rawEmails = Array.isArray(body.emails) ? body.emails : [body.email];
  const betaType  = body.beta_type || 'athlete';
  const template  = body.template  || 'generic';
  const days      = body.duration_days ? parseInt(body.duration_days) : betaType === 'coach' ? 45 : 30;
  const expiresAt = new Date(Date.now() + days * 24 * 60 * 60 * 1000).toISOString();

  const emails = [...new Set(
    rawEmails.map(e => (e || '').trim().toLowerCase())
             .filter(e => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e))
  )];

  if (!emails.length)
    return new Response(JSON.stringify({ error: 'No valid emails provided' }), { status: 400, headers: CORS });

  // Process one email: check, delete old, insert, send
  async function processOne(email) {
    try {
      const existingRes = await fetch(
        `${supabaseUrl}/rest/v1/beta_invites?email=eq.${encodeURIComponent(email)}&status=eq.accepted`,
        { headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}` } }
      );
      const existing = existingRes.ok ? await existingRes.json() : [];
      if (existing.length > 0) return { email, ok: false, msg: 'Already accepted beta access' };

      await fetch(
        `${supabaseUrl}/rest/v1/beta_invites?email=eq.${encodeURIComponent(email)}&status=neq.accepted`,
        { method: 'DELETE', headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}` } }
      );

      const inviteToken = generateToken();
      const insertRes = await fetch(`${supabaseUrl}/rest/v1/beta_invites`, {
        method: 'POST',
        headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}`,
          'Content-Type': 'application/json', Prefer: 'return=minimal' },
        body: JSON.stringify({
          email, beta_type: betaType, token: inviteToken, template,
          duration_days: days, status: 'pending',
          expires_at: expiresAt, created_at: new Date().toISOString(),
        }),
      });
      if (!insertRes.ok) {
        const err = await insertRes.text();
        return { email, ok: false, msg: `DB error: ${err}` };
      }

      const emailResult = await sendInviteEmail({
        toEmail: email, betaType, token: inviteToken, daysLeft: days,
        appUrl, template, emailjsServiceId, emailjsTemplateId,
        emailjsPrivateKey, emailjsPublicKey,
      });

      if (emailResult.ok) {
        await fetch(`${supabaseUrl}/rest/v1/beta_invites?token=eq.${inviteToken}`, {
          method: 'PATCH',
          headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ status: 'sent', sent_at: new Date().toISOString() }),
        });
        return { email, ok: true, msg: `Invite sent (${days} days) [${template}]` };
      } else {
        return { email, ok: false, msg: `Email failed (${emailResult.status}): ${emailResult.body}` };
      }
    } catch(err) {
      return { email, ok: false, msg: err.message };
    }
  }

  // Run in parallel batches of 5 to stay within timeout
  const BATCH = 5;
  const results = [];
  for (let i = 0; i < emails.length; i += BATCH) {
    const batch = emails.slice(i, i + BATCH);
    const batchResults = await Promise.all(batch.map(processOne));
    results.push(...batchResults);
  }

  const sent   = results.filter(r => r.ok).length;
  const failed = results.filter(r => !r.ok).length;

  return new Response(JSON.stringify({
    ok: sent > 0,
    message: `${sent} invite${sent!==1?'s':''} sent · ${failed} failed`,
    results,
  }), { status: 200, headers: CORS });
};
