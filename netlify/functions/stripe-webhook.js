// netlify/functions/stripe-webhook.js
// Handles Stripe events → keeps Supabase subscriptions table in sync.
//
// Stripe Dashboard → Developers → Webhooks → Add endpoint:
//   URL: https://the-elite-athlete.netlify.app/.netlify/functions/stripe-webhook
//   Events: checkout.session.completed, customer.subscription.updated,
//           customer.subscription.deleted, invoice.payment_failed
//
// Required Netlify env vars:
//   STRIPE_SECRET_KEY       sk_live_...
//   STRIPE_WEBHOOK_SECRET   whsec_... (from Stripe webhook page)
//   SUPABASE_URL            https://xxxxx.supabase.co
//   SUPABASE_SERVICE_KEY    service_role key (not anon key)

const handler = async (event) => {
  if (event.httpMethod !== 'POST')
    return { statusCode: 405, body: 'Method not allowed' };

  const stripeSecret  = process.env.STRIPE_SECRET_KEY;
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
  const supabaseUrl   = process.env.SUPABASE_URL;
  const supabaseKey   = process.env.SUPABASE_SERVICE_KEY;

  if (!stripeSecret || !webhookSecret)
    return { statusCode: 500, body: JSON.stringify({ error: 'Stripe keys not configured' }) };
  if (!supabaseUrl || !supabaseKey)
    return { statusCode: 500, body: JSON.stringify({ error: 'Supabase keys not configured' }) };

  const sig = event.headers['stripe-signature'];
  if (!sig) {
    console.error('Missing stripe-signature header');
    return { statusCode: 400, body: 'Webhook Error: Missing signature' };
  }
  let stripeEvent;
  try {
    stripeEvent = await verifyWebhook(event.body, sig, webhookSecret);
  } catch (err) {
    console.error('Webhook signature failed:', err.message);
    return { statusCode: 400, body: `Webhook Error: ${err.message}` };
  }

  const { type, data } = stripeEvent;
  console.log('Stripe webhook event:', type);

  try {
    if      (type === 'checkout.session.completed')      await onCheckout(data.object, stripeSecret, supabaseUrl, supabaseKey);
    else if (type === 'customer.subscription.updated')   await onSubUpdated(data.object, supabaseUrl, supabaseKey);
    else if (type === 'customer.subscription.deleted')   await onSubDeleted(data.object, supabaseUrl, supabaseKey);
    else if (type === 'invoice.payment_failed')          await onPayFailed(data.object, supabaseUrl, supabaseKey);
    return { statusCode: 200, body: JSON.stringify({ received: true }) };
  } catch (err) {
    console.error('Webhook handler error:', err.message);
    return { statusCode: 500, body: JSON.stringify({ error: err.message }) };
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

  const planName = sub.metadata?.plan_name
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
    current_period_end: new Date(sub.current_period_end * 1000).toISOString(),
  });
  console.log(`Subscription saved: user=${userId} plan=${planName}`);
}

async function onSubUpdated(sub, supabaseUrl, supabaseKey) {
  const planName = sub.metadata?.plan_name || sub.items?.data?.[0]?.price?.nickname || 'elite';
  await patchSubById(supabaseUrl, supabaseKey, sub.id, {
    plan_name: planName, status: sub.status,
    current_period_end: new Date(sub.current_period_end * 1000).toISOString(),
  });
}

async function onSubDeleted(sub, supabaseUrl, supabaseKey) {
  await patchSubById(supabaseUrl, supabaseKey, sub.id, { status: 'cancelled', plan_name: '' });
}

async function onPayFailed(invoice, supabaseUrl, supabaseKey) {
  if (!invoice.subscription) return;
  await patchSubById(supabaseUrl, supabaseKey, invoice.subscription, { status: 'past_due' });
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
  const res = await fetch(`${supabaseUrl}/rest/v1/subscriptions`, {
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

module.exports = { handler };
