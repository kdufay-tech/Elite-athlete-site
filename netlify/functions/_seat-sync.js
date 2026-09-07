// ─────────────────────────────────────────────────────────────
// netlify/functions/_seat-sync.js
// Keeps a Coach Pro coach's per-athlete seat charge equal to their roster.
//
// THE MODEL
//   Coach Pro is ONE subscription fee: $899/year.
//   On top of it, each active athlete costs $4.99/month.
//   There is no $99/month coach plan.
//
// WHY TWO SUBSCRIPTIONS
//   Stripe requires every item in a subscription to share a billing interval,
//   so a $4.99/MONTH seat cannot be an item on an $899/YEAR subscription. The
//   seats therefore ride a SECOND, monthly subscription against the same
//   Stripe customer. The coach sees one annual charge and one monthly charge
//   that tracks headcount.
//
// WHY THIS EXISTS AT ALL
//   The UI advertised per-athlete billing and nothing ever charged it.
//   stripe-checkout.js sends one line item at quantity 1; no code added a seat
//   anywhere. The $4.99 price has existed in Stripe since 23 March with zero
//   subscriptions against it.
//
// SCOPE
//   * plan_name === 'coach_annual' only. Comp plans are never billed.
//   * status='active' members only; an athlete on two of the coach's teams
//     counts once.
//
// SAFETY
//   Never throws into the caller - a billing hiccup must not stop an athlete
//   joining a team. Recomputes from the roster rather than adjusting by a
//   delta, so a missed sync self-heals on the next roster change.
//
//   Creating the seat subscription charges the card off-session. If the coach's
//   payment method needs authentication it can fail; that is logged, the join
//   still succeeds, and the next roster change retries.
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
      `${REST}/subscriptions?user_id=eq.${coachId}&select=plan_name,status,stripe_subscription_id,stripe_customer_id`,
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

    // 3. Find the coach's seat subscription, if one exists. It is a separate
    //    monthly subscription on the same customer, carrying only the seat price.
    if (!sub.stripe_customer_id) return { synced: false, reason: 'no stripe customer id' };

    const list = await stripeReq(
      `/subscriptions?customer=${encodeURIComponent(sub.stripe_customer_id)}&status=active&limit=100`,
      stripeSecret);
    let seatSub = null, seatItem = null;
    for (const s2 of (list.data || [])) {
      if (s2.id === sub.stripe_subscription_id) continue;      // the $899 base
      const item = (s2.items?.data || []).find(i => i.price?.id === SEAT_PRICE_MONTHLY);
      if (item) { seatSub = s2; seatItem = item; break; }
    }

    // 4. Converge. Stripe prorates quantity changes automatically.
    if (seats > 0 && !seatSub) {
      await stripeReq('/subscriptions', stripeSecret, 'POST', {
        customer: sub.stripe_customer_id,
        'items[0][price]': SEAT_PRICE_MONTHLY,
        'items[0][quantity]': seats,
        'metadata[plan_name]': 'coach_seats',
        'metadata[base_subscription]': sub.stripe_subscription_id,
        off_session: 'true',
      });
    } else if (seatSub && seats === 0) {
      await stripeReq(`/subscriptions/${seatSub.id}`, stripeSecret, 'DELETE');
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
