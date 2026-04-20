// ─────────────────────────────────────────────────────────────
// src/lib/stripe.js  —  Elite Athlete 4-Tier Pricing
// Free · Athlete ($29/mo · $199/yr) · Elite ($69/mo · $529/yr)
// Coach Pro ($99/mo · $899/yr + $4.99/athlete/mo)
// ─────────────────────────────────────────────────────────────
import { loadStripe } from '@stripe/stripe-js';

// ── BETA / TEST MODE TOGGLE ───────────────────────────────────
// Set VITE_BETA_MODE=true in Netlify env to activate Stripe test mode.
// All test keys/prices are used automatically. Remove or set to false for live.
export const IS_BETA_MODE = import.meta.env.VITE_BETA_MODE === 'true';

const STRIPE_KEY = IS_BETA_MODE
  ? import.meta.env.VITE_STRIPE_TEST_PUBLISHABLE_KEY
  : import.meta.env.VITE_STRIPE_PUBLISHABLE_KEY;

if (!STRIPE_KEY) console.warn(`⚠️  ${IS_BETA_MODE ? 'VITE_STRIPE_TEST_PUBLISHABLE_KEY' : 'VITE_STRIPE_PUBLISHABLE_KEY'} missing`);

let stripePromise = null;
export function getStripe() {
  if (!stripePromise) stripePromise = loadStripe(STRIPE_KEY);
  return stripePromise;
}

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
export const STRIPE_PRICES = {
  athlete_monthly: import.meta.env.VITE_STRIPE_TEST_PRICE_ATHLETE_MONTHLY || import.meta.env.VITE_STRIPE_PRICE_ATHLETE_MONTHLY,
  elite_monthly:   import.meta.env.VITE_STRIPE_TEST_PRICE_ELITE_MONTHLY   || import.meta.env.VITE_STRIPE_PRICE_ELITE_MONTHLY,
  coach_monthly:   import.meta.env.VITE_STRIPE_TEST_PRICE_COACH_MONTHLY   || import.meta.env.VITE_STRIPE_PRICE_COACH_MONTHLY,
  athlete_annual:  import.meta.env.VITE_STRIPE_TEST_PRICE_ATHLETE_ANNUAL  || import.meta.env.VITE_STRIPE_PRICE_ATHLETE_ANNUAL,
  elite_annual:    import.meta.env.VITE_STRIPE_TEST_PRICE_ELITE_ANNUAL    || import.meta.env.VITE_STRIPE_PRICE_ELITE_ANNUAL,
  coach_annual:    import.meta.env.VITE_STRIPE_TEST_PRICE_COACH_ANNUAL    || import.meta.env.VITE_STRIPE_PRICE_COACH_ANNUAL,
  athlete_seat:    import.meta.env.VITE_STRIPE_TEST_PRICE_ATHLETE_SEAT    || import.meta.env.VITE_STRIPE_PRICE_Coach_Per_Athlete_seat,
};

// ── TIER DISPLAY METADATA ─────────────────────────────────────
// Single source of truth for all pricing UI in the app.
export const TIER_INFO = {
  athlete: {
    label: 'Athlete', tier: 'Foundation',
    monthly: { price: '$29', display: '$29/mo',  key: 'athlete_monthly', planName: 'athlete' },
    annual:  { price: '$199', display: '$199/yr', key: 'athlete_annual',  planName: 'athlete_annual',
               moEquiv: '$16.58/mo', save: 'Save $149/yr — 43% off' },
    features: [
      'Full position-specific meal plans',
      'Complete workout program + session logger',
      'PR detection + Exercise Library (YouTube)',
      '30-day history timeline',
      'Progress photos + body tracking',
      'Calendar + ICS export',
      'PDF downloads + email to self',
      'Push notifications',
    ],
  },
  elite: {
    label: 'Elite', tier: 'Champion', featured: true,
    monthly: { price: '$69', display: '$69/mo',  key: 'elite_monthly', planName: 'elite' },
    annual:  { price: '$529', display: '$529/yr', key: 'elite_annual',  planName: 'elite_annual',
               moEquiv: '$44.08/mo', save: 'Save $299/yr — 35% off' },
    features: [
      'Everything in Athlete',
      'AI Coach — unlimited, data-contextual',
      'Daily AI performance briefs',
      'Injury recovery protocols (100+ injuries)',
      'Supplement stack + full dosing (180+)',
      '16-week periodization plan',
      '90-day history + recruiting profile',
      'Progress Report + Report Card PDFs',
      'Email everything to coach',
    ],
  },
  coach: {
    label: 'Coach Pro', tier: 'Professional', waitlist: true,
    monthly: { price: '$99', display: '$99/mo',  key: 'coach_monthly', planName: 'coach' },
    annual:  { price: '$899', display: '$899/yr', key: 'coach_annual',  planName: 'coach_annual',
               moEquiv: '$74.92/mo', save: 'Save ~$280/yr base' },
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

// ── PAYMENT LINKS (paste from Stripe Dashboard → Payment Links) ──
// After creating products in Stripe, generate Payment Links and set these env vars.
// If not set, falls back to the Netlify Function (stripe-checkout).
const _links = {
  athlete_monthly: import.meta.env.VITE_STRIPE_LINK_ATHLETE_MONTHLY || '',
  athlete_annual:  import.meta.env.VITE_STRIPE_LINK_ATHLETE_ANNUAL  || '',
  elite_monthly:   import.meta.env.VITE_STRIPE_LINK_ELITE_MONTHLY   || '',
  elite_annual:    import.meta.env.VITE_STRIPE_LINK_ELITE_ANNUAL    || '',
  coach_monthly:   import.meta.env.VITE_STRIPE_LINK_COACH_MONTHLY   || '',
  coach_annual:    import.meta.env.VITE_STRIPE_LINK_COACH_ANNUAL    || '',
};

// ── REDIRECT TO CHECKOUT ─────────────────────────────────────
export async function redirectToCheckout({ priceKey, planName, userEmail, successUrl, cancelUrl, couponCode }) {
  const priceId = STRIPE_PRICES[priceKey];
  if (!priceId) {
    throw new Error(
      `Stripe price ID not configured for "${priceKey}". ` +
      'Add VITE_STRIPE_PRICE_* keys to your .env.local and Netlify environment variables.'
    );
  }

  // Option A: Stripe Payment Link (no backend needed — fastest setup)
  const link = _links[priceKey];
  if (link && link.startsWith('https://')) {
    const p = new URLSearchParams();
    if (userEmail) p.set('prefilled_email', userEmail);
    if (planName)  p.set('client_reference_id', planName);
    window.location.href = link + (p.toString() ? '?' + p.toString() : '');
    return;
  }

  // Option B: Netlify Function creates a Checkout Session (recommended for production)
  const res = await fetch('/.netlify/functions/stripe-checkout', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ priceId, planName, userEmail, successUrl, cancelUrl, couponCode }),
  });
  if (!res.ok) {
    const e = await res.json().catch(() => ({}));
    throw new Error(e.error || 'Checkout session creation failed');
  }
  const { sessionId, url } = await res.json();
  if (url) { window.location.href = url; return; }
  const stripe = await getStripe();
  await stripe.redirectToCheckout({ sessionId });
}

// ── CARD HELPERS ─────────────────────────────────────────────
export function validateCard({ number, expiry, cvv, name }) {
  const errors = {};
  if (!name?.trim()) errors.name = 'Cardholder name required';
  const num = number?.replace(/\s/g, '');
  if (!num || num.length < 13 || num.length > 19 || !/^\d+$/.test(num))
    errors.number = 'Valid card number required';
  if (!expiry || !/^\d{2}\/\d{2}$/.test(expiry)) errors.expiry = 'Format: MM/YY';
  else {
    const [mm, yy] = expiry.split('/').map(Number);
    if (mm < 1 || mm > 12 || new Date(2000 + yy, mm - 1, 1) < new Date())
      errors.expiry = 'Card expired';
  }
  if (!cvv || cvv.length < 3) errors.cvv = 'CVV required';
  return errors;
}

export const formatCardNumber = v =>
  v.replace(/\D/g, '').slice(0, 16).replace(/(.{4})/g, '$1 ').trim();

export const formatExpiry = v => {
  const d = v.replace(/\D/g, '').slice(0, 4);
  return d.length >= 2 ? d.slice(0, 2) + '/' + d.slice(2) : d;
};
