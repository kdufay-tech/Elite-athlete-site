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
// THE SEAT SUBSCRIPTION IS TRACKED BY ID  (20260908_seat_subscription_tracking)
//   subscriptions.seat_subscription_id holds it. This replaces the old lookup,
//   which LISTED the customer's active subscriptions and matched on price id.
//   That lookup charged coaches twice, two ways:
//
//     RACE ON CREATE - check-then-create with nothing stored and no idempotency
//       key. Two athletes redeeming invites in the same second both saw "no
//       seat subscription" and both created one: A qty 1 plus B qty 2, billing
//       3 seats for 2 athletes. It never self-corrected, because the lookup
//       broke on the first match and every later sync adjusted A while B billed
//       on untouched.
//
//     past_due WAS INVISIBLE - filtering status=active meant a seat
//       subscription whose card had failed was not found, so the next roster
//       change created a second one alongside it.
//
//   Retrieving one known id in ANY status removes both. The Stripe idempotency
//   key on create is the second line of defence for the concurrent case.
//
// SAFETY
//   Never throws into the caller - a billing hiccup must not stop an athlete
//   joining a team. Recomputes from the roster rather than adjusting by a
//   delta, so a missed sync self-heals on the next roster change.
//
//   Because it never throws, a persistent failure is SILENT. That is why the
//   result is written back to subscriptions.seat_quantity / seat_status: a row
//   whose seat_quantity disagrees with the live roster is a sync that has been
//   failing unnoticed.
// ─────────────────────────────────────────────────────────────

import { SEAT_PRICE_MONTHLY, planHasSeats } from './_plan-map.js';

const STRIPE = 'https://api.stripe.com/v1';

// Stripe treats these as "this subscription still exists and may bill again".
// A seat subscription in any of them must be REUSED, never duplicated.
const LIVE_STATUSES = new Set(['active', 'trialing', 'past_due', 'unpaid', 'incomplete']);

function form(obj) {
  return Object.entries(obj)
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
    .join('&');
}

async function stripeReq(path, secret, method = 'GET', body = null, idempotencyKey = null) {
  const res = await fetch(`${STRIPE}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${secret}`,
      ...(idempotencyKey ? { 'Idempotency-Key': idempotencyKey } : {}),
      ...(body ? { 'Content-Type': 'application/x-www-form-urlencoded' } : {}),
    },
    ...(body ? { body: form(body) } : {}),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json?.error?.message || `Stripe ${res.status} on ${path}`);
  return json;
}

// Record what we did, so a silently-failing sync is detectable. Best-effort:
// this is bookkeeping and must never be the thing that breaks a roster change.
async function recordSeatState(REST, H, coachId, patch) {
  try {
    await fetch(`${REST}/subscriptions?user_id=eq.${coachId}`, {
      method: 'PATCH',
      headers: { ...H, 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...patch, updated_at: new Date().toISOString() }),
    });
  } catch (e) {
    console.error('seat state write failed (non-fatal):', e.message);
  }
}

/**
 * Recompute and apply the seat quantity for one coach.
 * @returns {Promise<{synced:boolean, reason?:string, seats?:number}>}
 */
export async function syncCoachSeats(coachId, { supabaseUrl, serviceKey, stripeSecret }) {
  const H = { apikey: serviceKey, Authorization: `Bearer ${serviceKey}` };
  const REST = `${supabaseUrl}/rest/v1`;

  try {
    if (!coachId || !stripeSecret) return { synced: false, reason: 'missing coachId or stripe key' };

    // 1. The coach's subscription.
    const subRes = await fetch(
      `${REST}/subscriptions?user_id=eq.${coachId}`
      + `&select=plan_name,status,stripe_subscription_id,stripe_customer_id,seat_subscription_id`,
      { headers: H });
    const sub = (subRes.ok ? await subRes.json() : [])[0];
    if (!sub) return { synced: false, reason: 'no subscription row' };
    if (!planHasSeats(sub.plan_name)) return { synced: false, reason: `plan "${sub.plan_name}" has no seats` };
    if (sub.status !== 'active') return { synced: false, reason: `subscription ${sub.status}` };
    if (!sub.stripe_subscription_id) return { synced: false, reason: 'no stripe subscription id' };
    if (!sub.stripe_customer_id)     return { synced: false, reason: 'no stripe customer id' };

    // 2. Active roster, distinct athletes. A coach's roster is bounded, so one
    //    scoped read is fine; this is never a whole-table scan.
    const memRes = await fetch(
      `${REST}/team_members?coach_id=eq.${coachId}&status=eq.active&select=athlete_id`,
      { headers: H });
    const rows = memRes.ok ? await memRes.json() : [];
    const seats = new Set(rows.map(r => r.athlete_id).filter(Boolean)).size;

    // 3. Resolve the seat subscription BY STORED ID, in any status. Listing
    //    active subscriptions and matching on price is what produced duplicates.
    let seatSub = null;
    if (sub.seat_subscription_id) {
      try {
        const s = await stripeReq(`/subscriptions/${sub.seat_subscription_id}`, stripeSecret);
        if (LIVE_STATUSES.has(s.status)) seatSub = s;
        else {
          // Cancelled at Stripe (or by the coach in the portal). Forget it, so
          // a fresh one can be created rather than resurrecting a dead id.
          await recordSeatState(REST, H, coachId,
            { seat_subscription_id: null, seat_status: s.status, seat_quantity: 0 });
        }
      } catch (e) {
        // 404 - the id is stale. Clear it and fall through to create.
        console.warn('stored seat subscription unreadable, clearing:', e.message);
        await recordSeatState(REST, H, coachId, { seat_subscription_id: null });
      }
    }

    const seatItem = seatSub
      ? (seatSub.items?.data || []).find(i => i.price?.id === SEAT_PRICE_MONTHLY)
      : null;

    // 4. Converge. Stripe prorates quantity changes automatically.
    if (seats > 0 && !seatSub) {
      // The idempotency key is derived from the coach and the seat count, so a
      // duplicate request from a concurrent join returns the SAME subscription
      // instead of creating a second one. Stripe holds these for 24h.
      const created = await stripeReq('/subscriptions', stripeSecret, 'POST', {
        customer: sub.stripe_customer_id,
        'items[0][price]': SEAT_PRICE_MONTHLY,
        'items[0][quantity]': seats,
        'metadata[plan_name]': 'coach_seats',
        'metadata[coach_id]': coachId,
        'metadata[base_subscription]': sub.stripe_subscription_id,
        off_session: 'true',
      }, `seat-create-${coachId}-${seats}`);
      await recordSeatState(REST, H, coachId, {
        seat_subscription_id: created.id, seat_quantity: seats, seat_status: created.status,
      });
    } else if (seatSub && seats === 0) {
      await stripeReq(`/subscriptions/${seatSub.id}`, stripeSecret, 'DELETE');
      await recordSeatState(REST, H, coachId,
        { seat_subscription_id: null, seat_quantity: 0, seat_status: 'canceled' });
    } else if (seatItem && seatItem.quantity !== seats) {
      await stripeReq(`/subscription_items/${seatItem.id}`, stripeSecret, 'POST', { quantity: seats });
      await recordSeatState(REST, H, coachId,
        { seat_quantity: seats, seat_status: seatSub.status });
    } else {
      // Already correct in Stripe - but still record it, so seat_quantity is a
      // trustworthy mirror rather than only being written when something moves.
      await recordSeatState(REST, H, coachId,
        { seat_quantity: seats, seat_status: seatSub ? seatSub.status : null });
      return { synced: true, seats, reason: 'already correct' };
    }

    console.log(`Seat sync: coach=${coachId} seats=${seats}`);
    return { synced: true, seats };
  } catch (err) {
    // Non-fatal by design - a billing hiccup must never block a roster change.
    console.error('Seat sync failed (non-fatal):', err.message);
    await recordSeatState(REST, H, coachId, { seat_status: `error: ${String(err.message).slice(0, 80)}` });
    return { synced: false, reason: err.message };
  }
}

/**
 * Cancel a coach's seat subscription outright.
 *
 * Called when the PARENT subscription ends. Until now nothing did this:
 * syncCoachSeats is only ever triggered by a roster change, and it returns
 * early once the base subscription is no longer active - so a coach who
 * cancelled Coach Pro kept being billed $4.99 per athlete every month,
 * indefinitely, with the app showing them as cancelled.
 */
export async function cancelCoachSeats(coachId, { supabaseUrl, serviceKey, stripeSecret }) {
  const H = { apikey: serviceKey, Authorization: `Bearer ${serviceKey}` };
  const REST = `${supabaseUrl}/rest/v1`;
  try {
    if (!coachId || !stripeSecret) return { cancelled: false, reason: 'missing coachId or stripe key' };

    const subRes = await fetch(
      `${REST}/subscriptions?user_id=eq.${coachId}&select=seat_subscription_id`, { headers: H });
    const seatId = (subRes.ok ? await subRes.json() : [])[0]?.seat_subscription_id;
    if (!seatId) return { cancelled: false, reason: 'no seat subscription on file' };

    await stripeReq(`/subscriptions/${seatId}`, stripeSecret, 'DELETE');
    await recordSeatState(REST, H, coachId,
      { seat_subscription_id: null, seat_quantity: 0, seat_status: 'canceled' });
    console.log(`Seat subscription cancelled with parent: coach=${coachId} seat=${seatId}`);
    return { cancelled: true };
  } catch (err) {
    // Loud: this one failing means a cancelled customer is still being charged.
    console.error('SEAT CANCEL FAILED - customer may still be billed:', coachId, err.message);
    return { cancelled: false, reason: err.message };
  }
}
