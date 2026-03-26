// ─────────────────────────────────────────────────────────────
// src/lib/email.js
// EmailJS integration — sends real emails from the browser
// ─────────────────────────────────────────────────────────────
import emailjs from '@emailjs/browser';

const SERVICE_ID  = import.meta.env.VITE_EMAILJS_SERVICE_ID;
const TEMPLATE_ID = import.meta.env.VITE_EMAILJS_TEMPLATE_ID;
const PUBLIC_KEY  = import.meta.env.VITE_EMAILJS_PUBLIC_KEY;

if (!SERVICE_ID || !TEMPLATE_ID || !PUBLIC_KEY) {
  console.warn('⚠️  EmailJS keys missing — check your .env.local file');
}

// Initialize EmailJS once
emailjs.init(PUBLIC_KEY);

// ── SEND EMAIL ────────────────────────────────────────────────
// templateParams must match the variables in your EmailJS template.
// Recommended template variables:
//   {{to_email}}   — recipient
//   {{from_name}}  — athlete name
//   {{subject}}    — email subject
//   {{message}}    — email body / HTML content
//   {{reply_to}}   — athlete email for replies

export async function sendEmail({ toEmail, fromName, subject, message, replyTo }) {
  if (!SERVICE_ID || SERVICE_ID.includes('YOUR_')) {
    throw new Error('EmailJS not configured — add keys to .env.local');
  }

  const params = {
    to_email:  toEmail,
    from_name: fromName || 'Elite Athlete App',
    subject:   subject  || 'Report from Elite Athlete',
    message:   message,
    reply_to:  replyTo  || toEmail,
  };

  const result = await emailjs.send(SERVICE_ID, TEMPLATE_ID, params);
  return result;
}

// ── REPORT EMAIL ─────────────────────────────────────────────
export async function emailProgressReport({ toEmail, athleteName, reportData }) {
  const message = buildReportHTML(athleteName, reportData);
  return sendEmail({
    toEmail,
    fromName: athleteName,
    subject:  `Elite Athlete Progress Report — ${new Date().toLocaleDateString('en-US', {month:'long',day:'numeric',year:'numeric'})}`,
    message,
    replyTo:  toEmail,
  });
}

export async function emailMealPlan({ toEmail, athleteName, meals, totalCals, mealType, mealFreq }) {
  const lines = meals.map(m => {
    const cal = m.items.reduce((s, i) => s + i.cal, 0);
    const items = m.items.map(i => `  • ${i.name} — ${i.cal} kcal`).join('\n');
    return `${m.label} (${m.time}) — ${cal} kcal total\n${items}`;
  }).join('\n\n');

  const message =
    `ELITE ATHLETE — MEAL PLAN\n` +
    `Athlete: ${athleteName}\n` +
    `Plan: ${mealType} · ${mealFreq} Meals/Day\n` +
    `Daily Calories: ${totalCals.toLocaleString()} kcal\n` +
    `Date: ${new Date().toLocaleDateString('en-US', {month:'long',day:'numeric',year:'numeric'})}\n` +
    `${'─'.repeat(50)}\n\n${lines}`;

  return sendEmail({
    toEmail,
    fromName: athleteName,
    subject: `Meal Plan — ${mealType} (${mealFreq} meals) — ${new Date().toLocaleDateString('en-US', {month:'long',day:'numeric',year:'numeric'})}`,
    message,
    replyTo: toEmail,
  });
}

export async function emailJournalEntry({ toEmail, athleteName, entry }) {
  return sendEmail({
    toEmail,
    fromName: athleteName,
    subject:  `Journal Entry — ${entry.date}`,
    message:  `ELITE ATHLETE JOURNAL\nAthlete: ${athleteName}\nDate: ${entry.date}\n\n${entry.text}`,
    replyTo:  toEmail,
  });
}

export async function emailInjuryProtocol({ toEmail, athleteName, injuries, sport, position, injuryProtocols }) {
  const NL = "\n";
  const injList = injuries?.join(", ") || "None selected";
  const date = new Date().toLocaleDateString('en-US', {month:'long',day:'numeric',year:'numeric'});
  const line = "──────────────────────────────────────────────────";

  let msg = "ELITE ATHLETE — INJURY RECOVERY PROTOCOL" + NL;
  msg += "Athlete: " + athleteName + NL;
  msg += "Sport: " + sport + (position ? " · " + position : "") + NL;
  msg += "Injuries: " + injList + NL;
  msg += "Date: " + date + NL;
  msg += line + NL + NL;

  // Medical disclaimer
  msg += "⚕ MEDICAL DISCLAIMER" + NL;
  msg += "These protocols are for informational and educational purposes only." + NL;
  msg += "Always consult a licensed physician or certified physical therapist" + NL;
  msg += "before beginning any rehabilitation program. Individual injuries vary" + NL;
  msg += "in severity — your healthcare provider should evaluate and supervise" + NL;
  msg += "your specific recovery in conjunction with this guidance." + NL;
  msg += line + NL + NL;

  // Build from injuryProtocols data if provided
  if (injuryProtocols && injuries?.length) {
    injuries.forEach(injuryName => {
      const proto = injuryProtocols[injuryName];
      if (proto) {
        msg += "═══════════════════════════════════════════════════" + NL;
        msg += injuryName.toUpperCase() + NL;
        msg += proto.fullName + NL;
        msg += "Severity: " + proto.severity + NL;
        msg += "Surgery: " + proto.surgeryRequired + NL;
        if (proto.positionNotes?.[position]) {
          msg += NL + position + " SPECIFIC NOTE:" + NL;
          msg += proto.positionNotes[position] + NL;
        }
        msg += NL;

        proto.phases.forEach(ph => {
          msg += ph.ph + " — " + ph.d + NL;
          ph.items.forEach(item => { msg += "  • " + item + NL; });
          msg += NL;
        });

        if (proto.nutrition) {
          msg += "ACUTE PHASE NUTRITION:" + NL;
          proto.nutrition.acute.forEach(n => { msg += "  • " + n + NL; });
          msg += NL;
          msg += "RECOVERY PHASE NUTRITION:" + NL;
          proto.nutrition.recovery.forEach(n => { msg += "  • " + n + NL; });
          msg += NL;
        }
      } else {
        // Fallback for injuries without specific protocols
        msg += "═══════════════════════════════════════════════════" + NL;
        msg += injuryName.toUpperCase() + NL + NL;
        msg += "Phase 1 — Acute (Days 1–7)" + NL;
        ["RICE Protocol","Anti-inflammatory nutrition","Gentle ROM exercises","Pain management","Sleep 9–10hrs"].forEach(i => { msg += "  • " + i + NL; });
        msg += NL;
        msg += "Phase 2 — Sub-Acute (Weeks 2–4)" + NL;
        ["Progressive ROM","Isometric strengthening","Proprioception training","Aquatic therapy","Collagen protocol"].forEach(i => { msg += "  • " + i + NL; });
        msg += NL;
        msg += "Phase 3 — Return to Play (Weeks 5–8)" + NL;
        ["Sport-specific movement","Progressive loading","Neuromuscular re-education","Full clearance protocol"].forEach(i => { msg += "  • " + i + NL; });
        msg += NL;
      }
    });
  }

  msg += line + NL;
  msg += "Generated by Elite Athlete App" + NL;
  msg += "⚕ Consult your physician and PT for personalized care.";

  return sendEmail({
    toEmail, fromName: athleteName,
    subject: "Injury Recovery Protocol — " + injList,
    message: msg, replyTo: toEmail,
  });
}

export async function emailWorkoutPlan({ toEmail, athleteName, sport, position, wkType, wkFocus, exercises, weekNum }) {
  const NL = "\n";
  const exList = exercises?.map((ex,i) => {
    if (typeof ex === 'object') {
      return [
        `  ${i+1}. ${ex.name}`,
        `     Sets: ${ex.sets} × ${ex.reps} reps`,
        `     Load: ${ex.load || "See program"}`,
        `     Rest: ${ex.rest || "—"}`,
        `     Muscles: ${ex.muscles || "—"}`,
        ex.cues ? `     Cue: "${ex.cues}"` : "",
      ].filter(Boolean).join(NL);
    }
    return `  ${i+1}. ${ex}`;
  }).join(NL + NL) || '';

  const message =
    `ELITE ATHLETE — WORKOUT PLAN` + NL +
    `Athlete: ${athleteName}` + NL +
    `Sport: ${sport || "—"}${position ? " · " + position : ""}` + NL +
    `Program: ${wkType} | Focus: ${wkFocus}` + NL +
    (weekNum ? `Week: ${weekNum}` + NL : "") +
    `Date: ${new Date().toLocaleDateString('en-US', {month:'long',day:'numeric',year:'numeric'})}` + NL +
    "──────────────────────────────────────────────────" + NL + NL +
    `${wkFocus.toUpperCase()} SESSION — ${exercises?.length || 0} EXERCISES` + NL + NL +
    exList + NL + NL +
    "──────────────────────────────────────────────────" + NL +
    "LOAD GUIDE: 1RM = your one-rep max. Start conservatively" + NL +
    "and add 2-5% each week when all reps are achieved cleanly." + NL + NL +
    "Generated by Elite Athlete App";

  return sendEmail({
    toEmail, fromName: athleteName,
    subject: `Workout Plan — ${wkType} ${wkFocus}${weekNum ? " (Week " + weekNum + ")" : ""}`,
    message, replyTo: toEmail,
  });
}

export async function emailRecoveryNutrition({ toEmail, athleteName }) {
  const message =
    `ELITE ATHLETE — RECOVERY NUTRITION GUIDE\n` +
    `Athlete: ${athleteName}\n` +
    `Date: ${new Date().toLocaleDateString('en-US', {month:'long',day:'numeric',year:'numeric'})}\n` +
    `${"─".repeat(50)}\n\n` +
    `ANTI-INFLAMMATORY FOODS\n` +
    `  • Wild-caught Salmon (omega-3)\n  • Tart Cherry Juice\n  • Turmeric Golden Milk\n  • Leafy Greens & Berries\n  • Pineapple (bromelain)\n\n` +
    `SUPPLEMENTATION\n` +
    `  • Collagen Peptides 15g/day\n  • Vitamin C 1000mg\n  • Magnesium Glycinate 400mg\n  • Zinc 30mg\n  • Curcumin 1500mg\n\n` +
    `RECOVERY PROTOCOLS\n` +
    `  • Sleep 9–10 hrs nightly\n  • Cold water immersion 10min\n  • Compression therapy\n  • Foam rolling & mobility\n  • Breathwork & meditation\n\n` +
    `${"─".repeat(50)}\nGenerated by Elite Athlete App`;
  return sendEmail({
    toEmail, fromName: athleteName,
    subject: `Recovery Nutrition Guide — ${new Date().toLocaleDateString('en-US', {month:'long',day:'numeric',year:'numeric'})}`,
    message, replyTo: toEmail,
  });
}

// ── REPORT HTML BUILDER ───────────────────────────────────────
function buildReportHTML(name, data) {
  return `
ELITE ATHLETE PROGRESS REPORT
Athlete: ${name}
Date: ${new Date().toLocaleDateString('en-US', {month:'long',day:'numeric',year:'numeric'})}
${'═'.repeat(50)}

BODY METRICS
  Weight:  ${data.weight || '—'} lbs
  Height:  ${data.height || '—'} in
  Age:     ${data.age    || '—'} years
  Goal:    ${data.goal   || '—'}

SPORT PROFILE
  Sport:    ${data.sport    || '—'}
  Position: ${data.position || '—'}

NUTRITION
  Plan:     ${data.mealType || '—'}
  Meals/Day: ${data.mealFreq || '—'}
  Daily Calories: ${data.totalCals?.toLocaleString() || '—'} kcal

${'─'.repeat(50)}
Generated by Elite Athlete App
The Premier Athletic Performance Platform
  `;
}
