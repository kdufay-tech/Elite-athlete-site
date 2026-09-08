// netlify/functions/stripe-webhook.js
// ESM format — required for this project (node_bundler = esbuild)
import { planForPrice } from './_plan-map.js';
import { cancelCoachSeats } from './_seat-sync.js';

export default async (req) => {
  if (req.method !== 'POST')
    return new Response('Method not allowed', { status: 405 });

  const isBeta        = process.env.BETA_MODE === 'true';
  const stripeSecret  = isBeta ? process.env.STRIPE_TEST_SECRET_KEY  : process.env.STRIPE_SECRET_KEY;
  const webhookSecret = isBeta ? process.env.STRIPE_TEST_WEBHOOK_SECRET : process.env.STRIPE_WEBHOOK_SECRET;
  const supabaseUrl   = process.env.SUPABASE_URL;
  const supabaseKey   = process.env.SUPABASE_SERVICE_ROLE_KEY||process.env.SUPABASE_SERVICE_KEY;

  if (!stripeSecret || !webhookSecret)
    return new Response(JSON.stringify({ error: 'Stripe keys not configured' }), { status: 500 });
  if (!supabaseUrl || !supabaseKey)
    return new Response(JSON.stringify({ error: 'Supabase keys not configured' }), { status: 500 });

  const sig = req.headers.get('stripe-signature');
  if (!sig) return new Response('Missing signature', { status: 400 });

  const payload = await req.text();
  let stripeEvent;
  try {
    stripeEvent = await verifyWebhook(payload, sig, webhookSecret);
  } catch (err) {
    console.error('Webhook signature failed:', err.message);
    return new Response(`Webhook Error: ${err.message}`, { status: 400 });
  }

  const { type, data } = stripeEvent;
  console.log('Stripe webhook event:', type);

  try {
    if      (type === 'checkout.session.completed')      await onCheckout(data.object, stripeSecret, supabaseUrl, supabaseKey);
    else if (type === 'customer.subscription.updated')   await onSubUpdated(data.object, supabaseUrl, supabaseKey);
    else if (type === 'customer.subscription.deleted')   await onSubDeleted(data.object, supabaseUrl, supabaseKey, stripeSecret);
    else if (type === 'invoice.payment_failed')          await onPayFailed(data.object, supabaseUrl, supabaseKey);
    return new Response(JSON.stringify({ received: true }), { status: 200 });
  } catch (err) {
    console.error('Webhook handler error:', err.message);
    return new Response(JSON.stringify({ error: err.message }), { status: 500 });
  }
};

async function onCheckout(session, stripeSecret, supabaseUrl, supabaseKey) {
  const { customer: customerId, subscription: subscriptionId } = session;
  const customerEmail = session.customer_email || session.customer_details?.email;
  if (!subscriptionId) return;

  const subRes = await fetch(`https://api.stripe.com/v1/subscriptions/${subscriptionId}`, {
    headers: { 'Authorization': `Bearer ${stripeSecret}` },
  });
  const sub = await subRes.json();

  // Derive from the price actually on the subscription. Metadata is only a
  // fallback for rows created before the checkout function stopped trusting
  // the client - it was writable by whoever called the unauthenticated
  // checkout endpoint, so it cannot be the primary source.
  const planName = planForPrice(sub.items?.data?.[0]?.price?.id)
    || sub.metadata?.plan_name
    || sub.items?.data?.[0]?.price?.nickname
    || 'elite';

  const userId = await findUser(customerEmail, supabaseUrl, supabaseKey);
  if (!userId) { console.warn('No Supabase user for email:', customerEmail); return; }

  await upsertSub(supabaseUrl, supabaseKey, {
    user_id: userId,
    stripe_customer_id: customerId,
    stripe_subscription_id: subscriptionId,
    plan_name: planName,
    status: sub.status,
    billing_interval: sub.items?.data?.[0]?.price?.recurring?.interval || 'month',
    current_period_end: sub.current_period_end ? new Date(sub.current_period_end * 1000).toISOString() : new Date(Date.now() + 30*24*60*60*1000).toISOString(),
  });
  console.log(`Subscription saved: user=${userId} plan=${planName}`);
}

async function onSubUpdated(sub, supabaseUrl, supabaseKey) {
  // A seat subscription changing status is seat bookkeeping, never a change to
  // the coach's plan. Its id lives in subscriptions.seat_subscription_id, so
  // patchSubById would match zero rows and the change would vanish.
  if (await patchSeatSub(supabaseUrl, supabaseKey, sub.id, { seat_status: sub.status })) return;

  const planName = planForPrice(sub.items?.data?.[0]?.price?.id) || sub.metadata?.plan_name || sub.items?.data?.[0]?.price?.nickname || 'elite';
  await patchSubById(supabaseUrl, supabaseKey, sub.id, {
    plan_name: planName, status: sub.status,
    current_period_end: sub.current_period_end ? new Date(sub.current_period_end * 1000).toISOString() : new Date(Date.now() + 30*24*60*60*1000).toISOString(),
  });
}

async function onSubDeleted(sub, supabaseUrl, supabaseKey, stripeSecret) {
  // 1. THE SEAT SUBSCRIPTION ITSELF ended - cancelled by the coach in the
  //    Stripe portal, or dunning gave up on a dead card. Clear the stored id
  //    so the next roster change creates a fresh seat subscription instead of
  //    trying to adjust a dead one.
  if (await patchSeatSub(supabaseUrl, supabaseKey, sub.id,
        { seat_subscription_id: null, seat_quantity: 0, seat_status: 'canceled' })) {
    console.log('Seat subscription ended at Stripe, cleared:', sub.id);
    return;
  }

  // 2. A REAL PLAN ended. If it was Coach Pro, the SEPARATE monthly seat
  //    subscription is still live and keeps billing $4.99 per athlete every
  //    month, forever, while the app shows the coach as cancelled.
  //    syncCoachSeats never catches this: it only runs on a roster change and
  //    returns early once the base subscription is no longer active. So the
  //    parent ending is the ONLY moment the seats can be stopped.
  const owner = await ownerOfSub(supabaseUrl, supabaseKey, sub.id);
  if (owner?.user_id && owner.seat_subscription_id) {
    await cancelCoachSeats(owner.user_id,
      { supabaseUrl, serviceKey: supabaseKey, stripeSecret });
  }

  await patchSubById(supabaseUrl, supabaseKey, sub.id, { status: 'cancelled', plan_name: '' });
}

async function onPayFailed(invoice, supabaseUrl, supabaseKey) {
  const subId = invoice.subscription;
  if (!subId) return;
  // A failed SEAT invoice is not the coach's plan failing. Marking the plan
  // past_due would strip a paid-up coach's access over a $4.99 charge, so the
  // failure is recorded on the seat columns instead - Stripe keeps retrying,
  // and the app can prompt for a new card without touching entitlement.
  if (await patchSeatSub(supabaseUrl, supabaseKey, subId, { seat_status: 'past_due' })) {
    console.warn('Seat invoice payment failed for seat subscription:', subId);
    return;
  }
  await patchSubById(supabaseUrl, supabaseKey, subId, { status: 'past_due' });
}

// Who owns a subscription, and do they carry seats?
async function ownerOfSub(supabaseUrl, supabaseKey, stripeSubId) {
  try {
    const res = await fetch(
      `${supabaseUrl}/rest/v1/subscriptions?stripe_subscription_id=eq.${stripeSubId}`
      + `&select=user_id,plan_name,seat_subscription_id&limit=1`,
      { headers: { apikey: supabaseKey, Authorization: `Bearer ${supabaseKey}` } });
    if (!res.ok) return null;
    return (await res.json())[0] || null;
  } catch (e) {
    console.error('ownerOfSub failed:', e.message);
    return null;
  }
}

// Apply a patch to whichever row carries this id as its SEAT subscription.
// Returns true when a row matched, which is the ground-truth answer to "is
// this Stripe event about seat billing?" - no reliance on Stripe metadata.
async function patchSeatSub(supabaseUrl, supabaseKey, seatSubId, patch) {
  if (!seatSubId) return false;
  const res = await fetch(
    `${supabaseUrl}/rest/v1/subscriptions?seat_subscription_id=eq.${seatSubId}`,
    {
      method: 'PATCH',
      headers: { apikey: supabaseKey, Authorization: `Bearer ${supabaseKey}`,
        'Content-Type': 'application/json', Prefer: 'return=representation' },
      body: JSON.stringify({ ...patch, updated_at: new Date().toISOString() }),
    }
  );
  if (!res.ok) throw new Error(`Supabase seat patch failed: ${await res.text()}`);
  const rows = await res.json().catch(() => []);
  return Array.isArray(rows) && rows.length > 0;
}

async function findUser(email, supabaseUrl, supabaseKey) {
  if (!email) return null;
  // Use Supabase Auth admin API — requires service_role key
  // This correctly maps the customer's email to their Supabase user ID
  try {
    const res = await fetch(
      `${supabaseUrl}/auth/v1/admin/users?email=${encodeURIComponent(email)}`,
      { headers: { apikey: supabaseKey, Authorization: `Bearer ${supabaseKey}` } }
    );
    const data = await res.json();
    // Response is { users: [...] }
    const user = data?.users?.find(u => u.email?.toLowerCase() === email.toLowerCase());
    if (user?.id) return user.id;
  } catch (e) {
    console.warn('Auth admin lookup failed, trying profiles fallback:', e.message);
  }
  // Fallback: check auth.users via direct query (service key required)
  try {
    const res = await fetch(
      `${supabaseUrl}/rest/v1/rpc/get_user_id_by_email`,
      {
        method: 'POST',
        headers: { apikey: supabaseKey, Authorization: `Bearer ${supabaseKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ p_email: email }),
      }
    );
    const id = await res.json();
    if (id) return id;
  } catch (e) {
    console.warn('RPC fallback also failed:', e.message);
  }
  console.warn('Could not find Supabase user for email:', email);
  return null;
}

async function upsertSub(supabaseUrl, supabaseKey, data) {
  const res = await fetch(`${supabaseUrl}/rest/v1/subscriptions?on_conflict=user_id`, {
    method: 'POST',
    headers: { apikey: supabaseKey, Authorization: `Bearer ${supabaseKey}`,
      'Content-Type': 'application/json', Prefer: 'resolution=merge-duplicates' },
    body: JSON.stringify({ ...data, updated_at: new Date().toISOString() }),
  });
  if (!res.ok) throw new Error(`Supabase upsert failed: ${await res.text()}`);
}

async function patchSubById(supabaseUrl, supabaseKey, stripeSubId, patch) {
  const res = await fetch(
    `${supabaseUrl}/rest/v1/subscriptions?stripe_subscription_id=eq.${stripeSubId}`,
    {
      method: 'PATCH',
      headers: { apikey: supabaseKey, Authorization: `Bearer ${supabaseKey}`,
        'Content-Type': 'application/json' },
      body: JSON.stringify({ ...patch, updated_at: new Date().toISOString() }),
    }
  );
  if (!res.ok) throw new Error(`Supabase patch failed: ${await res.text()}`);
}

// Stripe webhook signature verification (no stripe-node package required)
async function verifyWebhook(payload, sigHeader, secret) {
  const parts = Object.fromEntries(sigHeader.split(',').map(p => p.split('=')));
  const { t: timestamp, v1: signature } = parts;
  if (!timestamp || !signature) throw new Error('Invalid signature header');
  if (Math.abs(Date.now() / 1000 - parseInt(timestamp)) > 300) throw new Error('Timestamp too old');

  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']
  );
  const buf = await crypto.subtle.sign('HMAC', key, enc.encode(`${timestamp}.${payload}`));
  const computed = Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2,'0')).join('');
  if (computed !== signature) throw new Error('Signature mismatch');
  return JSON.parse(payload);
}
