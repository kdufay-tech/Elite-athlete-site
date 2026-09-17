// ─────────────────────────────────────────────────────────────
// src/lib/tiers.js  —  Elite Athlete tier data + access gating
// Free · Athlete ($29/mo · $199/yr) · Elite ($69/mo · $529/yr)
// Coach Pro ($899/yr subscription + $4.99/athlete/month)
//
// Split out of lib/stripe.js 2026-09-17. This half is pure data and
// synchronous logic — getUserTier/canAccess run on first render and
// TIER_INFO drives all pricing UI, so it MUST stay statically importable.
// It deliberately does NOT import @stripe/stripe-js: that package injects
// js.stripe.com as a side effect of being imported, which put a Stripe CDN
// fetch (and its fraud fingerprinting) on every page load for every user,
// including free users and iOS users who cannot purchase at all.
// Checkout lives in lib/checkout.js and is loaded on demand.
// ── BETA / TEST MODE TOGGLE ───────────────────────────────────
// Set VITE_BETA_MODE=true in Netlify env to activate Stripe test mode.
// All test keys/prices are used automatically. Remove or set to false for live.
export const IS_BETA_MODE = import.meta.env.VITE_BETA_MODE === 'true';

// ── TIER ORDER ───────────────────────────────────────────────
export const TIER_ORDER = { free: 0, athlete: 1, elite: 2, coach: 3 };

// ── DERIVE userTier FROM subscription ROW ────────────────────
export function getUserTier(subscription) {
  if (!subscription) return 'free';
  const plan = (subscription.plan_name || '').toLowerCase();
  if (plan.includes('coach'))                return 'coach';
  if (plan.includes('elite'))                return 'elite';
  if (plan === 'beta_elite')                 return 'elite'; // beta users get full elite access
  if (plan.includes('athlete'))              return 'athlete';
  if (subscription.status === 'active')      return 'elite'; // legacy paid = elite
  return 'free';
}

// ── GATE CHECK ───────────────────────────────────────────────
export function canAccess(userTier, requiredTier) {
  return (TIER_ORDER[userTier] ?? 0) >= (TIER_ORDER[requiredTier] ?? 0);
}

// ── STRIPE PRICE IDS ─────────────────────────────────────────
// Live prices: VITE_STRIPE_PRICE_*
// Test prices: VITE_STRIPE_TEST_PRICE_* (used when VITE_BETA_MODE=true)
export const STRIPE_PRICES = IS_BETA_MODE ? {
  athlete_monthly: import.meta.env.VITE_STRIPE_TEST_PRICE_ATHLETE_MONTHLY,
  elite_monthly:   import.meta.env.VITE_STRIPE_TEST_PRICE_ELITE_MONTHLY,
  coach_monthly:   import.meta.env.VITE_STRIPE_TEST_PRICE_COACH_MONTHLY,
  athlete_annual:  import.meta.env.VITE_STRIPE_TEST_PRICE_ATHLETE_ANNUAL,
  elite_annual:    import.meta.env.VITE_STRIPE_TEST_PRICE_ELITE_ANNUAL,
  coach_annual:    import.meta.env.VITE_STRIPE_TEST_PRICE_COACH_ANNUAL,
  athlete_seat:    import.meta.env.VITE_STRIPE_TEST_PRICE_ATHLETE_SEAT,
} : {
  athlete_monthly: import.meta.env.VITE_STRIPE_PRICE_ATHLETE_MONTHLY,
  elite_monthly:   import.meta.env.VITE_STRIPE_PRICE_ELITE_MONTHLY,
  coach_monthly:   import.meta.env.VITE_STRIPE_PRICE_COACH_MONTHLY,
  athlete_annual:  import.meta.env.VITE_STRIPE_PRICE_ATHLETE_ANNUAL,
  elite_annual:    import.meta.env.VITE_STRIPE_PRICE_ELITE_ANNUAL,
  coach_annual:    import.meta.env.VITE_STRIPE_PRICE_COACH_ANNUAL,
  athlete_seat:    import.meta.env.VITE_STRIPE_PRICE_ATHLETE_SEAT,
};

// ── TIER DISPLAY METADATA ─────────────────────────────────────
// Single source of truth for all pricing UI in the app.
export const TIER_INFO = {
  athlete: {
    label: 'Athlete', tier: 'Foundation',
    monthly: { price: '$29', display: '$29/mo',  key: 'athlete_monthly', planName: 'athlete' },
    annual:  { price: '$199', display: '$199/yr', key: 'athlete_annual',  planName: 'athlete_annual', moEquiv: '$16.58/mo', save: 'Save $149/yr — 43% off' },
    features: [
      'Full position-specific meal plans',
      'Complete workout program + session logger',
      'PR detection + Exercise Library (YouTube)',
      '30-day history timeline',
      'Progress photos + body tracking',
      'Calendar + ICS export',
      'PDF downloads + email to self',
      'Push notifications',
      // Moved from Elite 2026-09-15 (council delta): a $29 athlete or a
      // coach-seated athlete can build a record and share it with a coach.
      'Recruiting profile + live share links (QR, expiry, revoke)',
    ],
  },
  elite: {
    label: 'Elite', tier: 'Champion', featured: true,
    monthly: { price: '$69', display: '$69/mo',  key: 'elite_monthly', planName: 'elite' },
    annual:  { price: '$529', display: '$529/yr', key: 'elite_annual',  planName: 'elite_annual', moEquiv: '$44.08/mo', save: 'Save $299/yr — 36% off' },
    features: [
      'Everything in Athlete',
      'AI Coach — unlimited, data-contextual',
      'Daily AI performance briefs',
      'Injury recovery protocols (100+ injuries)',
      'Supplement stack + full dosing (180+)',
      '16-week periodization plan',
      '90-day history',
      'Progress Report + Report Card PDFs',
      'Email everything to coach',
    ],
  },
  coach: {
    label: 'Coach Pro', tier: 'Professional',
    // Coach Pro shipped 2026-09-04 (4174c3b). The waitlist flag is retired: the
    // pricing screen already says 'Get Coach Pro', and leaving it set made that
    // CTA open a Join Waitlist modal for a product that was already live.
    // iOS shows a statement instead of a buy button - Apple rejects both IAP
    // bypass and outbound purchase links. Same rule as App.jsx webOnlyPurchase.
    webOnlyPurchase: true,
    // Coach Pro is ONE subscription fee: $899/year. There is no $99/month coach
    // plan. Per-athlete seats ($4.99/mo) are billed on a separate monthly
    // subscription - Stripe forbids mixing intervals in one subscription.
    annualOnly: true,
    monthly: null,
    annual:  { price: '$899', display: '$899/yr', key: 'coach_annual',  planName: 'coach_annual', moEquiv: '$74.92/mo' },
    // Monthly only. Annual ($899/yr) is flat - no seat charge - both as a
    // pricing decision and because Stripe forbids mixing billing intervals
    // in one subscription, so a monthly seat cannot ride an annual base.
    perAthlete: '+ $4.99/athlete/month',
    features: [
      'Everything in Elite',
      'Coach dashboard — roster + readiness',
      'Athlete invite + roster management',
      'Program delivery to athletes',
      'Team wellness feed',
      'Per-athlete billing',
      'Team reports + compliance',
    ],
  },
};
