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
import { taxSubscriptionFields } from './_tax.js';

const STRIPE = 'https://api.stripe.com/v1';

// Stripe treats these as "this subscription still exists and may bill again".
// A seat subscription in any of them must be REUSED, never duplicated.
const LIVE_STATUSES = new Set(['active', 'trialing', 'past_due', 'unpaid', 'incomplete']);

// Statuses that mean "this person's OWN access is live right now". Narrower
// than LIVE_STATUSES: 'unpaid' and 'incomplete' are subscriptions Stripe has
// not managed to collect on, so they are not access anyone is paying for.
const LIVE_ACCESS = new Set(['active', 'trialing', 'past_due']);

// How many user ids to put in one PostgREST in.() filter. Rosters are bounded
// per coach, but a 500-athlete program must not become one enormous URL.
const ID_CHUNK = 100;

// Status comparison is ALWAYS case- and space-insensitive here. The live table
// held a row with status 'Active', which every status='active' filter in the
// app silently missed. In this file that failure mode is not neutral: the
// question being asked is "does this athlete already pay?", and a missed match
// answers "no", which bills a school for someone who is already paying.
const normStatus = (v) => String(v || '').trim().toLowerCase();
const normPlan   = (v) => String(v || '').trim().toLowerCase();

/**
 * Does this subscription row represent the person's OWN live access - the
 * thing that makes a school seat unnecessary?
 *
 * A school-granted seat (seat_coach_id set) deliberately does NOT count: it is
 * the thing being decided, not evidence against itself. Treating it as "they
 * already have access" would make every seat cancel itself on the next sync.
 *
 * Comped and beta plans DO count. Kiszo's call, 2026-09-08: a beta athlete has
 * live access, so no school pays for them; when beta ends they roll onto the
 * seat through the same path as an expiring paid subscription.
 */
function holdsOwnAccess(row) {
  if (!row) return false;
  if (row.seat_coach_id) return false;
  const plan = normPlan(row.plan_name);
  if (!plan || plan === 'athlete_seat') return false;
  return LIVE_ACCESS.has(normStatus(row.status));
}

// Subscription rows for a set of users, chunked. Returns Map(user_id -> row).
async function subsForUsers(REST, H, ids) {
  const out = new Map();
  for (let i = 0; i < ids.length; i += ID_CHUNK) {
    const chunk = ids.slice(i, i + ID_CHUNK);
    const r = await fetch(
      `${REST}/subscriptions?user_id=in.(${chunk.join(',')})`
      + `&select=user_id,plan_name,status,seat_coach_id`, { headers: H });
    if (!r.ok) throw new Error(`roster subscription read failed: ${await r.text()}`);
    for (const row of await r.json()) out.set(row.user_id, row);
  }
  return out;
}

/**
 * Another Coach Pro coach who is also actively rostering this athlete.
 *
 * Needed because an athlete can sit on two teams. Without this, coach B's
 * cleanup pass would clear a seat row and cut off access the athlete still has
 * through coach A - who is still being billed for them.
 */
async function otherSeatCoachFor(REST, H, athleteId, excludeCoachId) {
  const r = await fetch(
    `${REST}/team_members?athlete_id=eq.${athleteId}&status=eq.active&select=coach_id`,
    { headers: H });
  if (!r.ok) return null;
  const ids = [...new Set((await r.json()).map(x => x.coach_id).filter(Boolean))]
    .filter(c => c !== excludeCoachId);
  if (!ids.length) return null;
  const s = await fetch(
    `${REST}/subscriptions?user_id=in.(${ids.slice(0, ID_CHUNK).join(',')})`
    + `&select=user_id,plan_name,status`, { headers: H });
  if (!s.ok) return null;
  const hit = (await s.json()).find(
    row => planHasSeats(row.plan_name) && normStatus(row.status) === 'active');
  return hit?.user_id || null;
}

/**
 * Bring the athletes' OWN subscription rows in line with who this coach is
 * paying for. This is what turns a $4.99 charge into actual access.
 *
 * THE RAIL: every write here is confined to rows where seat_coach_id is set,
 * or to creating one. A self-purchased subscription has seat_coach_id null and
 * cannot be touched by this function - which matters, because this is seat
 * code writing to the table the paywall reads.
 */
async function reconcileSeatRows(REST, H, coachId, billed, subsByUser) {
  const JH  = { ...H, 'Content-Type': 'application/json' };
  const now = () => new Date().toISOString();
  let granted = 0, cleared = 0;

  // GRANT - everyone this coach is billed for gets athlete_seat access.
  for (const id of billed) {
    const row = subsByUser.get(id);
    if (row && row.seat_coach_id === coachId
        && normPlan(row.plan_name) === 'athlete_seat'
        && normStatus(row.status) === 'active') continue;      // already correct

    const patch = { plan_name: 'athlete_seat', status: 'active',
                    seat_coach_id: coachId, updated_at: now() };
    // PATCH rather than upsert when a row exists: an athlete whose own
    // subscription lapsed still has stripe_customer_id / stripe_subscription_id
    // on that row, and overwriting the whole row would destroy the history that
    // lets them resume later.
    const res = row
      ? await fetch(`${REST}/subscriptions?user_id=eq.${id}`,
          { method: 'PATCH', headers: JH, body: JSON.stringify(patch) })
      : await fetch(`${REST}/subscriptions`,
          { method: 'POST', headers: JH, body: JSON.stringify({ user_id: id, ...patch }) });
    if (res.ok) granted++;
    else console.error('seat grant failed for', id, await res.text());
  }

  // CLEAR - rows THIS coach granted to someone they are no longer billed for.
  // Kiszo's call: access ends the moment the roster row does, so billing and
  // access always end on the same event.
  let q = `${REST}/subscriptions?seat_coach_id=eq.${coachId}`;
  if (billed.size) q += `&user_id=not.in.(${[...billed].join(',')})`;
  const staleRes = await fetch(`${q}&select=user_id`, { headers: H });
  const stale = staleRes.ok ? await staleRes.json() : [];

  for (const { user_id } of stale) {
    // Still rostered by another Coach Pro coach? Hand the grant over instead of
    // cutting them off - that coach is paying for them.
    const other = await otherSeatCoachFor(REST, H, user_id, coachId);
    const patch = other
      ? { seat_coach_id: other, updated_at: now() }
      : { plan_name: '', status: 'inactive', seat_coach_id: null, updated_at: now() };
    const res = await fetch(`${REST}/subscriptions?user_id=eq.${user_id}&seat_coach_id=eq.${coachId}`,
      { method: 'PATCH', headers: JH, body: JSON.stringify(patch) });
    if (res.ok) cleared++;
    else console.error('seat clear failed for', user_id, await res.text());
  }

  return { granted, cleared };
}

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
    if (normStatus(sub.status) !== 'active') return { synced: false, reason: `subscription ${sub.status}` };
    if (!sub.stripe_subscription_id) return { synced: false, reason: 'no stripe subscription id' };
    if (!sub.stripe_customer_id)     return { synced: false, reason: 'no stripe customer id' };

    // 2. Active roster, distinct athletes. A coach's roster is bounded, so one
    //    scoped read is fine; this is never a whole-table scan.
    const memRes = await fetch(
      `${REST}/team_members?coach_id=eq.${coachId}&status=eq.active&select=athlete_id`,
      { headers: H });
    const rows = memRes.ok ? await memRes.json() : [];
    const roster = [...new Set(rows.map(r => r.athlete_id).filter(Boolean))];

    // 2b. Subtract athletes who already hold their own live access.
    //     Kiszo's rule, 2026-09-08: "block the seat while they hold their own
    //     paid subscription; after the paid period expires they can rejoin the
    //     seat." Without this the athlete pays for Elite AND their school pays
    //     $4.99 for the same person, every month.
    //
    //     Rejoining is not a scheduled job: Stripe emits
    //     customer.subscription.deleted when a period actually ends (including
    //     cancel_at_period_end), and RevenueCat emits EXPIRATION. Both call
    //     resyncCoachesOfAthlete, which lands right back here.
    const subsByUser = roster.length ? await subsForUsers(REST, H, roster) : new Map();
    const billed = new Set(roster.filter(id => !holdsOwnAccess(subsByUser.get(id))));
    const seats = billed.size;
    const exempt = roster.length - seats;
    if (exempt) console.log(`Seat sync: coach=${coachId} ${exempt} athlete(s) already have their own access - not billed`);

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
        // Seats are created here, not through Checkout, so they need their own
        // automatic_tax - otherwise the $899 is taxed and the $4.99/athlete is
        // not, on every monthly invoice. Empty while tax is off.
        ...taxSubscriptionFields(),
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
    }

    // 5. Access. Deliberately AFTER Stripe has converged: if the charge could
    //    not be applied we fall into catch and grant nothing, rather than
    //    handing out access the school is not being billed for.
    const rowResult = await reconcileSeatRows(REST, H, coachId, billed, subsByUser);

    console.log(`Seat sync: coach=${coachId} seats=${seats} `
      + `granted=${rowResult.granted} cleared=${rowResult.cleared}`);
    return { synced: true, seats, ...rowResult };
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

    // The school has stopped paying, so the access it was buying ends too -
    // otherwise every athlete on that roster keeps athlete_seat access for
    // free, forever, with nothing left in Stripe to cancel. An empty billed
    // set makes reconcileSeatRows a pure revoke pass; athletes still rostered
    // by ANOTHER Coach Pro coach have their grant handed over rather than cut.
    const rowResult = await reconcileSeatRows(REST, H, coachId, new Set(), new Map());

    console.log(`Seat subscription cancelled with parent: coach=${coachId} `
      + `seat=${seatId} access_cleared=${rowResult.cleared}`);
    return { cancelled: true, ...rowResult };
  } catch (err) {
    // Loud: this one failing means a cancelled customer is still being charged.
    console.error('SEAT CANCEL FAILED - customer may still be billed:', coachId, err.message);
    return { cancelled: false, reason: err.message };
  }
}

/**
 * One athlete's access changed - resync every Coach Pro coach rostering them.
 *
 * THIS IS THE HINGE OF THE WHOLE RULE. "Block the seat while they pay, and let
 * them rejoin the seat when the paid period expires" is only true if something
 * notices the expiry. Nothing polls: the events already arrive.
 *
 *   they buy their own subscription   -> checkout.session.completed
 *   their period actually ends        -> customer.subscription.deleted
 *                                        (Stripe sends this for
 *                                         cancel_at_period_end too, at the end
 *                                         of the period - not when it is set)
 *   status moves either way           -> customer.subscription.updated
 *   App Store / Play equivalents      -> RevenueCat ACTIVE / EXPIRATION
 *
 * Each lands here, and syncCoachSeats recomputes from scratch - so the seat
 * count and the athlete's access both correct themselves without any schedule.
 *
 * Never throws: a billing resync must not fail a webhook and make Stripe retry
 * a delivery that already did its real work.
 */
export async function resyncCoachesOfAthlete(athleteId, cfg) {
  const { supabaseUrl, serviceKey } = cfg || {};
  try {
    if (!athleteId || !supabaseUrl || !serviceKey) return { resynced: 0 };
    const H = { apikey: serviceKey, Authorization: `Bearer ${serviceKey}` };
    const r = await fetch(
      `${supabaseUrl}/rest/v1/team_members?athlete_id=eq.${athleteId}`
      + `&status=eq.active&select=coach_id`, { headers: H });
    if (!r.ok) return { resynced: 0 };
    const coaches = [...new Set((await r.json()).map(x => x.coach_id).filter(Boolean))]
      .slice(0, 25);   // an athlete is on a handful of teams; a cap, not a quota
    for (const coachId of coaches) await syncCoachSeats(coachId, cfg);
    if (coaches.length) console.log(`Resynced ${coaches.length} coach(es) for athlete ${athleteId}`);
    return { resynced: coaches.length };
  } catch (err) {
    console.error('resyncCoachesOfAthlete failed (non-fatal):', err.message);
    return { resynced: 0 };
  }
}
