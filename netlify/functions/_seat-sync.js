// ─────────────────────────────────────────────────────────────
// netlify/functions/_seat-sync.js
// Keeps a monthly Coach Pro subscription's seat quantity equal to the coach's
// active roster.
//
// WHY
//   Coach Pro monthly is advertised as "$99/month base + $4.99/athlete/month".
//   The base was charged; the seats never were. stripe-checkout.js sends a
//   single line item (`line_items: [{ price, quantity: 1 }]`) and nothing
//   anywhere added a seat item or moved its quantity. Coaches were billed a
//   flat $99 regardless of roster size.
//
// SCOPE - deliberately narrow
//   * plan_name === 'coach' only. ANNUAL ($899/yr) is flat by decision, and
//     Stripe forbids mixing intervals in one subscription anyway.
//   * comp plans (coach_comp) are skipped - they are not billed.
//   * Only status='active' rows count, and each athlete counts once even if
//     they are on two of the same coach's teams.
//
// SAFETY
//   Never throws into the caller. A Stripe hiccup must not stop an athlete
//   joining a team. Failures are logged and the next join/leave re-syncs,
//   because this recomputes from the roster rather than adjusting by a delta.
// ─────────────────────────────────────────────────────────────

import { SEAT_PRICE_MONTHLY, planHasSeats } from './_plan-map.js';

const STRIPE = 'https://api.stripe.com/v1';

function form(obj) {
  return Object.entries(obj)
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
    .join('&');
}

async function stripeReq(path, secret, method = 'GET', body = null) {
  const res = await fetch(`${STRIPE}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${secret}`,
      ...(body ? { 'Content-Type': 'application/x-www-form-urlencoded' } : {}),
    },
    ...(body ? { body: form(body) } : {}),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json?.error?.message || `Stripe ${res.status} on ${path}`);
  return json;
}

/**
 * Recompute and apply the seat quantity for one coach.
 * @returns {Promise<{synced:boolean, reason?:string, seats?:number}>}
 */
export async function syncCoachSeats(coachId, { supabaseUrl, serviceKey, stripeSecret }) {
  try {
    if (!coachId || !stripeSecret) return { synced: false, reason: 'missing coachId or stripe key' };

    const H = { apikey: serviceKey, Authorization: `Bearer ${serviceKey}` };
    const REST = `${supabaseUrl}/rest/v1`;

    // 1. The coach's subscription.
    const subRes = await fetch(
      `${REST}/subscriptions?user_id=eq.${coachId}&select=plan_name,status,stripe_subscription_id`,
      { headers: H });
    const sub = (subRes.ok ? await subRes.json() : [])[0];
    if (!sub) return { synced: false, reason: 'no subscription row' };
    if (!planHasSeats(sub.plan_name)) return { synced: false, reason: `plan "${sub.plan_name}" has no seats` };
    if (sub.status !== 'active') return { synced: false, reason: `subscription ${sub.status}` };
    if (!sub.stripe_subscription_id) return { synced: false, reason: 'no stripe subscription id' };

    // 2. Active roster, distinct athletes. A coach's roster is bounded, so one
    //    scoped read is fine; this is never a whole-table scan.
    const memRes = await fetch(
      `${REST}/team_members?coach_id=eq.${coachId}&status=eq.active&select=athlete_id`,
      { headers: H });
    const rows = memRes.ok ? await memRes.json() : [];
    const seats = new Set(rows.map(r => r.athlete_id).filter(Boolean)).size;

    // 3. Current seat item on the subscription, if any.
    const stripeSub = await stripeReq(`/subscriptions/${sub.stripe_subscription_id}`, stripeSecret);
    const seatItem = (stripeSub.items?.data || []).find(i => i.price?.id === SEAT_PRICE_MONTHLY);

    // 4. Converge. Stripe prorates each change automatically.
    if (seats > 0 && !seatItem) {
      await stripeReq('/subscription_items', stripeSecret, 'POST', {
        subscription: sub.stripe_subscription_id,
        price: SEAT_PRICE_MONTHLY,
        quantity: seats,
      });
    } else if (seatItem && seats === 0) {
      await stripeReq(`/subscription_items/${seatItem.id}`, stripeSecret, 'DELETE');
    } else if (seatItem && seatItem.quantity !== seats) {
      await stripeReq(`/subscription_items/${seatItem.id}`, stripeSecret, 'POST', { quantity: seats });
    } else {
      return { synced: true, seats, reason: 'already correct' };
    }

    console.log(`Seat sync: coach=${coachId} seats=${seats}`);
    return { synced: true, seats };
  } catch (err) {
    // Non-fatal by design - a billing hiccup must never block a roster change.
    console.error('Seat sync failed (non-fatal):', err.message);
    return { synced: false, reason: err.message };
  }
}
