// ─────────────────────────────────────────────────────────────
// netlify/functions/_plan-map.js
// Single server-side source of truth for price ID -> plan name.
//
// WHY THIS EXISTS
//   stripe-checkout.js took BOTH `priceId` and `planName` from the request
//   body. VALID_PLAN_NAMES constrained the name to a known set but never
//   checked it against the price, and the name was written straight into
//   subscription_data.metadata.plan_name. stripe-webhook.js then read that
//   metadata first and wrote it to subscriptions.plan_name, which
//   getUserTier() turns into the user's tier.
//
//   Net effect: a POST carrying the ATHLETE price ID and planName "coach"
//   produced a real, fully-paid $29/mo subscription whose metadata said
//   coach - Coach Pro ($99/mo + $4.99/athlete) for athlete money. The
//   endpoint has no authentication, and every price ID is compiled into the
//   public client bundle, so nothing had to be guessed.
//
//   Checked 2026-09-07: no subscription row was ever created this way.
//
// HOW THIS FIXES IT
//   The plan is derived from the price the customer is actually charged.
//   The client's planName is ignored end to end. A price and a plan can no
//   longer disagree, because only one of them is an input.
//
// ON HARDCODING PRICE IDS
//   Price IDs are public - all seven are in dist/assets/index-*.js already.
//   They are identifiers, not credentials. Env vars win when present so a
//   rotated price needs no code change; the literals keep the map working
//   if the function environment lacks them, which would otherwise fail
//   every checkout.
// ─────────────────────────────────────────────────────────────

const e = process.env;

export const PLAN_BY_PRICE = {
  // ── live ──
  [e.VITE_STRIPE_PRICE_ATHLETE_MONTHLY || 'price_1T71SnEJzVyHAKH8nVVyN83o']: 'athlete',
  [e.VITE_STRIPE_PRICE_ATHLETE_ANNUAL  || 'price_1TDtnXEJzVyHAKH89Uq3kV5Y']: 'athlete_annual',
  [e.VITE_STRIPE_PRICE_ELITE_MONTHLY   || 'price_1TDtxVEJzVyHAKH8ripHGexG']: 'elite',
  [e.VITE_STRIPE_PRICE_ELITE_ANNUAL    || 'price_1TDtyPEJzVyHAKH8K0s74tQC']: 'elite_annual',
  // RETIRED 2026-09-07. Coach Pro is annual-only ($899/yr + $4.99/athlete/mo).
  // Deliberately absent from this map so stripe-checkout REFUSES the price
  // even if it is still Active in Stripe. Archive it there too.
  // [COACH_MONTHLY price_1TDtzdEJzVyHAKH8NbNZ2kf6] -> retired, not sellable
  [e.VITE_STRIPE_PRICE_COACH_ANNUAL    || 'price_1TDu0VEJzVyHAKH8x8A17fkc']: 'coach_annual',
  [e.VITE_STRIPE_PRICE_ATHLETE_SEAT    || 'price_1TDxgUEJzVyHAKH8DuXr4sVF']: 'athlete_seat',
};

// Test-mode prices, added only when configured. Beta mode uses these.
for (const [key, plan] of [
  ['VITE_STRIPE_TEST_PRICE_ATHLETE_MONTHLY', 'athlete'],
  ['VITE_STRIPE_TEST_PRICE_ATHLETE_ANNUAL',  'athlete_annual'],
  ['VITE_STRIPE_TEST_PRICE_ELITE_MONTHLY',   'elite'],
  ['VITE_STRIPE_TEST_PRICE_ELITE_ANNUAL',    'elite_annual'],
  ['VITE_STRIPE_TEST_PRICE_COACH_MONTHLY',   'coach'],
  ['VITE_STRIPE_TEST_PRICE_COACH_ANNUAL',    'coach_annual'],
  ['VITE_STRIPE_TEST_PRICE_ATHLETE_SEAT',    'athlete_seat'],
]) {
  if (e[key]) PLAN_BY_PRICE[e[key]] = plan;
}

/** Plan for a price ID, or null if the price is not one of ours. */
export function planForPrice(priceId) {
  if (!priceId || typeof priceId !== 'string') return null;
  return PLAN_BY_PRICE[priceId] || null;
}

/**
 * Last resort for a price the map does not know - ask Stripe and read the
 * nickname. Used only so an unmapped-but-genuine price cannot hard-fail a
 * paying customer. Still never consults anything the client sent.
 */
export async function planFromStripePrice(priceId, stripeSecret) {
  try {
    const r = await fetch(`https://api.stripe.com/v1/prices/${encodeURIComponent(priceId)}`, {
      headers: { Authorization: `Bearer ${stripeSecret}` },
    });
    if (!r.ok) return null;
    const p = await r.json();
    const n = (p.nickname || '').toLowerCase();
    if (!n) return null;
    if (n.includes('coach'))   return n.includes('annual') || n.includes('year') ? 'coach_annual'   : 'coach';
    if (n.includes('elite'))   return n.includes('annual') || n.includes('year') ? 'elite_annual'   : 'elite';
    if (n.includes('athlete')) return n.includes('annual') || n.includes('year') ? 'athlete_annual' : 'athlete';
    return null;
  } catch (_) { return null; }
}


// ── PER-ATHLETE SEAT PRICE ───────────────────────────────────
// Coach Pro is ONE subscription: $899/year. On top of it, every active
// athlete costs $4.99/month. There is no $99/month coach plan.
//
// Those two cadences cannot live in one Stripe subscription - every item in a
// subscription must share a billing interval - so the seats are carried on a
// SEPARATE monthly subscription against the same customer. See _seat-sync.js.
export const SEAT_PRICE_MONTHLY =
  process.env.VITE_STRIPE_PRICE_ATHLETE_SEAT || 'price_1TDxgUEJzVyHAKH8DuXr4sVF';

/** Plans that carry per-athlete seat billing. Comp plans never do. */
export function planHasSeats(planName) {
  return planName === 'coach_annual';
}
