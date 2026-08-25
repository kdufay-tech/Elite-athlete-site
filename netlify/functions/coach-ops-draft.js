// netlify/functions/coach-ops-draft.js
// Coach Ops - Phase 2: DRAFTING (draft + approve; never sends).
// Admin-triggered. Given a `kind`, reads KPI context, asks Claude to write
// draft(s) in brand voice with guardrails, and files them as `pending` in
// coach_ops_drafts. Generates only - a human must Approve then Send elsewhere.

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Authorization, Content-Type',
  'Content-Type': 'application/json',
};

const SUPABASE_URL  = process.env.SUPABASE_URL;
const SERVICE_KEY   = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY;
const ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY;
const ADMIN_EMAIL   = process.env.ADMIN_EMAIL || 'kiszo@taratechent.com';

const KINDS = {
  reengagement: {
    channel: 'email', audience: 'invited_athletes', count: '1',
    instruction: `Draft ONE re-engagement email to ATHLETES who got a beta invite but have not signed up yet (set audience "invited_athletes"). Lead with the recruiting payoff and "train like a pro," then EA Coach. Make the value concrete in the first line: pick your sport and position, get a plan built for that exact position plus a daily EA Coach brief - free. One clear CTA to start free. No price talk.`,
  },
  coach_outreach: {
    channel: 'email', audience: 'coaches', count: '3',
    instruction: `Draft THREE outreach emails to COACHES - one per level. Draft (1): a HIGH-SCHOOL head coach (set audience "coach_hs") - this is the highest-leverage relationship in the whole plan, so make it the strongest. Speak to spotting and developing raw talent, getting their kids recruited and seen by college programs, parent buy-in, and building a program where every athlete trains on a pro-grade sport-and-position plan from day one. The hook: get your whole roster started on one platform they carry through college recruiting into the pros. Draft (2): a COLLEGE-program coach (set audience "coach_college") - developing recruits, roster readiness and compliance on one screen, one-click recruiting exports, off-season accountability they can finally SEE. Draft (3): a PRO/elite-program coach (set audience "coach_pro") - load management and overtraining alerts across a veteran roster, the last half-percent of performance, off-season and rehab accountability, portable athlete data. All three: speak to the coach's actual job, not a feature list; the core hook is that a coach mandate makes a whole roster comply. One CTA each to reply or book a short call.`,
  },
  content: {
    channel: 'social', audience: null, count: '3',
    instruction: `Draft 3 top-of-funnel pieces for athletes. (1) An Instagram Reel caption for high-schoolers - hook on getting recruited faster or out-working the off-season (set meta.platform "Instagram"). (2) An X post for college athletes - NIL value living in their data, or recovery as a competitive edge (set meta.platform "X"). (3) One SEO article brief: set channel "seo", subject = the working title, and in body give the target keyword, an H2 outline, and the internal-link + CTA plan. Pick the keyword from Elite Athlete's real SEO pillars: "how to get recruited faster", "off-season training program football", "best training app for HS athletes", "HS athlete nutrition", "athlete recovery tracking app", or "college athlete NIL performance data". Hook hard in the first line for social.`,
  },
  lifecycle: {
    channel: 'email', audience: 'users', count: '2',
    instruction: `Draft 2 lifecycle emails to signed-up users. (1) A Day-1 activation email that drives the real aha moment - generating their first sport-and-position plan and meeting EA Coach - with one CTA to do it right now. (2) A win-back email for users who went quiet: remind them what is sitting there waiting (their plan, readiness score, recruiting profile) and pull them back with one CTA. Each: subject, short body, one CTA.`,
  },
};

const SYSTEM_PROMPT = `You are Coach Ops, the growth copywriter for Elite Athlete. Write like someone who has actually coached and actually competed - never like a generic SaaS marketer.

WHAT ELITE ATHLETE IS
Elite Athlete is the operating system of an athlete's career: one app that replaces the 4-6 disconnected tools athletes used to juggle. Live on iOS, Android and web (elite-athlete.app), one account across all three. Every capability is sport- AND position-specific, never generic:
- Training programs built for the athlete's exact sport and position (a defensive lineman does not get a marathoner's plan).
- EA Coach (powered by Anthropic Claude): a personalized daily brief that keeps each athlete on the coach's program between sessions, with full context on their training, nutrition and readiness. No competitor has this - use it. Always call it "EA Coach", never "AI Coach".
- Nutrition and meal plans matched to sport, position and goals.
- Recovery and readiness monitoring (readiness score, load management / ACWR) so athletes push hard without breaking down.
- CBT-based mental performance modules: visualization, pre-game routines, confidence.
- Recruiting profile + film library that auto-updates into a shareable one-page profile.
- NIL dashboard with a brand-value estimator (college tier).
- Position-specific injury-risk protocols across 28 sport/position combinations.
- A performance archive the ATHLETE owns for life - it travels high school to college to pro. Teams and other apps keep that data; Elite Athlete hands it back to the athlete.

WHO IT IS FOR - AND WHY IT MATTERS (this is the real selling point; always ground the copy in the reader's level)
- HIGH SCHOOL (13-18): most underserved, mobile-first, driven by recruiting and peer status. Pain: no central platform, recruiting uncertainty, scattered advice, nutrition blind spots, wasted off-seasons. Angles: "Get Recruited Faster," "Train Like a Pro Before You Go Pro," "Your Highlight Reel Starts Here," "Outwork the Off-Season," "Be Ready When Your Moment Comes."
- COLLEGE (18-23): pro standards, full-time students, NIL entrepreneurs. Pain: fragmented data, unquantified NIL value, no time, inconsistent recovery, no pro-grade portfolio. Angles: "Your NIL Value Lives in Your Data," "From Film Room to Draft Board," "Recovery Is Your Competitive Edge," "Build Your Brand While You Build Your Game."
- PRO (20-40+): the team owns their data, off-season accountability gaps, brand and business demands, life after the contract. Angles: "Own Your Data. Own Your Career.," "The Last Half-Percent," "Your Career Doesn't End When Your Contract Does," "From the Field to the Boardroom."
- COACHES are the key channel. For coaches, lead with the dashboard: one screen for team readiness, compliance and load; a program builder that takes minutes; film tag/share; off-season completion they can see; one-click recruiting exports; automated parent reports; overtraining alerts. A coach mandate is what makes a whole roster comply.

BRAND VOICE
Confidence of a great coach, credibility of a sports scientist. Motivating but evidence-based. Direct, no fluff, no hype, no emojis unless one truly earns its place. Aspirational but honest about the work. Reusable taglines when they fit: "Built for Champions. Trusted by Coaches. Proven on Every Level." / "Train like a pro. Recruit like a brand." / "Own your data. Own your career." / "One platform. Every level. High school to pro."

HOW TO SHARPEN AGAINST COMPETITORS (contrast, don't just name-call)
Generic calorie apps give a lineman and a marathoner the same macros. Film apps only cut film. Endurance apps only count miles. Team platforms own the data. Line to borrow: "TrainingPeaks tracks your miles. We build your whole game."

HARD RULES
- No medical claims or health guarantees.
- Never target, mention, or collect data from anyone under 13 (COPPA).
- Do NOT invent stats, user counts, or testimonials. Any number you cite must come from the KPI snapshot in the user message - otherwise speak to capability, not metrics.
- Do NOT quote subscription prices; the entry CTA is the free tier. Drive to "Start free" at elite-athlete.app.
- These are DRAFTS for human approval.

POSITIONING - AUGMENT, NEVER REPLACE (applies to every piece of content)
Elite Athlete makes the coach and the athlete better; it never replaces them. It gives tracking, data, visibility and reach - the human still does the work. Never frame any feature, above all EA Coach, as coaching for them or thinking for them. For coaches: "you coach; Elite Athlete tracks." For athletes: it sharpens their training, it does not do it for them.

EVERY DRAFT MUST RUN THIS SPINE - weave it naturally into the copy, never label the parts, and keep it tight:
1. PROBLEM - specific to the reader's sport and level; be concrete (a lineman's needs are not a keeper's; a sprinter's are not a setter's). If the piece is for one sport, name that sport's real problem.
2. STATUS QUO - how it is handled today and why that falls short (generic plans, scattered tools, a coach who cannot be everywhere, data the team keeps).
3. EA'S EDGE - how Elite Athlete solves it better, tied to a real feature.
4. THE PATH - the one concrete next step (the CTA).
5. THE VISION - tie back to giving every athlete the support once reserved for the elite, on one platform that travels high school to college to pro.

PERSONALIZATION (coach emails only): open with a greeting using the literal token {{FIRST_NAME}} (for example "Coach {{FIRST_NAME}}," or "Hi {{FIRST_NAME}},") and you may reference {{SCHOOL}} once where it reads naturally. Write these tokens EXACTLY as shown - they are merged with the real coach name and school per recipient at send time, and fall back to "Coach" / "your program" when unknown. Never invent a specific real name or school.

Return ONLY a JSON object, no markdown, no code fences, in exactly this shape:
{"drafts":[{"channel":"email|social|seo","audience":"invited_athletes|coach_hs|coach_college|coach_pro|coaches|athlete_hs|athlete_college|athlete_pro|users|all|null","subject":"...","body":"...","rationale":"one line: why this angle, citing the KPI when relevant","meta":{"headline":"short email headline","cta_text":"...","cta_url":"https://elite-athlete.app","platform":"Instagram|X|null"}}]}`;

async function sbGet(path) {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, { headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` } });
  return r.ok ? r.json() : [];
}

function stripFences(t) {
  return String(t || '').replace(/^```(?:json)?/i, '').replace(/```$/i, '').trim();
}

async function callClaude(system, user) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 22000);
  try {
    const r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': ANTHROPIC_KEY, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({ model: 'claude-haiku-4-5-20251001', max_tokens: 4096, system, messages: [{ role: 'user', content: user }] }),
      signal: controller.signal,
    });
    const d = await r.json();
    if (!r.ok) throw new Error(d.error?.message || `Anthropic ${r.status}`);
    return d.content?.[0]?.text || '';
  } catch (e) {
    if (e.name === 'AbortError') throw new Error('AI request timed out. Try again.');
    throw e;
  } finally { clearTimeout(timeoutId); }
}

export default async (req) => {
  if (req.method === 'OPTIONS') return new Response('', { status: 204, headers: CORS });
  try {
    if (!SUPABASE_URL || !SERVICE_KEY || !ANTHROPIC_KEY) {
      return new Response(JSON.stringify({ error: 'Server not configured' }), { status: 500, headers: CORS });
    }
    // Admin gate
    const token = (req.headers.get('authorization') || '').replace('Bearer ', '').trim();
    const ur = token ? await fetch(`${SUPABASE_URL}/auth/v1/user`, { headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${token}` } }) : null;
    const u = ur && ur.ok ? await ur.json() : null;
    if (!u || u.email !== ADMIN_EMAIL) {
      return new Response(JSON.stringify({ error: 'Admin access required' }), { status: 403, headers: CORS });
    }

    let body = {};
    try { body = await req.json(); } catch (_) {}
    const kind = body.kind;
    const spec = KINDS[kind];
    if (!spec) return new Response(JSON.stringify({ error: 'Unknown kind' }), { status: 400, headers: CORS });

    // KPI context from the latest snapshot (Phase 1), plus a couple of counts.
    const [snap, waitlist, invites] = await Promise.all([
      sbGet('kpi_snapshots?select=metrics,week_start&order=week_start.desc&limit=1'),
      sbGet('coach_waitlist?select=id&limit=1'),
      sbGet('beta_invites?select=status&limit=1'),
    ]);
    const metrics = snap[0]?.metrics || {};
    const context = `Latest KPI snapshot (week ${snap[0]?.week_start || 'n/a'}): ${JSON.stringify(metrics)}.`;

    const user = `${context}\n\nTask: ${spec.instruction}\n\nProduce ${spec.count} draft(s). For email drafts set channel "email". Return the JSON object now.`;
    const raw = await callClaude(SYSTEM_PROMPT, user);

    let parsed = null;
    {
      const s = stripFences(raw);
      try { parsed = JSON.parse(s); } catch (_) {
        // Salvage: pull the JSON object out of any surrounding prose.
        const a = s.indexOf('{'), b = s.lastIndexOf('}');
        if (a >= 0 && b > a) { try { parsed = JSON.parse(s.slice(a, b + 1)); } catch (_) {} }
      }
    }
    if (!parsed) {
      return new Response(JSON.stringify({ error: 'Could not parse AI output', raw: raw.slice(0, 500) }), { status: 502, headers: CORS });
    }
    const drafts = Array.isArray(parsed?.drafts) ? parsed.drafts : [];
    if (!drafts.length) return new Response(JSON.stringify({ error: 'AI returned no drafts' }), { status: 502, headers: CORS });

    // File each as pending. Normalize audience: 'null'/'' -> null.
    const rows = drafts.slice(0, 5).map(dft => {
      const channel = (dft.channel || spec.channel || 'email').toLowerCase();
      let audience = dft.audience;
      if (audience === 'null' || audience === '' || channel !== 'email') audience = channel === 'email' ? (audience || spec.audience) : null;
      return {
        kind, channel,
        audience: channel === 'email' ? (audience || spec.audience || 'invited_athletes') : null,
        subject: dft.subject || null,
        body: dft.body || '',
        meta: { ...(dft.meta || {}), rationale: dft.rationale || '' },
        status: 'pending',
      };
    });

    const ins = await fetch(`${SUPABASE_URL}/rest/v1/coach_ops_drafts`, {
      method: 'POST',
      headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}`, 'Content-Type': 'application/json', Prefer: 'return=representation' },
      body: JSON.stringify(rows),
    });
    if (!ins.ok) {
      const err = await ins.text().catch(() => '');
      return new Response(JSON.stringify({ error: 'Failed to save drafts', detail: err.slice(0, 300) }), { status: 500, headers: CORS });
    }
    const saved = await ins.json();
    return new Response(JSON.stringify({ ok: true, kind, created: saved.length, drafts: saved }), { status: 200, headers: CORS });
  } catch (e) {
    return new Response(JSON.stringify({ error: String((e && e.message) || e) }), { status: 500, headers: CORS });
  }
};
