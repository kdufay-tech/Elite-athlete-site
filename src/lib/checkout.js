// ─────────────────────────────────────────────────────────────
// src/lib/checkout.js  —  Stripe checkout (load on demand only)
//
// Split out of lib/stripe.js 2026-09-17. Everything here depends on
// @stripe/stripe-js, so NOTHING may import this module statically — use
// await import('../lib/checkout') at the point of use. There is a test
// guarding that: checkout.test.js > "module boundaries".
//
// Why: the default @stripe/stripe-js entry runs a bare top-level
//   Promise.resolve().then(() => getStripePromise())
// which appends <script src="https://js.stripe.com/v3"> merely because the
// module was imported — loadStripe() never has to be called. With the old
// static import in App.jsx that meant every page load pulled Stripe.js from
// Stripe's CDN and ran advancedFraudSignals fingerprinting, for free users
// and for iOS users who cannot purchase at all (TIER_INFO.coach.webOnlyPurchase).
//
// Importing from '@stripe/stripe-js/pure' drops that side effect: the CDN
// script is fetched only if loadStripe() is actually called — and as
// configured today it never is. redirectToCheckout() sends the browser to the
// hosted Checkout url returned by the Netlify function and returns before it
// reaches getStripe(); the Payment Link path does not need the SDK either.
// getStripe() only covers a response carrying a sessionId but no url. Keep it
// working, but do not build on the assumption that it runs.
// ─────────────────────────────────────────────────────────────
import { loadStripe } from '@stripe/stripe-js/pure';
import { IS_BETA_MODE, STRIPE_PRICES } from './tiers';

const STRIPE_KEY = IS_BETA_MODE
  ? import.meta.env.VITE_STRIPE_TEST_PUBLISHABLE_KEY
  : import.meta.env.VITE_STRIPE_PUBLISHABLE_KEY;

if (!STRIPE_KEY) console.warn(`⚠️  ${IS_BETA_MODE ? 'VITE_STRIPE_TEST_PUBLISHABLE_KEY' : 'VITE_STRIPE_PUBLISHABLE_KEY'} missing`);

let stripePromise = null;

export function getStripe() {
  if (!stripePromise) {
    stripePromise = loadStripe(STRIPE_KEY).catch((err) => {
      // Never cache a rejection: a transient failure would otherwise poison
      // every later checkout attempt until a full page reload.
      stripePromise = null;
      throw err;
    });
  }
  return stripePromise;
}

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
export async function redirectToCheckout({ priceKey, planName, userEmail, userId, successUrl, cancelUrl, couponCode }) {
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
    if (userId)    p.set('client_reference_id', userId);
    else if (planName) p.set('client_reference_id', planName);
    window.location.href = link + (p.toString() ? '?' + p.toString() : '');
    return;
  }

  // Option B: Netlify Function creates a Checkout Session (recommended for production)
  const res = await fetch('/.netlify/functions/stripe-checkout', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ priceId, planName, userEmail, userId, successUrl, cancelUrl, couponCode }),
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

// ── CARD HELPERS - REMOVED 2026-09-07 ──────────────────────
// validateCard / formatCardNumber / formatExpiry existed only to drive a card
// form inside PayModal that collected cardholder name, PAN, expiry and CVV,
// validated them locally, then discarded them and redirected to Stripe
// Checkout, where the user re-entered everything. Card entry belongs on
// Stripe's page: it keeps live PAN out of React state and off this origin.
// Do not reintroduce card fields in this app.
