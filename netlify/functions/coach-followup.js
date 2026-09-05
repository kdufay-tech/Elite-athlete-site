// netlify/functions/coach-followup.js
// Sport-tailored 3/5/7-day follow-up sequence for coach marketing tranches.
// Scheduled daily 23:00 UTC (~7pm ET). Also supports manual POST trigger.
//
// For each step N in {3,5,7}: find coaches who were sent an original marketing
// blast (blast_id like 'blast_%') exactly N days ago and have NOT:
//   - genuinely engaged — opened/clicked >5 min after delivery (human_engaged view;
//     excludes security-scanner auto-opens that fire within seconds),
//   - unsubscribed / bounced / complained (suppression list),
//   - signed up (welcome marker),
//   - already received this step's follow-up.
// Anchored to the original send; each step deduped by its own marker
// (blast_id = 'followup_d3' | 'followup_d5' | 'followup_d7').
//
// Copy is tailored per sport (football / basketball / soccer / volleyball) and
// escalates across steps: bump -> concrete value -> polite last-call.
//
// Manual: POST { step?: 3|5|7, dry_run?: true } — dry_run reports candidate
// counts per step without sending.

const CORS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'Authorization, Content-Type', 'Content-Type': 'application/json' };

const POSTAL_ADDRESS = 'Taradome Technologies · 1366 Athens Ave SW, Atlanta, GA 30310';
const STEPS = [3, 5, 7];

// ---- Sport-tailored copy. Index 0=Day3, 1=Day5, 2=Day7. ----
const SPORT_COPY = {
  football: [
    { subject: 'Re: your edge rusher vs. your slot receiver',
      body: `Coach {{FIRST_NAME}}, did my note reach you?\n\nQuick recap: your edge rusher and your slot receiver should not be running the same program. Elite Athlete builds every athlete's nutrition and training around their exact position — free for all of {{SCHOOL}} this preseason.`,
      cta: 'Reply to Set Up {{SCHOOL}}' },
    { subject: 'One number for {{SCHOOL}}',
      body: `Coach {{FIRST_NAME}}, one number worth 30 seconds:\n\nA 250-lb defensive lineman and a 175-lb corner can need a 1,500-calorie daily gap just to perform — and completely different recovery. Generic plans miss that. Elite Athlete gives every position its own fuel, training, and recovery targets, plus an EA Coach in each athlete's pocket.\n\nWant me to get {{SCHOOL}} set up?`,
      cta: 'Reply to Get Started' },
    { subject: 'Last note for {{SCHOOL}} this season',
      body: `Coach {{FIRST_NAME}}, last note from me — I don't want to crowd your inbox during camp.\n\nIf position-specific training for {{SCHOOL}} is worth a look, just reply and I'll get it set up free this preseason. If not, no worries at all — good luck this season.`,
      cta: 'Just Reply' },
  ],
  basketball: [
    { subject: 'Re: your point guard vs. your center',
      body: `Coach {{FIRST_NAME}}, did this reach you?\n\nYour point guard and your center have completely different engines. Elite Athlete programs nutrition and training by position, not one-size-fits-all — free for {{SCHOOL}} this season.`,
      cta: 'Reply to Set Up {{SCHOOL}}' },
    { subject: 'One number for {{SCHOOL}}',
      body: `Coach {{FIRST_NAME}}, one number:\n\nA 6'10 post and a 6'0 guard can differ by 1,000+ calories a day at the same practice intensity — and need different strength and recovery work. Elite Athlete sets fuel, workload, and recovery per position, plus an EA Coach for every player.\n\nWant me to set up {{SCHOOL}}?`,
      cta: 'Reply to Get Started' },
    { subject: 'Last note for {{SCHOOL}} this season',
      body: `Coach {{FIRST_NAME}}, last note — I'll stop here.\n\nIf dialing in each position for {{SCHOOL}} is worth a look, just reply and I'll set it up free. Either way, good luck this season.`,
      cta: 'Just Reply' },
  ],
  soccer: [
    { subject: 'Re: your keeper vs. your winger',
      body: `Coach {{FIRST_NAME}}, did my note land?\n\nYour keeper and your winger are almost playing two different sports inside one. Elite Athlete builds each player's program around their position — free for {{SCHOOL}}.`,
      cta: 'Reply to Set Up {{SCHOOL}}' },
    { subject: 'One number for {{SCHOOL}}',
      body: `Coach {{FIRST_NAME}}, one number:\n\nA winger can cover 7+ miles a match; a keeper a fraction of that — their fueling and recovery shouldn't match. Elite Athlete tailors both by position, with an EA Coach for each athlete.\n\nWant {{SCHOOL}} set up?`,
      cta: 'Reply to Get Started' },
    { subject: 'Last note for {{SCHOOL}} this season',
      body: `Coach {{FIRST_NAME}}, last note from me.\n\nIf position-specific training for {{SCHOOL}} is worth a look, just reply and I'll set it up free. If not, good luck this season.`,
      cta: 'Just Reply' },
  ],
  volleyball: [
    { subject: 'Re: your libero vs. your middle blocker',
      body: `Coach {{FIRST_NAME}}, did this reach you?\n\nYour libero and your middle blocker have opposite physical demands. Elite Athlete programs each by position instead of one generic plan — free for {{SCHOOL}}.`,
      cta: 'Reply to Set Up {{SCHOOL}}' },
    { subject: 'One point for {{SCHOOL}}',
      body: `Coach {{FIRST_NAME}}, one point:\n\nA middle blocker's jump load and a libero's court volume need different strength and recovery work. Elite Athlete splits it by position, with an EA Coach for every player.\n\nWant me to set up {{SCHOOL}}?`,
      cta: 'Reply to Get Started' },
    { subject: 'Last note for {{SCHOOL}} this season',
      body: `Coach {{FIRST_NAME}}, last note — I won't keep filling your inbox.\n\nIf tailoring training for {{SCHOOL}} by position is worth a look, just reply and I'll set it up free. Either way, good luck this season.`,
      cta: 'Just Reply' },
  ],
  generic: [
    { subject: 'Re: position-specific training for {{SCHOOL}}',
      body: `Coach {{FIRST_NAME}}, did my note reach you?\n\nEvery position on your roster has different demands — Elite Athlete builds each athlete's nutrition and training around theirs. Free for {{SCHOOL}}.`,
      cta: 'Reply to Set Up {{SCHOOL}}' },
    { subject: 'A quick note for {{SCHOOL}}',
      body: `Coach {{FIRST_NAME}}, the idea in one line:\n\nPosition-specific fuel, training, and recovery for every athlete — plus an EA Coach in their pocket. Want me to set up {{SCHOOL}}?`,
      cta: 'Reply to Get Started' },
    { subject: 'Last note for {{SCHOOL}} this season',
      body: `Coach {{FIRST_NAME}}, last note from me.\n\nIf it's worth a look for {{SCHOOL}}, just reply and I'll set it up free. If not, no worries — good luck this season.`,
      cta: 'Just Reply' },
  ],
};

// Same personalization guard used by marketing-blast (prevents "Coach Coach").
function personalize(str, v) {
  return String(str || '')
    .replace(/\{\{\s*FIRST_NAME\s*\}\}/g, v.first || '')
    .replace(/\{\{\s*LAST_NAME\s*\}\}/g, v.last || '')
    .replace(/\{\{\s*COACH_NAME\s*\}\}/g, v.coach || '')
    .replace(/\{\{\s*SCHOOL\s*\}\}/g, v.school || 'your program')
    .replace(/\{\{\s*EMAIL\s*\}\}/g, v.email || '')
    .replace(/\bCoach\s+Coach\b/g, 'Coach')
    .replace(/Coach\s+([,.!?:])/g, 'Coach$1')
    .replace(/[ \t]{2,}/g, ' ');
}

function buildHtml(bodyText, ctaLabel, ctaUrl, email) {
  const unsub = `https://elite-athlete.app/.netlify/functions/unsubscribe?email=${encodeURIComponent(email)}`;
  return `<!DOCTYPE html><html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head><body style="margin:0;padding:0;background:#0D0D0D;font-family:Arial,sans-serif;"><table width="100%" cellpadding="0" cellspacing="0" style="background:#0D0D0D;padding:40px 16px;"><tr><td align="center"><table width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;"><tr><td style="background:#B8962E;height:4px;border-radius:4px 4px 0 0;"></td></tr><tr><td style="background:#111;padding:28px 40px;border-left:1px solid #B8962E22;border-right:1px solid #B8962E22;"><p style="margin:0 0 2px;font-size:10px;letter-spacing:4px;color:#B8962E;">ELITE ATHLETE</p><p style="margin:0;font-size:11px;color:#444;">ENGINEERED FOR CHAMPIONS</p></td></tr><tr><td style="background:#B8962E;height:1px;"></td></tr><tr><td style="background:#111;padding:40px;border-left:1px solid #B8962E22;border-right:1px solid #B8962E22;"><table width="100%" cellpadding="0" cellspacing="0"><tr><td style="padding-bottom:32px;"><p style="margin:0;font-size:15px;color:#CCC;line-height:1.7;white-space:pre-line;">${bodyText}</p></td></tr><tr><td align="center" style="padding-bottom:12px;"><a href="${ctaUrl}" style="display:inline-block;background:#B8962E;color:#0D0D0D;text-decoration:none;font-size:15px;font-weight:700;letter-spacing:2px;text-transform:uppercase;padding:16px 48px;border-radius:6px;">${ctaLabel}</a></td></tr><tr><td align="center" style="padding-bottom:36px;"><p style="margin:0;font-size:13px;color:#888;">&#8618; or just reply to this email &mdash; it comes straight to me.</p></td></tr></table></td></tr><tr><td style="background:#0D0D0D;padding:20px 40px;border:1px solid #ffffff08;border-top:none;"><p style="margin:0;font-size:11px;color:#333;">${POSTAL_ADDRESS}</p><p style="margin:4px 0 0;font-size:11px;color:#333;">support@elite-athlete.app &middot; elite-athlete.app</p><p style="margin:6px 0 0;font-size:11px;"><a href="${unsub}" style="color:#555;text-decoration:underline;">Unsubscribe</a></p></td></tr><tr><td style="background:#B8962E;height:3px;border-radius:0 0 4px 4px;"></td></tr></table></td></tr></table></body></html>`;
}

async function fetchAllEmails(url, headers) {
  // Paginate PostgREST in 1000-row pages, collecting lowercased emails into a Set.
  const set = new Set();
  let from = 0;
  const PAGE = 1000;
  for (;;) {
    const r = await fetch(url, { headers: { ...headers, Range: `${from}-${from + PAGE - 1}`, 'Range-Unit': 'items' } });
    if (!r.ok) break;
    const rows = await r.json();
    for (const row of rows) if (row.email) set.add(String(row.email).toLowerCase().trim());
    if (rows.length < PAGE) break;
    from += PAGE;
  }
  return set;
}

export default async (req) => {
  if (req.method === 'OPTIONS') return new Response('', { status: 204, headers: CORS });

  const supabaseUrl = process.env.SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY;
  const resendKey = process.env.RESEND_API_KEY;
  const appUrl = process.env.URL || 'https://elite-athlete.app';
  const sbHeaders = { apikey: serviceKey, Authorization: `Bearer ${serviceKey}` };

  let onlyStep = null, dryRun = false;
  if (req.method === 'POST') {
    try { const b = await req.json(); if (b.step) onlyStep = parseInt(b.step); if (b.dry_run) dryRun = true; } catch {}
  }

  // Global skip sets (fetched once, reused across steps).
  const suppressed = await fetchAllEmails(`${supabaseUrl}/rest/v1/email_blasts?blast_id=in.(unsubscribed,bounced,complained)&select=email`, sbHeaders);
  const signedUp   = await fetchAllEmails(`${supabaseUrl}/rest/v1/email_blasts?blast_id=eq.welcome&select=email`, sbHeaders);
  // "engaged" = genuine human open/click (>5 min after delivery), NOT security-scanner
  // auto-fetches. Reads from the human_engaged view so scanner noise never suppresses a follow-up.
  const engaged    = await fetchAllEmails(`${supabaseUrl}/rest/v1/human_engaged?select=email`, sbHeaders);

  const now = Date.now();
  const DAY = 86400000;
  const steps = (onlyStep ? [onlyStep] : STEPS).filter((s) => STEPS.includes(s));
  const report = [];
  let grandSent = 0, grandFailed = 0;

  for (const N of steps) {
    const stepIdx = STEPS.indexOf(N);            // 0,1,2
    const marker = `followup_d${N}`;
    const newerThan = new Date(now - (N + 1) * DAY).toISOString();
    const olderThan = new Date(now - N * DAY).toISOString();

    // Coaches whose ORIGINAL marketing blast turned N days old in the last 24h.
    const origRes = await fetch(
      `${supabaseUrl}/rest/v1/email_blasts?blast_id=like.blast_%25&sent_at=gte.${newerThan}&sent_at=lt.${olderThan}&select=email`,
      { headers: sbHeaders }
    );
    const origRows = origRes.ok ? await origRes.json() : [];
    const candidateEmails = [...new Set(origRows.map((r) => String(r.email).toLowerCase().trim()).filter(Boolean))];

    // Already-sent-this-step set.
    const alreadyStep = await fetchAllEmails(`${supabaseUrl}/rest/v1/email_blasts?blast_id=eq.${marker}&select=email`, sbHeaders);

    // Keep only coaches (gives us sport/name/school), excluding all skip sets.
    const eligible = candidateEmails.filter((e) =>
      !suppressed.has(e) && !signedUp.has(e) && !engaged.has(e) && !alreadyStep.has(e)
    );

    // Look up coach details (sport/name/school) in chunks.
    const details = new Map();
    for (let i = 0; i < eligible.length; i += 200) {
      const chunk = eligible.slice(i, i + 200);
      const inList = chunk.map((e) => `"${e}"`).join(',');
      const r = await fetch(
        `${supabaseUrl}/rest/v1/coach_contacts?email=in.(${inList})&select=email,coach_name,school,sport`,
        { headers: sbHeaders }
      );
      if (r.ok) { for (const row of await r.json()) details.set(String(row.email).toLowerCase().trim(), row); }
    }

    // Final recipient list = eligible AND present in coach_contacts.
    const recipients = eligible.filter((e) => details.has(e)).map((e) => {
      const d = details.get(e);
      const full = (d.coach_name || '').trim();
      const first = full ? full.split(/\s+/)[0] : '';
      const sport = (d.sport || '').toLowerCase();
      const copy = (SPORT_COPY[sport] || SPORT_COPY.generic)[stepIdx];
      const vars = { first, last: full.split(/\s+/).slice(1).join(' '), coach: full, school: d.school || '', email: e };
      const mailto = `mailto:support@elite-athlete.app?subject=${encodeURIComponent('Set up ' + (d.school || 'my program') + ' on Elite Athlete')}`;
      return {
        email: e,
        subject: personalize(copy.subject, vars),
        html: buildHtml(personalize(copy.body, vars), personalize(copy.cta, vars), mailto, e),
      };
    });

    if (dryRun) {
      report.push({ step: N, candidates: candidateEmails.length, eligible: recipients.length });
      continue;
    }

    // Send in batches of 100 and record markers for successful batches.
    let sent = 0, failed = 0;
    const sentEmails = [];
    for (let i = 0; i < recipients.length; i += 100) {
      const batch = recipients.slice(i, i + 100);
      const payload = batch.map((rcpt) => ({
        from: 'Elite Athlete <support@elite-athlete.app>',
        to: rcpt.email,
        subject: rcpt.subject,
        html: rcpt.html,
        headers: {
          'List-Unsubscribe': `<https://elite-athlete.app/.netlify/functions/unsubscribe?email=${encodeURIComponent(rcpt.email)}>, <mailto:support@elite-athlete.app?subject=unsubscribe>`,
          'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
        },
      }));
      try {
        const r = await fetch('https://api.resend.com/emails/batch', {
          method: 'POST',
          headers: { Authorization: `Bearer ${resendKey}`, 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });
        if (r.ok) { sent += batch.length; sentEmails.push(...batch.map((b) => b.email)); }
        else { failed += batch.length; }
      } catch (_) { failed += batch.length; }
      if (i + 100 < recipients.length) await new Promise((res) => setTimeout(res, 200));
    }

    // Record markers so this step never re-sends to the same coach.
    for (let i = 0; i < sentEmails.length; i += 100) {
      const chunk = sentEmails.slice(i, i + 100).map((e) => ({ blast_id: marker, email: e, subject: `followup day ${N}` }));
      await fetch(`${supabaseUrl}/rest/v1/email_blasts`, {
        method: 'POST',
        headers: { ...sbHeaders, 'Content-Type': 'application/json', Prefer: 'resolution=ignore-duplicates' },
        body: JSON.stringify(chunk),
      }).catch(() => {});
    }

    report.push({ step: N, candidates: candidateEmails.length, sent, failed });
    grandSent += sent; grandFailed += failed;
  }

  return new Response(JSON.stringify({
    ok: true,
    dry_run: dryRun,
    message: dryRun ? 'Dry run — no emails sent' : `Follow-ups: ${grandSent} sent, ${grandFailed} failed`,
    steps: report,
  }), { status: 200, headers: CORS });
};
