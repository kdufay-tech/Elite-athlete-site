// ─────────────────────────────────────────────────────────────
// src/lib/checkout.js  —  Stripe checkout (load on demand only)
//
// Split out of lib/stripe.js 2026-09-17. Everything here depends on
// @stripe/stripe-js, so NOTHING may import this module statically — do it
// with await import('../lib/checkout') at the point of use, or via warm().
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
// script is fetched only when loadStripe() is actually called. warm() is how
// we choose that moment — see its comment below.
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
      // Never cache a rejection. warm() calls this well before any Buy click,
      // so without this reset one flaky moment on the paywall would poison
      // every later checkout attempt until a full page reload.
      stripePromise = null;
      throw err;
    });
  }
  return stripePromise;
}

// Start fetching js.stripe.com ahead of a Buy click, without blocking render.
// Called on mount by the web paywall surfaces (PricingSection, PayModal) so
// the SDK is warm by the time checkout runs, while users who never open a
// paywall never touch Stripe at all. Deliberately silent: a failed warm just
// means redirectToCheckout() loads the SDK on demand, exactly as it would have.
export function warm() {
  try { getStripe().catch(() => {}); } catch { /* no-op */ }
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
